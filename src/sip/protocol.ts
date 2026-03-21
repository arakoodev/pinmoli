/**
 * SIP protocol message building
 */

const SIP_RESERVED_HEADERS = new Set([
  'to', 'from', 'call-id', 'cseq', 'contact', 'via', 'max-forwards',
]);

export function mergeCustomHeaders(
  baseHeaders: Record<string, string>,
  customHeaders: Record<string, string>
): { headers: Record<string, string>; warnings: string[] } {
  const merged = { ...baseHeaders };
  const warnings: string[] = [];

  for (const [key, value] of Object.entries(customHeaders)) {
    if (SIP_RESERVED_HEADERS.has(key.toLowerCase())) {
      warnings.push(`Custom header "${key}" ignored — overwriting transaction-critical SIP headers is not allowed.`);
      continue;
    }
    merged[key] = value;
  }

  return { headers: merged, warnings };
}

export function generateCallId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}@pinmoli`;
}

export function generateTag(): string {
  return Math.random().toString(36).substr(2, 9);
}

export function buildOptionsRequest(uri: string, host: string, port: number, callId: string, fromTag: string, branch: string, localIp: string, localPort: number): string {
  return [
    `OPTIONS ${uri} SIP/2.0`,
    `Via: SIP/2.0/UDP ${localIp}:${localPort};rport;branch=${branch}`,
    `From: <sip:pinmoli@pinmoli.local>;tag=${fromTag}`,
    `To: <${uri}>`,
    `Call-ID: ${callId}`,
    `CSeq: 1 OPTIONS`,
    `Contact: <sip:pinmoli@${localIp}:${localPort}>`,
    `Max-Forwards: 70`,
    `User-Agent: Pinmoli/0.1.0`,
    `Content-Length: 0`,
    '',
    ''
  ].join('\r\n');
}

export function buildInviteRequest(uri: string, host: string, port: number, callId: string, fromTag: string, branch: string, sdp: string, localIp: string, localPort: number): string {
  return [
    `INVITE ${uri} SIP/2.0`,
    `Via: SIP/2.0/UDP ${localIp}:${localPort};rport;branch=${branch}`,
    `From: <sip:pinmoli@pinmoli.local>;tag=${fromTag}`,
    `To: <${uri}>`,
    `Call-ID: ${callId}`,
    `CSeq: 1 INVITE`,
    `Contact: <sip:pinmoli@${localIp}:${localPort}>`,
    `Max-Forwards: 70`,
    `User-Agent: Pinmoli/0.1.0`,
    `Content-Type: application/sdp`,
    `Content-Length: ${sdp.length}`,
    '',
    sdp
  ].join('\r\n');
}

export function buildAckRequest(uri: string, host: string, port: number, callId: string, fromTag: string, toTag: string, branch: string, localIp: string, localPort: number): string {
  return [
    `ACK ${uri} SIP/2.0`,
    `Via: SIP/2.0/UDP ${localIp}:${localPort};rport;branch=${branch}`,
    `From: <sip:pinmoli@pinmoli.local>;tag=${fromTag}`,
    `To: <${uri}>${toTag ? `;tag=${toTag}` : ''}`,
    `Call-ID: ${callId}`,
    `CSeq: 1 ACK`,
    `Max-Forwards: 70`,
    `User-Agent: Pinmoli/0.1.0`,
    `Content-Length: 0`,
    '',
    ''
  ].join('\r\n');
}

export function buildByeRequest(uri: string, host: string, port: number, callId: string, fromTag: string, toTag: string, branch: string, localIp: string, localPort: number, cseq = 2): string {
  return [
    `BYE ${uri} SIP/2.0`,
    `Via: SIP/2.0/UDP ${localIp}:${localPort};rport;branch=${branch}`,
    `From: <sip:pinmoli@pinmoli.local>;tag=${fromTag}`,
    `To: <${uri}>${toTag ? `;tag=${toTag}` : ''}`,
    `Call-ID: ${callId}`,
    `CSeq: ${cseq} BYE`,
    `Max-Forwards: 70`,
    `User-Agent: Pinmoli/0.1.0`,
    `Content-Length: 0`,
    '',
    ''
  ].join('\r\n');
}

export function buildCancelRequest(uri: string, host: string, port: number, callId: string, fromTag: string, branch: string, localIp: string, localPort: number): string {
  // CANCEL reuses the INVITE's branch and CSeq number (RFC 3261 Section 9.1)
  return [
    `CANCEL ${uri} SIP/2.0`,
    `Via: SIP/2.0/UDP ${localIp}:${localPort};rport;branch=${branch}`,
    `From: <sip:pinmoli@pinmoli.local>;tag=${fromTag}`,
    `To: <${uri}>`,
    `Call-ID: ${callId}`,
    `CSeq: 1 CANCEL`,
    `Max-Forwards: 70`,
    `User-Agent: Pinmoli/0.1.0`,
    `Content-Length: 0`,
    '',
    ''
  ].join('\r\n');
}

export function buildRegisterRequest(uri: string, host: string, port: number, callId: string, fromTag: string, branch: string, localIp: string, localPort: number): string {
  return [
    `REGISTER ${uri} SIP/2.0`,
    `Via: SIP/2.0/UDP ${localIp}:${localPort};rport;branch=${branch}`,
    `From: <${uri}>;tag=${fromTag}`,
    `To: <${uri}>`,
    `Call-ID: ${callId}`,
    `CSeq: 1 REGISTER`,
    `Contact: <sip:pinmoli@${localIp}:${localPort}>`,
    `Max-Forwards: 70`,
    `User-Agent: Pinmoli/0.1.0`,
    `Expires: 3600`,
    `Content-Length: 0`,
    '',
    ''
  ].join('\r\n');
}
