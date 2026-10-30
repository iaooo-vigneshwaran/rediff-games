/**
 * Online play over native WebRTC data channels with manual offer/answer exchange.
 *
 * One private host/guest game exchanges JSON messages after manual setup:
 *
 *   {t:'start', v, color, name, time}
 *                                host -> guest: assigned color, host's name,
 *                                and the time control the host chose
 *   {t:'joined', name}           guest -> host: handshake complete
 *   {t:'move', path, clock}      one message per TURN, not per hop — a jump
 *                                chain crosses the wire as the whole path the
 *                                mover finished, so the position, the turn,
 *                                and the clock handover stay atomic. `clock`
 *                                is the mover's own remaining ms, so the
 *                                receiver can correct for drift instead of
 *                                counting the opponent down blind
 *   {t:'flag', color}            the game ended on time; `color` ran out
 *   {t:'resign'}
 *   {t:'rematch'} / {t:'rematch-yes'} / {t:'rematch-no'}
 *   {t:'bye'}                    sent before an intentional leave
 *
 * Sessions are fire-and-forget: leave() tears everything down silently, while
 * remote/spontaneous closure surfaces through onClose exactly once.
 */

import { DirectPeer, CONNECT_ERROR } from '../../../shared/direct-webrtc.js';
// This is a new app with no deployed peers, so there is no earlier version to
// stay compatible with — start the count at 1.
const PROTOCOL_VERSION = 1;
const OPEN_TIMEOUT_MS = 30000;

/** Bound display names received from the other browser. */
function cleanName(value) {
  if (typeof value !== 'string') return null;
  return value.trim().slice(0, 40) || null;
}

/**
 * Time controls are opaque ids here — this module relays the host's choice
 * without knowing what any of them mean, and the caller resolves it (falling
 * back to an untimed game for an id it doesn't recognize).
 */
function cleanTimeId(value) {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return id && id.length <= 16 ? id : null;
}

/** A remaining-time reading from a peer: a sane, finite number of ms or null. */
function cleanClock(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}

/**
 * A move path off the wire. One message carries a whole turn — chains
 * included — so the position, the turn, and the clock handover stay atomic.
 * Never trust a peer: this is the one message type that could otherwise hand
 * the engine an out-of-range square. A repeated square is not rejected here —
 * a king capturing around a diamond of pieces legally returns to the square
 * it started from, so path[0] === path[path.length-1] is a real, legal turn.
 * (The length cap still holds: the longest legal chain is 9 captures, path
 * length 10.) The caller matches the path against the engine's own legal
 * moves before applying it, which is strictly stronger than anything this
 * function could check on its own.
 */
function cleanPath(value) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 12) return null;
  for (const square of value) {
    if (!Number.isInteger(square) || square < 1 || square > 32) return null;
  }
  return value.slice();
}

export class OnlineSession {
  /**
   * @param {{
   *   onStart({myColor, opponentName, role, timeId}): void, // handshake done
   *   onMove({path, clock}): void,
   *   onFlag(color): void,
   *   onResign(): void,
   *   onRematchOffer(): void,
   *   onRematchAccept(): void,
   *   onRematchDecline(): void,
   *   onClose({reason, wasConnected}): void,  // remote or spontaneous end
   *   onError(message): void,
   * }} handlers
   */
  constructor(handlers) {
    this.handlers = handlers;
    this.role = null; // 'host' | 'guest'
    this.myColor = null;
    this.timeId = null; // the host's time control, opaque to this module
    this.opponentName = null;
    this.inviteCode = null;
    this.connected = false;
    this._peer = null;
    this._conn = null;
    this._myName = null;
    this._openTimer = 0;
    this._ended = false;
  }

  _createPeer() {
    this._peer = new DirectPeer('checkers', (channel) => this._adopt(channel),
      (reason) => this._end(reason));
    this._myName = this.role === 'host' ? 'Host' : 'Guest';
    return this._peer;
  }

  /** Generate the complete offer for the guest to paste. */
  async host(myColor, timeId) {
    this.role = 'host';
    this.myColor = myColor;
    this.timeId = cleanTimeId(timeId);
    try {
      this.inviteCode = await this._createPeer().offer();
      return this.inviteCode;
    } catch (error) { this.leave(); throw error; }
  }

  /** Apply an offer and return the complete answer for the host. */
  async join(offer) {
    this.role = 'guest';
    try {
      return await this._createPeer().answer(offer);
    } catch (error) { this.leave(); throw error; }
  }

  async acceptAnswer(answer) {
    if (!this._peer || this._ended) throw new Error('Create a fresh game first.');
    return this._peer.acceptAnswer(answer);
  }

  _adopt(conn) {
    this._conn = conn;
    conn.addEventListener('open', () => {
      if (this._ended || this._conn !== conn) return;
      this._openTimer = setTimeout(() => {
        this._connFailed(conn, 'The game handshake timed out. Start a fresh exchange.');
      }, OPEN_TIMEOUT_MS);
      if (this.role === 'host') {
        // The guest plays the other color; handshake completes on 'joined'.
        this._send({
          t: 'start',
          v: PROTOCOL_VERSION,
          color: this.myColor === 'w' ? 'b' : 'w',
          name: this._myName,
          time: this.timeId,
        });
      }
    });
    conn.addEventListener('message', (event) => {
      if (this._conn === conn) this._onMessage(event);
    });
    conn.addEventListener('close', () => {
      if (this._conn === conn) this._connFailed(conn, this.connected ? 'left' : CONNECT_ERROR);
    });
    conn.addEventListener('error', () => {
      if (this._conn === conn) this._connFailed(conn, CONNECT_ERROR);
    });
  }

  /** Failed manual exchanges need a fresh offer and answer. */
  _connFailed(conn, reason) {
    if (this._ended || this._conn !== conn) return;
    this._end(reason);
  }

  _onMessage(event) {
    if (this._ended || typeof event.data !== 'string') return;
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    switch (msg.t) {
      case 'start': {
        if (this.role !== 'guest' || this.connected) return;
        if (msg.v !== PROTOCOL_VERSION) {
          this._sendBye();
          this._end('Your friend is on a different version of the app — reload and try again.');
          return;
        }
        this.myColor = msg.color === 'w' ? 'w' : 'b';
        this.timeId = cleanTimeId(msg.time);
        this.opponentName = cleanName(msg.name) || this.opponentName;
        this._send({ t: 'joined', name: this._myName });
        this._markConnected();
        break;
      }
      case 'joined': {
        if (this.role !== 'host' || this.connected) return;
        this.opponentName = cleanName(msg.name) || this.opponentName;
        this._markConnected();
        break;
      }
      case 'move': {
        if (!this.connected) break;
        const path = cleanPath(msg.path);
        if (path) {
          this.handlers.onMove({ path, clock: cleanClock(msg.clock) });
        } else {
          // A path this malformed should never come from this app itself —
          // surface it rather than silently dropping the message, which would
          // otherwise leave the mover's board advanced and this side's
          // waiting forever with no explanation.
          this.handlers.onError('Received an invalid move from your opponent.');
        }
        break;
      }
      case 'flag':
        if (this.connected && (msg.color === 'w' || msg.color === 'b')) {
          this.handlers.onFlag(msg.color);
        }
        break;
      case 'resign':
        if (this.connected) this.handlers.onResign();
        break;
      case 'rematch':
        if (this.connected) this.handlers.onRematchOffer();
        break;
      case 'rematch-yes':
        if (this.connected) this.handlers.onRematchAccept();
        break;
      case 'rematch-no':
        if (this.connected) this.handlers.onRematchDecline();
        break;
      case 'bye':
        this._end('left');
        break;
      default:
        // Unknown message types are ignored for forward compatibility.
        break;
    }
  }

  _markConnected() {
    clearTimeout(this._openTimer);
    this.connected = true;
    this.handlers.onStart({
      myColor: this.myColor,
      opponentName: this.opponentName,
      role: this.role,
      timeId: this.timeId,
    });
  }

  _send(msg) {
    if (!this._conn) return;
    try {
      this._conn.send(JSON.stringify(msg));
    } catch {
      // The close event will surface the failure; nothing useful to do here.
    }
  }

  /** `clock` is our own remaining ms after the turn, or null when untimed. */
  sendMove({ path }, clock = null) {
    this._send({ t: 'move', path, clock });
  }

  /** Report a flag fall. Both sides may send this; `color` is who ran out. */
  sendFlag(color) {
    this._send({ t: 'flag', color });
  }

  sendResign() {
    this._send({ t: 'resign' });
  }

  sendRematchOffer() {
    this._send({ t: 'rematch' });
  }

  sendRematchAccept() {
    this._send({ t: 'rematch-yes' });
  }

  sendRematchDecline() {
    this._send({ t: 'rematch-no' });
  }

  /** Swap colors for a rematch (both peers do this symmetrically). */
  swapColors() {
    this.myColor = this.myColor === 'w' ? 'b' : 'w';
  }

  _sendBye() {
    this._send({ t: 'bye' });
  }

  /** Remote or spontaneous end: tear down and notify once. */
  _end(reason) {
    if (this._ended) return;
    const wasConnected = this.connected;
    this._teardown();
    this.handlers.onClose({ reason, wasConnected });
  }

  /** Local, intentional end (cancel/leave/mode switch): silent teardown. */
  leave() {
    if (this._ended) return;
    this._sendBye();
    this._teardown();
  }

  _teardown() {
    this._ended = true;
    this.connected = false;
    clearTimeout(this._openTimer);
    try {
      this._conn?.close?.();
    } catch {
      // Already closed.
    }
    try {
      this._peer?.close();
    } catch {
      // Already closed.
    }
    this._conn = null;
    this._peer = null;
  }
}
