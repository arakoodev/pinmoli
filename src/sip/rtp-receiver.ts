import dgram from 'dgram';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import {
  DTMF_EVENT_MAP,
  DTMF_DEFAULTS,
  planDtmfDigit,
  DtmfDetector,
  type DtmfDetection,
} from './dtmf.js';

/**
 * RTP packet structure
 */
export interface RTPPacket {
  version: number;
  padding: boolean;
  extension: boolean;
  csrcCount: number;
  marker: boolean;
  payloadType: number;
  sequenceNumber: number;
  timestamp: number;
  ssrc: number;
  payload: Buffer;
}

/**
 * Parse RTP packet
 */
export function parseRTPPacket(buffer: Buffer): RTPPacket | null {
  if (buffer.length < 12) return null;

  const byte0 = buffer[0];
  const byte1 = buffer[1];

  return {
    version: (byte0 >> 6) & 0x03,
    padding: ((byte0 >> 5) & 0x01) === 1,
    extension: ((byte0 >> 4) & 0x01) === 1,
    csrcCount: byte0 & 0x0f,
    marker: ((byte1 >> 7) & 0x01) === 1,
    payloadType: byte1 & 0x7f,
    sequenceNumber: buffer.readUInt16BE(2),
    timestamp: buffer.readUInt32BE(4),
    ssrc: buffer.readUInt32BE(8),
    payload: buffer.slice(12)
  };
}

/**
 * Build an RTP packet from components
 */
export function buildRTPPacket(options: {
  payloadType: number;
  sequenceNumber: number;
  timestamp: number;
  ssrc: number;
  payload: Buffer;
  marker?: boolean;
}): Buffer {
  const header = Buffer.alloc(12);

  // Byte 0: V=2, P=0, X=0, CC=0 → 0x80
  header[0] = 0x80;

  // Byte 1: M bit + PT
  header[1] = (options.marker ? 0x80 : 0x00) | (options.payloadType & 0x7f);

  // Bytes 2-3: sequence number
  header.writeUInt16BE(options.sequenceNumber & 0xFFFF, 2);

  // Bytes 4-7: timestamp
  header.writeUInt32BE(options.timestamp >>> 0, 4);

  // Bytes 8-11: SSRC
  header.writeUInt32BE(options.ssrc >>> 0, 8);

  return Buffer.concat([header, options.payload]);
}

/**
 * Find the 'data' subchunk in a WAV file buffer.
 * WAV files may include fmt, fact, LIST, and other chunks before data.
 */
export function findDataChunk(buf: Buffer): { offset: number; size: number } | null {
  if (buf.length < 12) return null;
  let pos = 12; // skip RIFF header (4 bytes 'RIFF' + 4 bytes size + 4 bytes 'WAVE')
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === 'data') return { offset: pos + 8, size };
    pos += 8 + size;
  }
  return null;
}

/**
 * Load raw PCMU audio data from a WAV file.
 * Properly scans for the data chunk instead of assuming a 44-byte header.
 */
export function loadAudioSample(filePath: string): Buffer | null {
  if (!existsSync(filePath)) return null;

  const buf = readFileSync(filePath);

  const chunk = findDataChunk(buf);
  if (!chunk) return null;

  return buf.slice(chunk.offset, chunk.offset + chunk.size);
}

/** RTP stream state returned by sendRTPFromSocket for continuity */
export interface RtpStreamState {
  packetsSent: number;
  ssrc: number;
  sequenceNumber: number;
  timestamp: number;
}

/**
 * Send RTP packets from an existing dgram socket at 20ms intervals.
 * Uses PCMU (PT=0): 160 bytes per packet = 20ms at 8kHz.
 *
 * Accepts optional initial state for SSRC/seq/ts continuity (e.g. for DTMF after audio).
 * Returns final stream state so callers can continue the stream.
 */
export function sendRTPFromSocket(
  socket: dgram.Socket,
  pcmuData: Buffer,
  remoteIp: string,
  remotePort: number,
  initialState?: Partial<Pick<RtpStreamState, 'ssrc' | 'sequenceNumber' | 'timestamp'>>
): Promise<RtpStreamState> {
  return new Promise((resolve) => {
    if (pcmuData.length === 0) {
      resolve({
        packetsSent: 0,
        ssrc: initialState?.ssrc ?? 0,
        sequenceNumber: initialState?.sequenceNumber ?? 0,
        timestamp: initialState?.timestamp ?? 0,
      });
      return;
    }

    const PACKET_SIZE = 160; // 20ms at 8kHz
    const ssrc = initialState?.ssrc ?? ((Math.random() * 0xFFFFFFFF) >>> 0);
    let sequenceNumber = initialState?.sequenceNumber ?? ((Math.random() * 0xFFFF) >>> 0);
    let timestamp = initialState?.timestamp ?? ((Math.random() * 0xFFFFFFFF) >>> 0);
    let offset = 0;
    let packetsSent = 0;
    let isFirst = !initialState; // only mark first if starting fresh

    const interval = setInterval(() => {
      if (offset >= pcmuData.length) {
        clearInterval(interval);
        resolve({ packetsSent, ssrc, sequenceNumber, timestamp });
        return;
      }

      const end = Math.min(offset + PACKET_SIZE, pcmuData.length);
      const payload = pcmuData.slice(offset, end);

      const packet = buildRTPPacket({
        payloadType: 0, // PCMU
        sequenceNumber,
        timestamp,
        ssrc,
        payload,
        marker: isFirst,
      });

      socket.send(packet, remotePort, remoteIp, () => {
        // Packet loss is normal in RTP — silently continue
      });

      packetsSent++;
      isFirst = false;
      offset = end;
      sequenceNumber = (sequenceNumber + 1) & 0xFFFF;
      timestamp = (timestamp + PACKET_SIZE) >>> 0;
    }, 20);
  });
}

/**
 * Send RFC 4733 DTMF digits over an existing dgram socket.
 * Uses planDtmfDigit() for packet planning, buildRTPPacket() for framing.
 * All setTimeout calls get .unref().
 *
 * @param streamState - SSRC/seq/ts from prior audio send for stream continuity
 */
export function sendDtmfFromSocket(
  socket: dgram.Socket,
  digits: string,
  remoteIp: string,
  remotePort: number,
  streamState: Pick<RtpStreamState, 'ssrc' | 'sequenceNumber' | 'timestamp'>,
  onDigitSent?: (digit: string, eventCode: number) => void,
): Promise<RtpStreamState> {
  return new Promise((resolve) => {
    if (digits.length === 0) {
      resolve({ packetsSent: 0, ...streamState });
      return;
    }

    let { ssrc, sequenceNumber, timestamp } = streamState;
    let packetsSent = 0;
    let digitIndex = 0;

    function sendNextDigit(): void {
      if (digitIndex >= digits.length) {
        resolve({ packetsSent, ssrc, sequenceNumber, timestamp });
        return;
      }

      const digit = digits[digitIndex];
      const eventCode = DTMF_EVENT_MAP[digit];
      if (eventCode === undefined) {
        // Skip invalid digits
        digitIndex++;
        sendNextDigit();
        return;
      }

      const packets = planDtmfDigit(eventCode);
      // All packets for this digit share the same RTP timestamp
      const digitTimestamp = timestamp;
      let pktIndex = 0;

      function sendNextPacket(): void {
        if (pktIndex >= packets.length) {
          // Advance timestamp past this digit + inter-digit gap
          const totalMs = DTMF_DEFAULTS.digitDurationMs + DTMF_DEFAULTS.interDigitGapMs;
          timestamp = (digitTimestamp + Math.floor(totalMs * DTMF_DEFAULTS.clockRate / 1000)) >>> 0;

          onDigitSent?.(digit, eventCode);
          digitIndex++;
          sendNextDigit();
          return;
        }

        const desc = packets[pktIndex];
        const packet = buildRTPPacket({
          payloadType: DTMF_DEFAULTS.payloadType,
          sequenceNumber,
          timestamp: digitTimestamp,
          ssrc,
          payload: desc.payload,
          marker: desc.marker,
        });

        socket.send(packet, remotePort, remoteIp, () => {});

        packetsSent++;
        sequenceNumber = (sequenceNumber + 1) & 0xFFFF;
        pktIndex++;

        if (pktIndex < packets.length) {
          const nextOffset = packets[pktIndex].timeOffsetMs;
          const delay = nextOffset - desc.timeOffsetMs;
          const timer = setTimeout(sendNextPacket, delay);
          timer.unref();
        } else {
          // After last end packet, wait inter-digit gap then move to next digit
          const timer = setTimeout(sendNextPacket, DTMF_DEFAULTS.interDigitGapMs);
          timer.unref();
        }
      }

      sendNextPacket();
    }

    sendNextDigit();
  });
}

/** Options for receiveRTPAudio DTMF detection */
export interface ReceiveRtpOptions {
  dtmfDetector?: DtmfDetector;
  onDtmf?: (detection: DtmfDetection) => void;
}

/**
 * Receive RTP audio on an existing socket.
 * Optionally detects DTMF via DtmfDetector (feeds PT 101 packets).
 */
export async function receiveRTPAudio(
  socket: dgram.Socket,
  duration: number,
  outputFileOrOptions?: string | ReceiveRtpOptions,
  options?: ReceiveRtpOptions,
): Promise<{ packetsReceived: number; audioData: Buffer[]; dtmfDigits: string }> {
  // Resolve overloaded params: (socket, duration, outputFile?, options?) or (socket, duration, options?)
  let outputFile: string | undefined;
  let opts: ReceiveRtpOptions | undefined;
  if (typeof outputFileOrOptions === 'string') {
    outputFile = outputFileOrOptions;
    opts = options;
  } else if (outputFileOrOptions && typeof outputFileOrOptions === 'object') {
    opts = outputFileOrOptions;
  }

  return new Promise((resolve) => {
    const audioData: Buffer[] = [];
    let packetsReceived = 0;
    const detector = opts?.dtmfDetector;

    const messageHandler = (msg: Buffer) => {
      const packet = parseRTPPacket(msg);
      if (!packet) return;

      // Feed DTMF detector (PT 101)
      if (detector) {
        const detection = detector.feed(packet.payloadType, packet.payload, packet.timestamp);
        if (detection) {
          opts?.onDtmf?.(detection);
        }
      }

      // Only accumulate PCMU audio
      if (packet.payloadType === 0) {
        audioData.push(packet.payload);
        packetsReceived++;
      }
    };

    socket.on('message', messageHandler);

    // Stop after duration
    const timer = setTimeout(() => {
      socket.off('message', messageHandler);

      // Save to file if requested
      if (outputFile && audioData.length > 0) {
        const combinedAudio = Buffer.concat(audioData);
        writeFileSync(outputFile, combinedAudio);
      }

      resolve({
        packetsReceived,
        audioData,
        dtmfDigits: detector?.digits ?? '',
      });
    }, duration * 1000);
    timer.unref();
  });
}

/**
 * Save RTP audio as WAV file
 */
export function saveAsWAV(audioData: Buffer[], outputPath: string): void {
  const combinedAudio = Buffer.concat(audioData);

  // WAV header for PCMU 8kHz mono
  const wavHeader = Buffer.alloc(44);

  // RIFF header
  wavHeader.write('RIFF', 0);
  wavHeader.writeUInt32LE(36 + combinedAudio.length, 4);
  wavHeader.write('WAVE', 8);

  // fmt chunk
  wavHeader.write('fmt ', 12);
  wavHeader.writeUInt32LE(16, 16); // chunk size
  wavHeader.writeUInt16LE(7, 20); // format (7 = PCMU)
  wavHeader.writeUInt16LE(1, 22); // channels
  wavHeader.writeUInt32LE(8000, 24); // sample rate
  wavHeader.writeUInt32LE(8000, 28); // byte rate
  wavHeader.writeUInt16LE(1, 32); // block align
  wavHeader.writeUInt16LE(8, 34); // bits per sample

  // data chunk
  wavHeader.write('data', 36);
  wavHeader.writeUInt32LE(combinedAudio.length, 40);

  const wavFile = Buffer.concat([wavHeader, combinedAudio]);
  writeFileSync(outputPath, wavFile);
}
