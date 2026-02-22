import dgram from 'dgram';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

/**
 * RTP packet structure
 */
interface RTPPacket {
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
function parseRTPPacket(buffer: Buffer): RTPPacket | null {
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
 * Receive RTP audio and save to file
 */
export async function receiveRTPAudio(
  port: number,
  duration: number,
  outputFile?: string
): Promise<{ packetsReceived: number; audioData: Buffer[] }> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    const audioData: Buffer[] = [];
    let packetsReceived = 0;

    socket.on('message', (msg) => {
      const packet = parseRTPPacket(msg);
      if (packet && packet.payloadType === 0) { // PCMU
        audioData.push(packet.payload);
        packetsReceived++;
      }
    });

    socket.on('error', (err) => {
      console.error('RTP receiver error:', err);
      socket.close();
      resolve({ packetsReceived, audioData });
    });

    socket.bind(port, () => {
      // Stop after duration
      setTimeout(() => {
        socket.close();

        // Save to file if requested
        if (outputFile && audioData.length > 0) {
          const combinedAudio = Buffer.concat(audioData);
          writeFileSync(outputFile, combinedAudio);
        }

        resolve({ packetsReceived, audioData });
      }, duration * 1000);
    });
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
