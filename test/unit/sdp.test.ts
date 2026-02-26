import { describe, it, expect } from 'vitest';
import { buildSdp, normalizeSdpLineEndings, parseSdpAnswer } from '../../src/sip/sdp.js';

describe('SDP Builder', () => {
  it('builds SDP with opus codec', () => {
    const sdp = buildSdp({
      sessionId: '123',
      sessionVersion: '456',
      origin: '203.0.113.1',
      connection: '203.0.113.1',
      mediaPort: 10000,
      codecs: ['opus']
    });
    expect(sdp).toContain('v=0');
    expect(sdp).toContain('m=audio 10000 RTP/AVP');
    expect(sdp).toContain('a=rtpmap:111 opus/48000/2');
  });

  it('builds SDP with multiple codecs', () => {
    const sdp = buildSdp({
      sessionId: '123',
      sessionVersion: '456',
      origin: '203.0.113.1',
      connection: '203.0.113.1',
      mediaPort: 10000,
      codecs: ['opus', 'PCMU']
    });
    expect(sdp).toContain('a=rtpmap:111 opus/48000/2');
    expect(sdp).toContain('a=rtpmap:0 PCMU/8000');
  });

  it('always includes telephone-event with fmtp', () => {
    const sdp = buildSdp({
      sessionId: '123',
      sessionVersion: '456',
      origin: '203.0.113.1',
      connection: '203.0.113.1',
      mediaPort: 10000,
      codecs: ['opus']
    });
    expect(sdp).toContain('a=rtpmap:101 telephone-event/8000');
    expect(sdp).toContain('a=fmtp:101 0-15');
  });

  it('uses correct line endings', () => {
    const sdp = buildSdp({
      sessionId: '123',
      sessionVersion: '456',
      origin: '203.0.113.1',
      connection: '203.0.113.1',
      mediaPort: 10000,
      codecs: ['opus']
    });
    expect(sdp).toContain('\r\n');
    expect(sdp).not.toMatch(/[^\r]\n/);
  });
});

describe('SDP Line Ending Normalization', () => {
  it('converts LF to CRLF', () => {
    const input = 'v=0\no=test\n';
    const output = normalizeSdpLineEndings(input);
    expect(output).toBe('v=0\r\no=test\r\n');
  });

  it('handles existing CRLF', () => {
    const input = 'v=0\r\no=test\r\n';
    const output = normalizeSdpLineEndings(input);
    expect(output).toBe('v=0\r\no=test\r\n');
  });
});

describe('parseSdpAnswer', () => {
  it('parses PCMU answer', () => {
    const sdp = [
      'v=0',
      'o=- 123 1 IN IP4 10.0.0.1',
      's=-',
      'c=IN IP4 10.0.0.1',
      't=0 0',
      'm=audio 20000 RTP/AVP 0 101',
      'a=rtpmap:0 PCMU/8000',
      'a=rtpmap:101 telephone-event/8000',
      'a=fmtp:101 0-15',
    ].join('\r\n');

    const result = parseSdpAnswer(sdp, '1.2.3.4', 5060);
    expect(result.codec.name).toBe('PCMU');
    expect(result.codec.payloadType).toBe(0);
    expect(result.remoteIp).toBe('10.0.0.1');
    expect(result.remotePort).toBe(20000);
  });

  it('parses PCMA answer', () => {
    const sdp = [
      'v=0',
      'o=- 123 1 IN IP4 192.168.1.100',
      's=-',
      'c=IN IP4 192.168.1.100',
      't=0 0',
      'm=audio 30000 RTP/AVP 8 101',
      'a=rtpmap:8 PCMA/8000',
      'a=rtpmap:101 telephone-event/8000',
    ].join('\r\n');

    const result = parseSdpAnswer(sdp, '1.2.3.4', 5060);
    expect(result.codec.name).toBe('PCMA');
    expect(result.codec.payloadType).toBe(8);
    expect(result.remoteIp).toBe('192.168.1.100');
    expect(result.remotePort).toBe(30000);
  });

  it('parses G722 answer', () => {
    const sdp = [
      'v=0',
      'o=- 123 1 IN IP4 10.0.0.5',
      's=-',
      'c=IN IP4 10.0.0.5',
      't=0 0',
      'm=audio 40000 RTP/AVP 9 101',
      'a=rtpmap:9 G722/8000',
      'a=rtpmap:101 telephone-event/8000',
    ].join('\r\n');

    const result = parseSdpAnswer(sdp, '1.2.3.4', 5060);
    expect(result.codec.name).toBe('G722');
    expect(result.codec.payloadType).toBe(9);
  });

  it('skips telephone-event and picks actual audio codec', () => {
    const sdp = [
      'v=0',
      'o=- 123 1 IN IP4 10.0.0.1',
      's=-',
      'c=IN IP4 10.0.0.1',
      't=0 0',
      'm=audio 20000 RTP/AVP 101 8',
      'a=rtpmap:101 telephone-event/8000',
      'a=rtpmap:8 PCMA/8000',
    ].join('\r\n');

    const result = parseSdpAnswer(sdp, '1.2.3.4', 5060);
    expect(result.codec.name).toBe('PCMA');
  });

  it('falls back to PCMU for malformed SDP', () => {
    const result = parseSdpAnswer('garbage data', '1.2.3.4', 5060);
    expect(result.codec.name).toBe('PCMU');
    expect(result.remoteIp).toBe('1.2.3.4');
    expect(result.remotePort).toBe(5060);
  });

  it('uses fallback IP/port when c=/m= missing', () => {
    const sdp = 'v=0\r\ns=-\r\n';
    const result = parseSdpAnswer(sdp, '203.0.113.1', 12345);
    expect(result.remoteIp).toBe('203.0.113.1');
    expect(result.remotePort).toBe(12345);
    expect(result.codec.name).toBe('PCMU');
  });

  it('picks first audio codec from m= line order', () => {
    const sdp = [
      'v=0',
      'o=- 123 1 IN IP4 10.0.0.1',
      's=-',
      'c=IN IP4 10.0.0.1',
      't=0 0',
      'm=audio 20000 RTP/AVP 8 0 101',
      'a=rtpmap:8 PCMA/8000',
      'a=rtpmap:0 PCMU/8000',
      'a=rtpmap:101 telephone-event/8000',
    ].join('\r\n');

    const result = parseSdpAnswer(sdp, '1.2.3.4', 5060);
    // PCMA (PT=8) is listed first in m= line
    expect(result.codec.name).toBe('PCMA');
  });
});
