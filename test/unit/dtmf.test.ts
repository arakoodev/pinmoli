import { describe, it, expect } from 'vitest';
import {
  DTMF_EVENT_MAP,
  DTMF_CODE_MAP,
  DTMF_DEFAULTS,
  buildDtmfPayload,
  parseDtmfPayload,
  planDtmfDigit,
  DtmfDetector,
} from '../../src/sip/dtmf.js';

describe('DTMF Event Maps', () => {
  it('maps all 16 events (0-9, *, #, A-D)', () => {
    const codes = new Set(Object.values(DTMF_EVENT_MAP));
    // 0-15 inclusive = 16 codes (lowercase a-d map to same codes as A-D)
    expect(codes.size).toBe(16);
    for (let i = 0; i <= 15; i++) {
      expect(codes.has(i)).toBe(true);
    }
  });

  it('DTMF_CODE_MAP is inverse of DTMF_EVENT_MAP for uppercase', () => {
    for (const [digit, code] of Object.entries(DTMF_EVENT_MAP)) {
      if (digit >= 'a' && digit <= 'd') continue; // skip lowercase aliases
      expect(DTMF_CODE_MAP[code]).toBe(digit);
    }
  });

  it('lowercase a-d map to same codes as uppercase', () => {
    expect(DTMF_EVENT_MAP['a']).toBe(DTMF_EVENT_MAP['A']);
    expect(DTMF_EVENT_MAP['b']).toBe(DTMF_EVENT_MAP['B']);
    expect(DTMF_EVENT_MAP['c']).toBe(DTMF_EVENT_MAP['C']);
    expect(DTMF_EVENT_MAP['d']).toBe(DTMF_EVENT_MAP['D']);
  });
});

describe('buildDtmfPayload / parseDtmfPayload', () => {
  it('roundtrips all fields', () => {
    const buf = buildDtmfPayload(5, false, 10, 1280);
    expect(buf.length).toBe(4);

    const parsed = parseDtmfPayload(buf);
    expect(parsed).not.toBeNull();
    expect(parsed!.eventCode).toBe(5);
    expect(parsed!.endBit).toBe(false);
    expect(parsed!.volume).toBe(10);
    expect(parsed!.duration).toBe(1280);
  });

  it('encodes E-bit correctly', () => {
    const withEnd = buildDtmfPayload(1, true, 10, 800);
    const parsed = parseDtmfPayload(withEnd);
    expect(parsed!.endBit).toBe(true);

    const withoutEnd = buildDtmfPayload(1, false, 10, 800);
    const parsed2 = parseDtmfPayload(withoutEnd);
    expect(parsed2!.endBit).toBe(false);
  });

  it('preserves volume in 6-bit range', () => {
    const buf = buildDtmfPayload(0, false, 63, 100);
    const parsed = parseDtmfPayload(buf);
    expect(parsed!.volume).toBe(63);
  });

  it('preserves duration at max (0xFFFF)', () => {
    const buf = buildDtmfPayload(0, false, 0, 0xFFFF);
    const parsed = parseDtmfPayload(buf);
    expect(parsed!.duration).toBe(0xFFFF);
  });

  it('returns null for payload shorter than 4 bytes', () => {
    expect(parseDtmfPayload(Buffer.alloc(3))).toBeNull();
    expect(parseDtmfPayload(Buffer.alloc(0))).toBeNull();
  });
});

describe('planDtmfDigit', () => {
  it('produces correct packet count with defaults', () => {
    // 160ms digit / 50ms interval = ~3 regular + 3 end = 6 packets
    const packets = planDtmfDigit(1);
    const regular = packets.filter(p => !p.endBit);
    const end = packets.filter(p => p.endBit);

    expect(regular.length).toBeGreaterThanOrEqual(1);
    expect(end.length).toBe(DTMF_DEFAULTS.endPacketCount);
  });

  it('first packet has marker bit set', () => {
    const packets = planDtmfDigit(5);
    expect(packets[0].marker).toBe(true);
    // Subsequent non-end packets should not have marker
    if (packets.length > 1) {
      expect(packets[1].marker).toBe(false);
    }
  });

  it('end packets have E-bit set and same final duration', () => {
    const packets = planDtmfDigit(0);
    const endPackets = packets.filter(p => p.endBit);

    expect(endPackets.length).toBe(3);
    const durations = endPackets.map(p => p.duration);
    expect(new Set(durations).size).toBe(1); // all same duration

    // Final duration should equal total duration
    const totalTicks = Math.floor(DTMF_DEFAULTS.digitDurationMs * DTMF_DEFAULTS.clockRate / 1000);
    expect(durations[0]).toBe(totalTicks);
  });

  it('duration increases across regular packets', () => {
    const packets = planDtmfDigit(2);
    const regular = packets.filter(p => !p.endBit);

    for (let i = 1; i < regular.length; i++) {
      expect(regular[i].duration).toBeGreaterThan(regular[i - 1].duration);
    }
  });

  it('payload is parseable in every packet', () => {
    const packets = planDtmfDigit(11); // '#'
    for (const pkt of packets) {
      const parsed = parseDtmfPayload(pkt.payload);
      expect(parsed).not.toBeNull();
      expect(parsed!.eventCode).toBe(11);
    }
  });

  it('respects custom options', () => {
    const packets = planDtmfDigit(1, {
      digitDurationMs: 100,
      packetIntervalMs: 20,
      endPacketCount: 2,
      volume: 5,
    });

    const endPackets = packets.filter(p => p.endBit);
    expect(endPackets.length).toBe(2);

    const parsed = parseDtmfPayload(packets[0].payload);
    expect(parsed!.volume).toBe(5);
  });
});

describe('DtmfDetector', () => {
  it('detects a digit on first E-bit packet', () => {
    const detector = new DtmfDetector();
    const ts = 1000;

    // Regular packet — no detection
    const regular = buildDtmfPayload(5, false, 10, 400);
    expect(detector.feed(101, regular, ts)).toBeNull();

    // End packet — detection
    const end = buildDtmfPayload(5, true, 10, 1280);
    const result = detector.feed(101, end, ts);
    expect(result).not.toBeNull();
    expect(result!.digit).toBe('5');
    expect(result!.duration).toBe(1280);
  });

  it('deduplicates redundant end packets (same RTP timestamp)', () => {
    const detector = new DtmfDetector();
    const ts = 2000;
    const end = buildDtmfPayload(1, true, 10, 1280);

    // First end packet — detection
    expect(detector.feed(101, end, ts)).not.toBeNull();
    // Second end packet, same timestamp — deduplicated
    expect(detector.feed(101, end, ts)).toBeNull();
    // Third end packet, same timestamp — deduplicated
    expect(detector.feed(101, end, ts)).toBeNull();

    expect(detector.digits).toBe('1');
  });

  it('detects multi-digit sequence', () => {
    const detector = new DtmfDetector();

    // Digit '1' at timestamp 1000
    const end1 = buildDtmfPayload(1, true, 10, 1280);
    detector.feed(101, end1, 1000);

    // Digit '2' at timestamp 3000 (different timestamp = new digit)
    const end2 = buildDtmfPayload(2, true, 10, 1280);
    detector.feed(101, end2, 3000);

    // Digit '#' at timestamp 5000
    const endHash = buildDtmfPayload(11, true, 10, 1280);
    detector.feed(101, endHash, 5000);

    expect(detector.digits).toBe('12#');
    expect(detector.allDetections).toHaveLength(3);
  });

  it('ignores non-telephone-event payload types', () => {
    const detector = new DtmfDetector();
    const end = buildDtmfPayload(5, true, 10, 1280);

    // PT 0 (PCMU) — should be ignored
    expect(detector.feed(0, end, 1000)).toBeNull();
    expect(detector.digits).toBe('');
  });

  it('ignores unknown event codes', () => {
    const detector = new DtmfDetector();
    const end = buildDtmfPayload(99, true, 10, 1280); // code 99 is not in DTMF_CODE_MAP
    expect(detector.feed(101, end, 1000)).toBeNull();
  });

  it('supports custom telephone-event PT', () => {
    const detector = new DtmfDetector();
    const end = buildDtmfPayload(3, true, 10, 1280);

    // Default PT 101 — ignored for PT 96
    expect(detector.feed(96, end, 1000, 96)).not.toBeNull();
    expect(detector.digits).toBe('3');
  });

  it('reset clears state', () => {
    const detector = new DtmfDetector();
    const end = buildDtmfPayload(1, true, 10, 1280);
    detector.feed(101, end, 1000);
    expect(detector.digits).toBe('1');

    detector.reset();
    expect(detector.digits).toBe('');
    expect(detector.allDetections).toHaveLength(0);
  });
});
