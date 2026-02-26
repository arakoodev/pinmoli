/**
 * SDP (Session Description Protocol) builder and parser
 */

import { codecByPayloadType, codecByName, CODEC_TABLE, type CodecInfo } from './codec.js';

export interface SdpAnswerResult {
  codec: CodecInfo;
  remoteIp: string;
  remotePort: number;
}

interface SdpOptions {
  sessionId: string;
  sessionVersion: string;
  origin: string;
  connection: string;
  mediaPort: number;
  codecs: string[];
}

export function buildSdp(options: SdpOptions): string {
  const { sessionId, sessionVersion, origin, connection, mediaPort, codecs } = options;
  
  const lines = [
    'v=0',
    `o=Pinmoli ${sessionId} ${sessionVersion} IN IP4 ${origin}`,
    's=-',
    `c=IN IP4 ${connection}`,
    't=0 0',
  ];

  const payloadTypes: number[] = [];
  const rtpmapLines: string[] = [];

  if (codecs.includes('opus')) {
    payloadTypes.push(111);
    rtpmapLines.push('a=rtpmap:111 opus/48000/2');
    rtpmapLines.push('a=fmtp:111 minptime=10;useinbandfec=1');
  }
  if (codecs.includes('PCMU')) {
    payloadTypes.push(0);
    rtpmapLines.push('a=rtpmap:0 PCMU/8000');
  }
  if (codecs.includes('PCMA')) {
    payloadTypes.push(8);
    rtpmapLines.push('a=rtpmap:8 PCMA/8000');
  }
  if (codecs.includes('G722')) {
    payloadTypes.push(9);
    rtpmapLines.push('a=rtpmap:9 G722/8000');
  }

  // Always include telephone-event (RFC 4733)
  payloadTypes.push(101);
  rtpmapLines.push('a=rtpmap:101 telephone-event/8000');
  rtpmapLines.push('a=fmtp:101 0-15');

  lines.push(`m=audio ${mediaPort} RTP/AVP ${payloadTypes.join(' ')}`);
  lines.push(...rtpmapLines);
  lines.push('a=sendrecv');

  return lines.join('\r\n') + '\r\n';
}

/**
 * Parse an SDP answer to extract the negotiated codec, remote IP, and remote port.
 * Reads the m=audio line for payload types, a=rtpmap lines for codec names.
 * Skips telephone-event. Returns the first audio codec as CodecInfo.
 * Falls back to PCMU if no recognized codec is found.
 */
export function parseSdpAnswer(sdp: string, fallbackIp: string, fallbackPort: number): SdpAnswerResult {
  // Extract remote IP from c= line
  const cMatch = sdp.match(/c=IN IP4 ([\d.]+)/);
  const remoteIp = cMatch ? cMatch[1] : fallbackIp;

  // Extract remote port from m=audio line
  const mMatch = sdp.match(/m=audio (\d+)/);
  const remotePort = mMatch ? parseInt(mMatch[1]) : fallbackPort;

  // Parse payload types from m=audio line
  const mLineMatch = sdp.match(/m=audio \d+ \S+ (.+)/);
  if (!mLineMatch) {
    return { codec: CODEC_TABLE.PCMU, remoteIp, remotePort };
  }

  const payloadTypes = mLineMatch[1].trim().split(/\s+/).map(Number);

  // Build a map of PT → codec name from a=rtpmap lines
  const rtpmapEntries: Array<{ pt: number; name: string }> = [];
  const rtpmapRegex = /a=rtpmap:(\d+) ([^\s/]+)/g;
  let match;
  while ((match = rtpmapRegex.exec(sdp)) !== null) {
    rtpmapEntries.push({ pt: parseInt(match[1]), name: match[2] });
  }

  // Walk payload types in order, find first audio codec (skip telephone-event)
  for (const pt of payloadTypes) {
    const rtpmap = rtpmapEntries.find(e => e.pt === pt);
    if (rtpmap) {
      // Skip telephone-event
      if (rtpmap.name.toLowerCase() === 'telephone-event') continue;
      // Try to match by name
      const codec = codecByName(rtpmap.name);
      if (codec) return { codec, remoteIp, remotePort };
    } else {
      // No rtpmap line — try well-known static PT
      // Skip telephone-event PT (101 is common, but also check others)
      const codec = codecByPayloadType(pt);
      if (codec) return { codec, remoteIp, remotePort };
    }
  }

  // Fallback to PCMU
  return { codec: CODEC_TABLE.PCMU, remoteIp, remotePort };
}

export function normalizeSdpLineEndings(sdp: string): string {
  // Strip any existing \r to avoid double-CR, then replace all \n with \r\n
  return sdp.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
}
