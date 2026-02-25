import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import dgram from 'dgram';
import {
  buildRTPPacket,
  parseRTPPacket,
  findDataChunk,
  loadAudioSample,
  sendRTPFromSocket,
  sendDtmfFromSocket,
  receiveRTPAudio,
} from '../../src/sip/rtp-receiver.js';
import { DtmfDetector, buildDtmfPayload, DTMF_DEFAULTS } from '../../src/sip/dtmf.js';

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

describe('sendRTPFromSocket return state', () => {
  it('returns ssrc, sequenceNumber, timestamp for stream continuity', async () => {
    const socket = dgram.createSocket('udp4');
    await new Promise<void>((resolve) => socket.bind(0, resolve));

    // 3 packets worth of PCMU (3 * 160 = 480 bytes)
    const pcmu = Buffer.alloc(480, 0x7F);
    const result = await sendRTPFromSocket(socket, pcmu, '127.0.0.1', socket.address().port);

    expect(result.packetsSent).toBe(3);
    expect(typeof result.ssrc).toBe('number');
    expect(typeof result.sequenceNumber).toBe('number');
    expect(typeof result.timestamp).toBe('number');

    socket.close();
  });

  it('returns zeros for empty data', async () => {
    const socket = dgram.createSocket('udp4');
    await new Promise<void>((resolve) => socket.bind(0, resolve));

    const result = await sendRTPFromSocket(socket, Buffer.alloc(0), '127.0.0.1', 5000);
    expect(result.packetsSent).toBe(0);

    socket.close();
  });

  it('accepts initial state for continuity', async () => {
    const socket = dgram.createSocket('udp4');
    await new Promise<void>((resolve) => socket.bind(0, resolve));

    const pcmu = Buffer.alloc(160, 0x7F); // 1 packet
    const result = await sendRTPFromSocket(socket, pcmu, '127.0.0.1', socket.address().port, {
      ssrc: 42,
      sequenceNumber: 100,
      timestamp: 8000,
    });

    expect(result.packetsSent).toBe(1);
    expect(result.ssrc).toBe(42);
    // After 1 packet: seq should be 101, ts should be 8000 + 160
    expect(result.sequenceNumber).toBe(101);
    expect(result.timestamp).toBe(8160);

    socket.close();
  });
});

describe('sendDtmfFromSocket', () => {
  it('sends packets for a single digit', async () => {
    const socket = dgram.createSocket('udp4');
    await new Promise<void>((resolve) => socket.bind(0, resolve));

    const sentDigits: string[] = [];
    const result = await sendDtmfFromSocket(
      socket, '5', '127.0.0.1', socket.address().port,
      { ssrc: 1, sequenceNumber: 0, timestamp: 0 },
      (digit) => sentDigits.push(digit),
    );

    expect(result.packetsSent).toBeGreaterThan(0);
    expect(sentDigits).toEqual(['5']);

    socket.close();
  });

  it('sends packets for multiple digits', async () => {
    const socket = dgram.createSocket('udp4');
    await new Promise<void>((resolve) => socket.bind(0, resolve));

    const sentDigits: string[] = [];
    const result = await sendDtmfFromSocket(
      socket, '12#', '127.0.0.1', socket.address().port,
      { ssrc: 1, sequenceNumber: 0, timestamp: 0 },
      (digit) => sentDigits.push(digit),
    );

    expect(result.packetsSent).toBeGreaterThan(0);
    expect(sentDigits).toEqual(['1', '2', '#']);

    socket.close();
  });

  it('returns unchanged state for empty digits', async () => {
    const socket = dgram.createSocket('udp4');
    await new Promise<void>((resolve) => socket.bind(0, resolve));

    const result = await sendDtmfFromSocket(
      socket, '', '127.0.0.1', 5000,
      { ssrc: 42, sequenceNumber: 10, timestamp: 1000 },
    );

    expect(result.packetsSent).toBe(0);
    expect(result.ssrc).toBe(42);
    expect(result.sequenceNumber).toBe(10);
    expect(result.timestamp).toBe(1000);

    socket.close();
  });

  it('advances timestamp between digits', async () => {
    const socket = dgram.createSocket('udp4');
    await new Promise<void>((resolve) => socket.bind(0, resolve));

    const result = await sendDtmfFromSocket(
      socket, '12', '127.0.0.1', socket.address().port,
      { ssrc: 1, sequenceNumber: 0, timestamp: 0 },
    );

    // After 2 digits: timestamp should advance past both digit durations + gaps
    expect(result.timestamp).toBeGreaterThan(0);

    socket.close();
  });
});

describe('receiveRTPAudio with DTMF detection', () => {
  it('detects DTMF digits in incoming packets', async () => {
    const socket = dgram.createSocket('udp4');
    await new Promise<void>((resolve) => socket.bind(0, resolve));
    const port = socket.address().port;

    const detector = new DtmfDetector();
    const detectedDigits: string[] = [];

    // Start receiver with short duration
    const receivePromise = receiveRTPAudio(socket, 0.3, {
      dtmfDetector: detector,
      onDtmf: (d) => detectedDigits.push(d.digit),
    });

    // Send a DTMF end packet (digit '5') via a separate socket
    const sender = dgram.createSocket('udp4');
    await new Promise<void>((resolve) => sender.bind(0, resolve));

    const dtmfPayload = buildDtmfPayload(5, true, 10, 1280);
    const rtpPacket = buildRTPPacket({
      payloadType: DTMF_DEFAULTS.payloadType,
      sequenceNumber: 1,
      timestamp: 1000,
      ssrc: 99,
      payload: dtmfPayload,
    });

    sender.send(rtpPacket, port, '127.0.0.1');

    const result = await receivePromise;

    expect(result.dtmfDigits).toBe('5');
    expect(detectedDigits).toEqual(['5']);
    // DTMF packets should NOT be counted as audio
    expect(result.packetsReceived).toBe(0);

    sender.close();
    socket.close();
  });

  it('receives audio and DTMF simultaneously', async () => {
    const socket = dgram.createSocket('udp4');
    await new Promise<void>((resolve) => socket.bind(0, resolve));
    const port = socket.address().port;

    const detector = new DtmfDetector();

    const receivePromise = receiveRTPAudio(socket, 0.3, {
      dtmfDetector: detector,
    });

    const sender = dgram.createSocket('udp4');
    await new Promise<void>((resolve) => sender.bind(0, resolve));

    // Send 1 PCMU audio packet
    const audioPacket = buildRTPPacket({
      payloadType: 0,
      sequenceNumber: 1,
      timestamp: 0,
      ssrc: 100,
      payload: Buffer.alloc(160, 0x7F),
    });
    sender.send(audioPacket, port, '127.0.0.1');

    // Send 1 DTMF end packet (digit '#')
    const dtmfPayload = buildDtmfPayload(11, true, 10, 1280);
    const dtmfPacket = buildRTPPacket({
      payloadType: DTMF_DEFAULTS.payloadType,
      sequenceNumber: 2,
      timestamp: 2000,
      ssrc: 100,
      payload: dtmfPayload,
    });
    sender.send(dtmfPacket, port, '127.0.0.1');

    const result = await receivePromise;

    expect(result.packetsReceived).toBe(1); // only PCMU counted
    expect(result.dtmfDigits).toBe('#');

    sender.close();
    socket.close();
  });

  it('returns empty dtmfDigits when no detector provided', async () => {
    const socket = dgram.createSocket('udp4');
    await new Promise<void>((resolve) => socket.bind(0, resolve));

    const result = await receiveRTPAudio(socket, 0.1);
    expect(result.dtmfDigits).toBe('');

    socket.close();
  });

  it('backward-compatible: still accepts outputFile as string', async () => {
    const socket = dgram.createSocket('udp4');
    await new Promise<void>((resolve) => socket.bind(0, resolve));

    // Call with string param (old API) — should not throw
    const result = await receiveRTPAudio(socket, 0.1, '/tmp/test-output-rtp.raw');
    expect(result.dtmfDigits).toBe('');
    expect(result.packetsReceived).toBe(0);

    socket.close();
  });
});
