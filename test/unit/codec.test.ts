import { describe, it, expect } from 'vitest';
import {
  CODEC_TABLE,
  codecByPayloadType,
  codecByName,
  MULAW_TO_ALAW,
  ALAW_TO_MULAW,
  transcodePcmuTo,
} from '../../src/sip/codec.js';

describe('CODEC_TABLE', () => {
  it('has all four codecs', () => {
    expect(CODEC_TABLE.PCMU).toBeDefined();
    expect(CODEC_TABLE.PCMA).toBeDefined();
    expect(CODEC_TABLE.G722).toBeDefined();
    expect(CODEC_TABLE.opus).toBeDefined();
  });

  it('PCMU has correct properties', () => {
    const c = CODEC_TABLE.PCMU;
    expect(c.payloadType).toBe(0);
    expect(c.clockRate).toBe(8000);
    expect(c.sampleRate).toBe(8000);
    expect(c.packetSize).toBe(160);
    expect(c.wavFormatCode).toBe(7);
    expect(c.ffmpegCodec).toBe('pcm_mulaw');
  });

  it('PCMA has correct properties', () => {
    const c = CODEC_TABLE.PCMA;
    expect(c.payloadType).toBe(8);
    expect(c.clockRate).toBe(8000);
    expect(c.sampleRate).toBe(8000);
    expect(c.packetSize).toBe(160);
    expect(c.wavFormatCode).toBe(6);
    expect(c.ffmpegCodec).toBe('pcm_alaw');
  });

  it('G722 has correct properties', () => {
    const c = CODEC_TABLE.G722;
    expect(c.payloadType).toBe(9);
    expect(c.clockRate).toBe(8000); // RTP clock is 8000 per RFC 3551
    expect(c.sampleRate).toBe(16000);
    expect(c.wavFormatCode).toBe(0xFFFF);
    expect(c.ffmpegCodec).toBe('g722');
  });

  it('opus has correct properties', () => {
    const c = CODEC_TABLE.opus;
    expect(c.payloadType).toBe(111);
    expect(c.clockRate).toBe(48000);
    expect(c.sampleRate).toBe(48000);
    expect(c.ffmpegCodec).toBe('libopus');
  });

  it('all codecs have unique payload types', () => {
    const pts = Object.values(CODEC_TABLE).map(c => c.payloadType);
    expect(new Set(pts).size).toBe(pts.length);
  });
});

describe('codecByPayloadType', () => {
  it('finds PCMU by PT=0', () => {
    expect(codecByPayloadType(0)?.name).toBe('PCMU');
  });

  it('finds PCMA by PT=8', () => {
    expect(codecByPayloadType(8)?.name).toBe('PCMA');
  });

  it('finds G722 by PT=9', () => {
    expect(codecByPayloadType(9)?.name).toBe('G722');
  });

  it('finds opus by PT=111', () => {
    expect(codecByPayloadType(111)?.name).toBe('opus');
  });

  it('returns undefined for unknown PT', () => {
    expect(codecByPayloadType(99)).toBeUndefined();
  });
});

describe('codecByName', () => {
  it('finds PCMU by exact name', () => {
    expect(codecByName('PCMU')?.payloadType).toBe(0);
  });

  it('finds PCMA by exact name', () => {
    expect(codecByName('PCMA')?.payloadType).toBe(8);
  });

  it('finds G722 by exact name', () => {
    expect(codecByName('G722')?.payloadType).toBe(9);
  });

  it('finds opus by exact name', () => {
    expect(codecByName('opus')?.payloadType).toBe(111);
  });

  it('case-insensitive lookup', () => {
    expect(codecByName('pcmu')?.name).toBe('PCMU');
    expect(codecByName('pcma')?.name).toBe('PCMA');
    expect(codecByName('g722')?.name).toBe('G722');
    expect(codecByName('OPUS')?.name).toBe('opus');
  });

  it('returns undefined for unknown codec', () => {
    expect(codecByName('G729')).toBeUndefined();
  });
});

describe('MULAW_TO_ALAW / ALAW_TO_MULAW tables', () => {
  it('tables are 256 entries each', () => {
    expect(MULAW_TO_ALAW.length).toBe(256);
    expect(ALAW_TO_MULAW.length).toBe(256);
  });

  it('conversion tables produce valid output in full range', () => {
    // Verify both tables map every byte to a valid byte (no out-of-range)
    for (let i = 0; i < 256; i++) {
      expect(MULAW_TO_ALAW[i]).toBeGreaterThanOrEqual(0);
      expect(MULAW_TO_ALAW[i]).toBeLessThan(256);
      expect(ALAW_TO_MULAW[i]).toBeGreaterThanOrEqual(0);
      expect(ALAW_TO_MULAW[i]).toBeLessThan(256);
    }
  });

  it('known mu-law silence (0xFF) converts to A-law', () => {
    // 0xFF is digital silence in mu-law. After conversion it should be valid.
    const alaw = MULAW_TO_ALAW[0xFF];
    expect(alaw).toBeDefined();
    expect(typeof alaw).toBe('number');
  });
});

describe('transcodePcmuTo', () => {
  it('returns same buffer for PCMU → PCMU (identity)', () => {
    const data = Buffer.from([0x00, 0x7F, 0xFF, 0x80]);
    const result = transcodePcmuTo(data, CODEC_TABLE.PCMU);
    expect(result).toBe(data); // same reference
  });

  it('transcodes PCMU → PCMA via table lookup', () => {
    const data = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    const result = transcodePcmuTo(data, CODEC_TABLE.PCMA);

    expect(result.length).toBe(data.length);
    for (let i = 0; i < data.length; i++) {
      expect(result[i]).toBe(MULAW_TO_ALAW[data[i]]);
    }
  });

  it('handles empty buffer for PCMA transcoding', () => {
    const result = transcodePcmuTo(Buffer.alloc(0), CODEC_TABLE.PCMA);
    expect(result.length).toBe(0);
  });

  it('throws for unsupported codec instead of silent fallback', () => {
    const data = Buffer.from([0x42, 0x43]);
    const fakeCodec = { ...CODEC_TABLE.opus, name: 'UNKNOWN' };
    expect(() => transcodePcmuTo(data, fakeCodec)).toThrow('not implemented');
  });

  it('throws for opus (no transcoder yet)', () => {
    const data = Buffer.from([0x42, 0x43]);
    expect(() => transcodePcmuTo(data, CODEC_TABLE.opus)).toThrow('not implemented');
  });
});
