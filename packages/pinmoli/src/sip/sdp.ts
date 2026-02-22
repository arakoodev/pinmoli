/**
 * SDP (Session Description Protocol) builder
 */

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

  // Always include telephone-event
  payloadTypes.push(101);
  rtpmapLines.push('a=rtpmap:101 telephone-event/8000');

  lines.push(`m=audio ${mediaPort} RTP/AVP ${payloadTypes.join(' ')}`);
  lines.push(...rtpmapLines);
  lines.push('a=sendrecv');

  return lines.join('\r\n') + '\r\n';
}

export function normalizeSdpLineEndings(sdp: string): string {
  // Strip any existing \r to avoid double-CR, then replace all \n with \r\n
  return sdp.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
}
