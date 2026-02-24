import dgram from 'dgram';
import { writeFileSync, readFileSync, existsSync } from 'fs';

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

/**
 * Send RTP packets from an existing dgram socket at 20ms intervals.
 * Uses PCMU (PT=0): 160 bytes per packet = 20ms at 8kHz.
 */
export function sendRTPFromSocket(
  socket: dgram.Socket,
  pcmuData: Buffer,
  remoteIp: string,
  remotePort: number
): Promise<{ packetsSent: number }> {
  return new Promise((resolve) => {
    if (pcmuData.length === 0) {
      resolve({ packetsSent: 0 });
      return;
    }

    const PACKET_SIZE = 160; // 20ms at 8kHz
    const ssrc = (Math.random() * 0xFFFFFFFF) >>> 0;
    let sequenceNumber = (Math.random() * 0xFFFF) >>> 0;
    let timestamp = (Math.random() * 0xFFFFFFFF) >>> 0;
    let offset = 0;
    let packetsSent = 0;
    let isFirst = true;

    const interval = setInterval(() => {
      if (offset >= pcmuData.length) {
        clearInterval(interval);
        resolve({ packetsSent });
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
 * Receive RTP audio on an existing socket
 */
export async function receiveRTPAudio(
  socket: dgram.Socket,
  duration: number,
  outputFile?: string
): Promise<{ packetsReceived: number; audioData: Buffer[] }> {
  return new Promise((resolve) => {
    const audioData: Buffer[] = [];
    let packetsReceived = 0;

    const messageHandler = (msg: Buffer) => {
      const packet = parseRTPPacket(msg);
      if (packet && packet.payloadType === 0) { // PCMU
        audioData.push(packet.payload);
        packetsReceived++;
      }
    };

    socket.on('message', messageHandler);

    // Stop after duration
    setTimeout(() => {
      socket.off('message', messageHandler);

      // Save to file if requested
      if (outputFile && audioData.length > 0) {
        const combinedAudio = Buffer.concat(audioData);
        writeFileSync(outputFile, combinedAudio);
      }

      resolve({ packetsReceived, audioData });
    }, duration * 1000);
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
