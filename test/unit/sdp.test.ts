import { describe, it, expect } from 'vitest';
import { buildSdp, normalizeSdpLineEndings } from '../../src/sip/sdp.js';

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
