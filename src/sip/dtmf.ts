/**
 * RFC 4733 DTMF — encode, decode, detect telephone-event RTP packets.
 * Pure logic, no I/O, no timers, no console. Reusable across SIP and WebRTC.
 */

// Digit → RFC 4733 event code
export const DTMF_EVENT_MAP: Record<string, number> = {
  '0': 0, '1': 1, '2': 2, '3': 3, '4': 4,
  '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  '*': 10, '#': 11,
  'A': 12, 'B': 13, 'C': 14, 'D': 15,
  'a': 12, 'b': 13, 'c': 14, 'd': 15,
};

// Event code → digit (canonical uppercase)
export const DTMF_CODE_MAP: Record<number, string> = {
  0: '0', 1: '1', 2: '2', 3: '3', 4: '4',
  5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
  10: '*', 11: '#',
  12: 'A', 13: 'B', 14: 'C', 15: 'D',
};

export const DTMF_DEFAULTS = {
  payloadType: 101,
  clockRate: 8000,
  digitDurationMs: 160,
  interDigitGapMs: 100,
  packetIntervalMs: 50,
  volume: 10,
  endPacketCount: 3,
} as const;

export interface DtmfPayload {
  eventCode: number;
  endBit: boolean;
  volume: number;
  duration: number; // in timestamp units (clockRate ticks)
}

export interface DtmfPacketDescriptor {
  /** Milliseconds offset from start of this digit */
  timeOffsetMs: number;
  /** RTP marker bit — true on first packet */
  marker: boolean;
  /** End bit — true on final packets */
  endBit: boolean;
  /** Duration in timestamp units at this point */
  duration: number;
  /** The 4-byte payload */
  payload: Buffer;
}

export interface DtmfDetection {
  digit: string;
  duration: number; // timestamp units
  timestamp: number; // RTP timestamp of the event
}

/**
 * Build the 4-byte RFC 4733 telephone-event payload.
 *
 *   0                   1                   2                   3
 *   0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
 *  +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 *  |     event     |E|R| volume    |          duration             |
 *  +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 */
export function buildDtmfPayload(
  eventCode: number,
  endBit: boolean,
  volume: number,
  duration: number,
): Buffer {
  const buf = Buffer.alloc(4);
  buf[0] = eventCode & 0xFF;
  buf[1] = (endBit ? 0x80 : 0x00) | (volume & 0x3F);
  buf.writeUInt16BE(duration & 0xFFFF, 2);
  return buf;
}

/**
 * Parse a 4-byte RFC 4733 telephone-event payload.
 * Returns null if payload is not exactly 4 bytes.
 */
export function parseDtmfPayload(payload: Buffer): DtmfPayload | null {
  if (payload.length < 4) return null;
  return {
    eventCode: payload[0],
    endBit: (payload[1] & 0x80) !== 0,
    volume: payload[1] & 0x3F,
    duration: payload.readUInt16BE(2),
  };
}

/**
 * Plan all RTP packets needed to send one DTMF digit.
 * Returns a list of packet descriptors with timing offsets.
 * Caller is responsible for actual sending/timing.
 *
 * RFC 4733 rules:
 * - First packet has RTP marker bit set
 * - All packets for one digit share the same RTP timestamp
 * - Duration increases with each packet
 * - Last N packets have E-bit set (redundancy)
 * - Packets sent at packetIntervalMs intervals
 */
export function planDtmfDigit(
  eventCode: number,
  options?: Partial<typeof DTMF_DEFAULTS>,
): DtmfPacketDescriptor[] {
  const opts = { ...DTMF_DEFAULTS, ...options };
  const packets: DtmfPacketDescriptor[] = [];

  const totalDurationTicks = Math.floor(opts.digitDurationMs * opts.clockRate / 1000);
  const intervalTicks = Math.floor(opts.packetIntervalMs * opts.clockRate / 1000);

  // How many regular (non-end) packets?
  const numRegularPackets = Math.max(1, Math.floor(opts.digitDurationMs / opts.packetIntervalMs));

  // Regular packets (increasing duration, no E-bit)
  for (let i = 0; i < numRegularPackets; i++) {
    const duration = Math.min((i + 1) * intervalTicks, totalDurationTicks);
    packets.push({
      timeOffsetMs: i * opts.packetIntervalMs,
      marker: i === 0,
      endBit: false,
      duration,
      payload: buildDtmfPayload(eventCode, false, opts.volume, duration),
    });
  }

  // End packets (E-bit set, same final duration)
  for (let i = 0; i < opts.endPacketCount; i++) {
    packets.push({
      timeOffsetMs: numRegularPackets * opts.packetIntervalMs + i * opts.packetIntervalMs,
      marker: false,
      endBit: true,
      duration: totalDurationTicks,
      payload: buildDtmfPayload(eventCode, true, opts.volume, totalDurationTicks),
    });
  }

  return packets;
}

/**
 * Stateful DTMF detector for incoming RTP streams.
 * Deduplicates redundant end packets per RFC 4733.
 * Returns detected digit only once per event (on first E-bit packet).
 */
export class DtmfDetector {
  private lastEndTimestamp: number | null = null;
  private detections: DtmfDetection[] = [];

  /**
   * Feed an RTP packet to the detector.
   * @param payloadType - RTP payload type (skip if not telephone-event PT)
   * @param payload - The raw RTP payload (4 bytes for telephone-event)
   * @param rtpTimestamp - The RTP timestamp from the packet header
   * @param telephoneEventPt - Expected PT for telephone-event (default 101)
   * @returns Detection if a new digit was detected, null otherwise
   */
  feed(
    payloadType: number,
    payload: Buffer,
    rtpTimestamp: number,
    telephoneEventPt = DTMF_DEFAULTS.payloadType,
  ): DtmfDetection | null {
    if (payloadType !== telephoneEventPt) return null;

    const parsed = parseDtmfPayload(payload);
    if (!parsed) return null;

    // Only trigger on E-bit (end of digit)
    if (!parsed.endBit) return null;

    // Deduplicate: same RTP timestamp = same digit event
    if (this.lastEndTimestamp === rtpTimestamp) return null;
    this.lastEndTimestamp = rtpTimestamp;

    const digit = DTMF_CODE_MAP[parsed.eventCode];
    if (!digit) return null;

    const detection: DtmfDetection = {
      digit,
      duration: parsed.duration,
      timestamp: rtpTimestamp,
    };
    this.detections.push(detection);
    return detection;
  }

  /** All digits detected so far, concatenated */
  get digits(): string {
    return this.detections.map(d => d.digit).join('');
  }

  /** All detections */
  get allDetections(): readonly DtmfDetection[] {
    return this.detections;
  }

  /** Reset state */
  reset(): void {
    this.lastEndTimestamp = null;
    this.detections = [];
  }
}
