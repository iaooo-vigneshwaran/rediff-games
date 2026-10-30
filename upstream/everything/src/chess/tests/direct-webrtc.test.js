import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DirectPeer, parseSignal } from '../../shared/direct-webrtc.js';
import { OnlineSession as ChessSession } from '../src/net/online.js';
import { OnlineSession as CheckersSession } from '../../checkers/src/net/online.js';
import { OnlineSession as BackgammonSession } from '../../backgammon/src/net/online.js';

class Channel extends EventTarget {
  label = 'game';
  readyState = 'connecting';
  send = vi.fn();
  close = vi.fn(() => { this.readyState = 'closed'; });
}

class PeerConnection extends EventTarget {
  static instances = [];
  iceGatheringState = 'gathering';
  signalingState = 'stable';
  connectionState = 'new';
  localDescription = null;
  constructor(config) { super(); this.config = config; PeerConnection.instances.push(this); }
  createDataChannel(label, options) { this.channelOptions = options; return new Channel(); }
  async createOffer() { return { type: 'offer', sdp: 'v=0\r\n' }; }
  async createAnswer() { return { type: 'answer', sdp: 'v=0\r\n' }; }
  async setLocalDescription(value) {
    this.localDescription = value;
    this.signalingState = value.type === 'offer' ? 'have-local-offer' : 'stable';
  }
  async setRemoteDescription(value) { this.remoteDescription = value; this.signalingState = value.type === 'offer' ? 'have-remote-offer' : 'stable'; }
  close = vi.fn();
  gathered() {
    this.localDescription.sdp += 'a=candidate:complete\r\n';
    this.iceGatheringState = 'complete';
    this.dispatchEvent(new Event('icegatheringstatechange'));
  }
}

const peers = [];
function peer(game = 'chess') {
  const failure = vi.fn();
  const transport = new DirectPeer(game, vi.fn(), failure);
  peers.push(transport);
  return { transport, pc: transport.pc, failure };
}
const signal = (game = 'chess', type = 'offer') => JSON.stringify({
  format: 'rediff-direct-webrtc', version: 1, game, type, sdp: 'v=0\r\n',
});
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }

beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('RTCPeerConnection', PeerConnection); PeerConnection.instances = []; });
afterEach(() => { peers.splice(0).forEach(p => p.close()); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('manual signaling', () => {
  it('rejects malformed, oversized, wrong-game, wrong-version and wrong-type data', () => {
    for (const text of ['', '{}', 'null', 'x'.repeat(100001), signal('checkers'), signal('chess', 'answer'), signal().replace('"version":1', '"version":2')]) {
      expect(() => parseSignal(text, 'chess', 'offer')).toThrow();
    }
    expect(parseSignal(signal(), 'chess', 'offer').type).toBe('offer');
  });

  it('exports candidates only after gathering, with no servers or timeout during host copying', async () => {
    const { transport, pc, failure } = peer();
    const result = transport.offer();
    await flush();
    expect(pc.config).toEqual({ iceServers: [] });
    expect(pc.channelOptions).toEqual({ ordered: true });
    pc.gathered();
    expect(JSON.parse(await result).sdp).toContain('a=candidate:complete');
    vi.advanceTimersByTime(300000);
    expect(failure).not.toHaveBeenCalled();
  });

  it('allows three minutes for answer exchange and reports connection failure once', async () => {
    const { transport, pc, failure } = peer();
    const answer = transport.answer(signal());
    await flush(); pc.gathered();
    expect(JSON.parse(await answer).type).toBe('answer');
    vi.advanceTimersByTime(179999);
    expect(failure).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(failure).toHaveBeenCalledTimes(1);
    expect(pc.close).toHaveBeenCalledTimes(1);
  });

  it('lets a host correct invalid pasted data, then times out an unreachable peer', async () => {
    const { transport, pc, failure } = peer();
    const offer = transport.offer(); await flush(); pc.gathered(); await offer;
    await expect(transport.acceptAnswer(signal())).rejects.toThrow('answer');
    await transport.acceptAnswer(signal('chess', 'answer'));
    vi.advanceTimersByTime(30000);
    expect(failure).toHaveBeenCalledTimes(1);
  });

  it('rejects pending gathering on cancellation and releases timers and listeners', async () => {
    const { transport, pc } = peer();
    const offer = transport.offer(); await flush();
    const rejected = expect(offer).rejects.toThrow('cancelled');
    transport.close(); await rejected;
    expect(pc.close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('times out incomplete gathering', async () => {
    const { transport } = peer();
    const offer = transport.offer(); await flush();
    const rejected = expect(offer).rejects.toThrow('gathering timed out');
    vi.advanceTimersByTime(15000); await rejected;
  });

  it('clears connection timers when a guest channel opens', async () => {
    const { transport, pc, failure } = peer();
    const answer = transport.answer(signal()); await flush(); pc.gathered(); await answer;
    const channel = new Channel();
    pc.dispatchEvent(Object.assign(new Event('datachannel'), { channel }));
    channel.readyState = 'open'; channel.dispatchEvent(new Event('open'));
    vi.advanceTimersByTime(300000);
    expect(failure).not.toHaveBeenCalled();
  });

  it('allows a transient disconnect to recover and ignores late events after leaving', () => {
    const { transport, pc, failure } = peer();
    pc.connectionState = 'disconnected'; pc.dispatchEvent(new Event('connectionstatechange'));
    vi.advanceTimersByTime(14000);
    pc.connectionState = 'connected'; pc.dispatchEvent(new Event('connectionstatechange'));
    vi.advanceTimersByTime(30000);
    expect(failure).not.toHaveBeenCalled();
    transport.close();
    pc.connectionState = 'disconnected'; pc.dispatchEvent(new Event('connectionstatechange'));
    const channel = new Channel();
    pc.dispatchEvent(Object.assign(new Event('datachannel'), { channel }));
    expect(channel.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe.each([['chess', ChessSession], ['checkers', CheckersSession], ['backgammon', BackgammonSession]])('%s session lifecycle', (game, Session) => {
  it('generates manual signaling data and cleans up on leave', async () => {
    const session = new Session({ onClose: vi.fn() });
    const offer = session.host('w', '3+2', true); await flush();
    const pc = PeerConnection.instances.at(-1); pc.gathered();
    expect(JSON.parse(await offer).game).toBe(game);
    session.leave(); session.leave();
    expect(pc.close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ends a failed host exchange instead of waiting on a stale offer', async () => {
    const onClose = vi.fn();
    const session = new Session({ onClose });
    const offer = session.host('w', null); await flush();
    const pc = PeerConnection.instances.at(-1); pc.gathered(); await offer;
    await session.acceptAnswer(signal(game, 'answer'));
    vi.advanceTimersByTime(30000);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose.mock.calls[0][0].wasConnected).toBe(false);
    expect(session.connected).toBe(false);
  });
});
