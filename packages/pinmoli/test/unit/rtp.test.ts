import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import {
  buildRTPPacket,
  parseRTPPacket,
  findDataChunk,
  loadAudioSample,
} from '../../src/sip/rtp-receiver.js';

describe('buildRTPPacket', () => {
  it('creates a valid 12-byte header + payload', () => {
    const payload = Buffer.alloc(160, 0x7F); // 160 bytes of PCMU silence
    const packet = buildRTPPacket({
      payloadType: 0,
      sequenceNumber: 1,
      timestamp: 160,
      ssrc: 12345,
      payload,
    });

    expect(packet.length).toBe(12 + 160);
    // Version should be 2 (bits 6-7 of byte 0)
    expect((packet[0] >> 6) & 0x03).toBe(2);
  });

  it('sets marker bit correctly', () => {
    const payload = Buffer.alloc(10);

    const withMarker = buildRTPPacket({
      payloadType: 0,
      sequenceNumber: 0,
      timestamp: 0,
      ssrc: 0,
      payload,
      marker: true,
    });
    expect((withMarker[1] >> 7) & 1).toBe(1);

    const withoutMarker = buildRTPPacket({
      payloadType: 0,
      sequenceNumber: 0,
      timestamp: 0,
      ssrc: 0,
      payload,
      marker: false,
    });
    expect((withoutMarker[1] >> 7) & 1).toBe(0);
  });

  it('encodes payload type correctly', () => {
    const payload = Buffer.alloc(10);
    const packet = buildRTPPacket({
      payloadType: 111, // opus
      sequenceNumber: 0,
      timestamp: 0,
      ssrc: 0,
      payload,
    });
    expect(packet[1] & 0x7F).toBe(111);
  });
});

describe('parseRTPPacket / buildRTPPacket roundtrip', () => {
  it('roundtrips all fields correctly', () => {
    const payload = Buffer.from([0x01, 0x02, 0x03, 0x04]);
    const original = {
      payloadType: 0,
      sequenceNumber: 42,
      timestamp: 12345,
      ssrc: 0xDEADBEEF,
      marker: true,
    };

    const packet = buildRTPPacket({ ...original, payload });
    const parsed = parseRTPPacket(packet);

    expect(parsed).not.toBeNull();
    expect(parsed!.version).toBe(2);
    expect(parsed!.payloadType).toBe(original.payloadType);
    expect(parsed!.sequenceNumber).toBe(original.sequenceNumber);
    expect(parsed!.timestamp).toBe(original.timestamp);
    expect(parsed!.ssrc).toBe(original.ssrc);
    expect(parsed!.marker).toBe(original.marker);
    expect(parsed!.payload).toEqual(payload);
  });

  it('roundtrips with marker=false', () => {
    const payload = Buffer.alloc(160);
    const packet = buildRTPPacket({
      payloadType: 0,
      sequenceNumber: 100,
      timestamp: 16000,
      ssrc: 1,
      payload,
      marker: false,
    });
    const parsed = parseRTPPacket(packet);
    expect(parsed!.marker).toBe(false);
  });

  it('handles sequence number at max value (0xFFFF)', () => {
    const payload = Buffer.alloc(10);
    const packet = buildRTPPacket({
      payloadType: 0,
      sequenceNumber: 0xFFFF,
      timestamp: 0,
      ssrc: 0,
      payload,
    });
    const parsed = parseRTPPacket(packet);
    expect(parsed!.sequenceNumber).toBe(0xFFFF);
  });

  it('handles large timestamp values', () => {
    const payload = Buffer.alloc(10);
    const packet = buildRTPPacket({
      payloadType: 0,
      sequenceNumber: 0,
      timestamp: 0xFFFFFFFF,
      ssrc: 0,
      payload,
    });
    const parsed = parseRTPPacket(packet);
    expect(parsed!.timestamp).toBe(0xFFFFFFFF);
  });
});

describe('parseRTPPacket', () => {
  it('returns null for buffer smaller than 12 bytes', () => {
    expect(parseRTPPacket(Buffer.alloc(11))).toBeNull();
    expect(parseRTPPacket(Buffer.alloc(0))).toBeNull();
  });
});

describe('findDataChunk', () => {
  it('finds data chunk in a minimal WAV buffer', () => {
    // Build: RIFF....WAVEfmt ....data....
    const riff = Buffer.from('RIFF');
    const size = Buffer.alloc(4);
    const wave = Buffer.from('WAVE');
    const fmt = Buffer.from('fmt ');
    const fmtSize = Buffer.alloc(4);
    fmtSize.writeUInt32LE(16, 0);
    const fmtData = Buffer.alloc(16);
    const data = Buffer.from('data');
    const dataSize = Buffer.alloc(4);
    dataSize.writeUInt32LE(100, 0);
    const payload = Buffer.alloc(100);

    const totalSize = 4 + fmt.length + fmtSize.length + fmtData.length + data.length + dataSize.length + payload.length;
    size.writeUInt32LE(totalSize, 0);

    const buf = Buffer.concat([riff, size, wave, fmt, fmtSize, fmtData, data, dataSize, payload]);
    const result = findDataChunk(buf);

    expect(result).not.toBeNull();
    expect(result!.size).toBe(100);
    // offset should point past 'data' + size bytes
    expect(result!.offset).toBe(12 + 8 + 16 + 8); // RIFF header(12) + fmt chunk(8+16) + data header(8)
  });

  it('skips extra chunks (fact, LIST) before data', () => {
    // RIFF....WAVE fmt(24 bytes) fact(12 bytes) LIST(20 bytes) data(N bytes)
    const riff = Buffer.from('RIFF');
    const size = Buffer.alloc(4);
    const wave = Buffer.from('WAVE');

    const fmt = Buffer.from('fmt ');
    const fmtSize = Buffer.alloc(4);
    fmtSize.writeUInt32LE(18, 0); // extended fmt
    const fmtData = Buffer.alloc(18);

    const fact = Buffer.from('fact');
    const factSize = Buffer.alloc(4);
    factSize.writeUInt32LE(4, 0);
    const factData = Buffer.alloc(4);

    const list = Buffer.from('LIST');
    const listSize = Buffer.alloc(4);
    listSize.writeUInt32LE(12, 0);
    const listData = Buffer.alloc(12);

    const data = Buffer.from('data');
    const dataSize = Buffer.alloc(4);
    dataSize.writeUInt32LE(50, 0);
    const payload = Buffer.alloc(50);

    const totalSize = 4 + (8 + 18) + (8 + 4) + (8 + 12) + (8 + 50);
    size.writeUInt32LE(totalSize, 0);

    const buf = Buffer.concat([
      riff, size, wave,
      fmt, fmtSize, fmtData,
      fact, factSize, factData,
      list, listSize, listData,
      data, dataSize, payload,
    ]);

    const result = findDataChunk(buf);
    expect(result).not.toBeNull();
    expect(result!.size).toBe(50);
  });

  it('returns null for buffer too small', () => {
    expect(findDataChunk(Buffer.alloc(10))).toBeNull();
  });

  it('returns null when no data chunk exists', () => {
    const riff = Buffer.from('RIFF');
    const size = Buffer.alloc(4);
    size.writeUInt32LE(20, 0);
    const wave = Buffer.from('WAVE');
    const fmt = Buffer.from('fmt ');
    const fmtSize = Buffer.alloc(4);
    fmtSize.writeUInt32LE(16, 0);
    const fmtData = Buffer.alloc(16);

    const buf = Buffer.concat([riff, size, wave, fmt, fmtSize, fmtData]);
    expect(findDataChunk(buf)).toBeNull();
  });
});

describe('loadAudioSample', () => {
  const samplesDir = resolve(__dirname, '../../audio-samples');

  it('loads a real WAV file and returns correct buffer size', () => {
    const data = loadAudioSample(resolve(samplesDir, 'sine-440hz.wav'));
    expect(data).not.toBeNull();
    // 3 seconds at 8kHz = 24000 bytes of PCMU data
    expect(data!.length).toBe(24000);
  });

  it('loads voice-hello sample', () => {
    const data = loadAudioSample(resolve(samplesDir, 'voice-hello.wav'));
    expect(data).not.toBeNull();
    expect(data!.length).toBeGreaterThan(0);
  });

  it('returns null for nonexistent file', () => {
    expect(loadAudioSample('/nonexistent/file.wav')).toBeNull();
  });
});
