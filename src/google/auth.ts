/**
 * Google Cloud OAuth2 authentication via service account JWT.
 * Zero npm dependencies — uses Node crypto for JWT signing and native fetch for token exchange.
 */

import { readFileSync } from 'fs';
import { createSign } from 'crypto';

const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const TOKEN_URI = 'https://oauth2.googleapis.com/token';

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}

let cachedToken: CachedToken | undefined;
let cachedServiceAccount: ServiceAccountKey | undefined;

function base64url(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64url');
}

function loadServiceAccount(): ServiceAccountKey {
  if (cachedServiceAccount) return cachedServiceAccount;

  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath) {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS not set');
  }

  const json = JSON.parse(readFileSync(credPath, 'utf-8'));
  if (!json.client_email || !json.private_key) {
    throw new Error('Service account JSON missing client_email or private_key');
  }

  cachedServiceAccount = json as ServiceAccountKey;
  return cachedServiceAccount;
}

function signJwt(sa: ServiceAccountKey): string {
  const now = Math.floor(Date.now() / 1000);

  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({
    iss: sa.client_email,
    scope: SCOPE,
    aud: sa.token_uri || TOKEN_URI,
    iat: now,
    exp: now + 3600,
  }));

  const signInput = `${header}.${claims}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signInput);
  const signature = signer.sign(sa.private_key, 'base64url');

  return `${signInput}.${signature}`;
}

/**
 * Get a valid Google Cloud access token.
 * Caches the token and refreshes 5 minutes before expiry.
 */
export async function getAccessToken(): Promise<string> {
  // Return cached token if still valid (with 5 min buffer)
  if (cachedToken && Date.now() < cachedToken.expiresAt - 5 * 60 * 1000) {
    return cachedToken.accessToken;
  }

  const sa = loadServiceAccount();
  const jwt = signJwt(sa);

  const response = await fetch(sa.token_uri || TOKEN_URI, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${text}`);
  }

  const data = await response.json() as { access_token: string; expires_in: number };
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return cachedToken.accessToken;
}

/** Reset cached token and service account (for testing) */
export function resetAuthCache(): void {
  cachedToken = undefined;
  cachedServiceAccount = undefined;
}
