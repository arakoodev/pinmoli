/**
 * WHIP (WebRTC-HTTP Ingestion Protocol) Signaling Client
 * RFC 9725 — POST SDP offer to HTTP endpoint, get SDP answer back.
 * Supported by LiveKit, Janus, Cloudflare, Ant Media.
 */

export interface WhipOfferResult {
  sdpAnswer: string;
  resourceUrl: string;
}

/**
 * POST SDP offer to WHIP endpoint, return SDP answer.
 * Content-Type: application/sdp per RFC 9725 Section 4.1.
 */
export async function whipOffer(
  endpoint: string,
  sdpOffer: string,
  bearerToken?: string
): Promise<WhipOfferResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/sdp',
  };

  if (bearerToken) {
    headers['Authorization'] = `Bearer ${bearerToken}`;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: sdpOffer,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new WhipError(
      `WHIP offer failed: ${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`,
      response.status
    );
  }

  const sdpAnswer = await response.text();

  if (!sdpAnswer.includes('v=0')) {
    throw new WhipError(
      'WHIP response is not valid SDP (missing v=0 line)',
      0
    );
  }

  // Resource URL for DELETE teardown — from Location header or endpoint itself
  const location = response.headers.get('location');
  const resourceUrl = location
    ? new URL(location, endpoint).toString()
    : endpoint;

  return { sdpAnswer, resourceUrl };
}

/**
 * DELETE WHIP resource to end session.
 * RFC 9725 Section 4.4.
 */
export async function whipDelete(
  resourceUrl: string,
  bearerToken?: string
): Promise<void> {
  const headers: Record<string, string> = {};

  if (bearerToken) {
    headers['Authorization'] = `Bearer ${bearerToken}`;
  }

  const response = await fetch(resourceUrl, {
    method: 'DELETE',
    headers,
  });

  // 200, 204, 404 are all acceptable — session may already be gone
  if (!response.ok && response.status !== 404) {
    throw new WhipError(
      `WHIP DELETE failed: ${response.status} ${response.statusText}`,
      response.status
    );
  }
}

export class WhipError extends Error {
  constructor(message: string, public readonly httpStatus: number) {
    super(message);
    this.name = 'WhipError';
  }
}
