// Manual, non-trickle signaling. No signaling service, STUN, or TURN is used.
const FORMAT = 'rediff-direct-webrtc';
const VERSION = 1;
const MAX_SIGNAL_LENGTH = 100000;
export const CONNECT_ERROR = 'Could not connect directly. Try the same LAN; firewalls, Wi-Fi isolation, or separate networks may prevent connection. No STUN/TURN relay is configured. Start a fresh offer/answer exchange to retry.';

export function parseSignal(text, game, type) {
  if (typeof text !== 'string' || text.length > MAX_SIGNAL_LENGTH) {
    throw new Error('Connection data is missing or too large.');
  }
  let data;
  try { data = JSON.parse(text.trim()); } catch {
    throw new Error('Invalid connection data. Paste the complete offer or answer.');
  }
  if (!data || data.format !== FORMAT || data.version !== VERSION || data.game !== game) {
    throw new Error('Connection data belongs to a different game or version.');
  }
  if (data.type !== type || typeof data.sdp !== 'string' || !data.sdp.startsWith('v=0')) {
    throw new Error(`Expected a complete ${type}.`);
  }
  return { type: data.type, sdp: data.sdp };
}

export class DirectPeer {
  constructor(game, onChannel, onFailure) {
    if (!globalThis.RTCPeerConnection) throw new Error('This browser does not support WebRTC.');
    this.game = game;
    this.onChannel = onChannel;
    this.onFailure = onFailure;
    this.closed = false;
    this.timer = null;
    this.cancelGather = null;
    this.channel = null;
    this.pc = new RTCPeerConnection({ iceServers: [] });
    this.pc.addEventListener('connectionstatechange', () => {
      if (this.closed) return;
      if (this.pc.connectionState === 'failed') this.fail(CONNECT_ERROR);
      if (this.pc.connectionState === 'disconnected') this.armTimeout(15000);
      if (this.pc.connectionState === 'connected') clearTimeout(this.timer);
    });
    this.pc.addEventListener('datachannel', ({ channel }) => {
      if (this.closed || this.role !== 'guest' || this.channel || channel.label !== 'game') {
        channel.close();
        return;
      }
      this.adopt(channel);
    });
  }

  adopt(channel) {
    this.channel = channel;
    channel.addEventListener('open', () => clearTimeout(this.timer));
    this.onChannel(channel);
  }

  armTimeout(ms = 30000) {
    if (this.closed) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.fail(CONNECT_ERROR), ms);
  }

  fail(message) {
    if (this.closed) return;
    this.close();
    this.onFailure(message);
  }

  async localSignal(description) {
    await this.pc.setLocalDescription(description);
    if (this.closed) throw new Error('Connection setup cancelled.');
    if (this.pc.iceGatheringState !== 'complete') {
      await new Promise((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timer);
          this.pc.removeEventListener('icegatheringstatechange', changed);
          this.cancelGather = null;
        };
        const changed = () => {
          if (this.pc.iceGatheringState === 'complete') { cleanup(); resolve(); }
        };
        const timer = setTimeout(() => {
          cleanup(); reject(new Error('ICE gathering timed out. Start a fresh exchange.'));
        }, 15000);
        this.cancelGather = () => { cleanup(); reject(new Error('Connection setup cancelled.')); };
        this.pc.addEventListener('icegatheringstatechange', changed);
        changed();
      });
    }
    if (this.closed) throw new Error('Connection setup cancelled.');
    const { type, sdp } = this.pc.localDescription;
    return JSON.stringify({ format: FORMAT, version: VERSION, game: this.game, type, sdp });
  }

  async offer() {
    this.role = 'host';
    this.adopt(this.pc.createDataChannel('game', { ordered: true }));
    return this.localSignal(await this.pc.createOffer());
  }

  async answer(text) {
    const description = parseSignal(text, this.game, 'offer');
    this.role = 'guest';
    await this.pc.setRemoteDescription(description);
    const answer = await this.localSignal(await this.pc.createAnswer());
    // Allow time for the guest to send the answer and the host to paste it.
    if (!this.closed && this.channel?.readyState !== 'open') this.armTimeout(180000);
    return answer;
  }

  async acceptAnswer(text) {
    if (this.closed || this.role !== 'host' || this.pc.signalingState !== 'have-local-offer') {
      throw new Error('Create a fresh offer before accepting an answer.');
    }
    const description = parseSignal(text, this.game, 'answer');
    await this.pc.setRemoteDescription(description);
    if (!this.closed && this.channel?.readyState !== 'open') this.armTimeout();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    this.cancelGather?.();
    this.channel?.close();
    this.pc.close();
  }
}
