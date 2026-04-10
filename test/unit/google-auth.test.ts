import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { generateKeyPairSync } from 'crypto';

// Generate a test RSA key pair for JWT signing
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const FAKE_SA = {
  type: 'service_account',
  project_id: 'test-project',
  client_email: 'test@test-project.iam.gserviceaccount.com',
  private_key: privateKey,
  token_uri: 'https://oauth2.googleapis.com/token',
};

// Set up temp service account file
const tmpDir = mkdtempSync(join(tmpdir(), 'auth-test-'));
const saPath = join(tmpDir, 'sa.json');

describe('Google Auth', () => {
  let originalCredentials: string | undefined;
  let originalProject: string | undefined;
  let originalLocation: string | undefined;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    // Save originals
    originalCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    originalProject = process.env.GOOGLE_CLOUD_PROJECT;
    originalLocation = process.env.GOOGLE_CLOUD_LOCATION;
    originalFetch = globalThis.fetch;

    // Write fake service account
    writeFileSync(saPath, JSON.stringify(FAKE_SA));
    process.env.GOOGLE_APPLICATION_CREDENTIALS = saPath;
    process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
    process.env.GOOGLE_CLOUD_LOCATION = 'us-central1';

    // Reset module cache to clear cached tokens
    const authModule = await import('../../src/google/auth.js');
    authModule.resetAuthCache();
  });

  afterEach(() => {
    // Restore originals
    if (originalCredentials !== undefined) {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = originalCredentials;
    } else {
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    }
    if (originalProject !== undefined) {
      process.env.GOOGLE_CLOUD_PROJECT = originalProject;
    } else {
      delete process.env.GOOGLE_CLOUD_PROJECT;
    }
    if (originalLocation !== undefined) {
      process.env.GOOGLE_CLOUD_LOCATION = originalLocation;
    } else {
      delete process.env.GOOGLE_CLOUD_LOCATION;
    }
    globalThis.fetch = originalFetch;
  });

  it('exchanges JWT for access token', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'test-token-123', expires_in: 3600 }),
    });
    globalThis.fetch = mockFetch;

    const { getAccessToken } = await import('../../src/google/auth.js');
    const token = await getAccessToken();

    expect(token).toBe('test-token-123');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Verify the fetch was called with the token endpoint
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/x-www-form-urlencoded');

    // Verify body contains JWT assertion
    const body = options.body as string;
    expect(body).toContain('grant_type=');
    expect(body).toContain('assertion=');

    // Verify the JWT has 3 parts (header.claims.signature)
    const jwt = body.split('assertion=')[1];
    const parts = jwt.split('.');
    expect(parts).toHaveLength(3);

    // Verify JWT header
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    expect(header).toEqual({ alg: 'RS256', typ: 'JWT' });

    // Verify JWT claims
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    expect(claims.iss).toBe('test@test-project.iam.gserviceaccount.com');
    expect(claims.scope).toBe('https://www.googleapis.com/auth/cloud-platform');
    expect(claims.aud).toBe('https://oauth2.googleapis.com/token');
    expect(claims.exp - claims.iat).toBe(3600);
  });

  it('caches token on subsequent calls', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'cached-token', expires_in: 3600 }),
    });
    globalThis.fetch = mockFetch;

    const { getAccessToken } = await import('../../src/google/auth.js');

    const token1 = await getAccessToken();
    const token2 = await getAccessToken();

    expect(token1).toBe('cached-token');
    expect(token2).toBe('cached-token');
    // Only one fetch call — second call used cache
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('throws on missing GOOGLE_APPLICATION_CREDENTIALS', async () => {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

    const { getAccessToken, resetAuthCache } = await import('../../src/google/auth.js');
    resetAuthCache();

    await expect(getAccessToken()).rejects.toThrow('GOOGLE_APPLICATION_CREDENTIALS not set');
  });

  it('throws on token exchange failure', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'invalid_grant',
    });
    globalThis.fetch = mockFetch;

    const { getAccessToken } = await import('../../src/google/auth.js');

    await expect(getAccessToken()).rejects.toThrow('Token exchange failed (401)');
  });

  it('retries once on timeout then fails', async () => {
    // Both attempts timeout
    const timeoutErr = new DOMException('The operation was aborted', 'TimeoutError');
    Object.defineProperty(timeoutErr, 'name', { value: 'TimeoutError' });
    const mockFetch = vi.fn().mockRejectedValue(timeoutErr);
    globalThis.fetch = mockFetch;

    const { getAccessToken } = await import('../../src/google/auth.js');

    await expect(getAccessToken()).rejects.toThrow();
    // Should have been called twice (initial + 1 retry)
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('succeeds on retry after first timeout', async () => {
    const timeoutErr = new DOMException('The operation was aborted', 'TimeoutError');
    Object.defineProperty(timeoutErr, 'name', { value: 'TimeoutError' });
    const mockFetch = vi.fn()
      .mockRejectedValueOnce(timeoutErr)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'retry-token', expires_in: 3600 }),
      });
    globalThis.fetch = mockFetch;

    const { getAccessToken } = await import('../../src/google/auth.js');
    const token = await getAccessToken();

    expect(token).toBe('retry-token');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on non-timeout errors', async () => {
    const networkErr = new Error('ECONNREFUSED');
    const mockFetch = vi.fn().mockRejectedValue(networkErr);
    globalThis.fetch = mockFetch;

    const { getAccessToken } = await import('../../src/google/auth.js');

    await expect(getAccessToken()).rejects.toThrow('ECONNREFUSED');
    // Only 1 call — no retry for non-timeout
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('uses AbortSignal.timeout in fetch call', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'test', expires_in: 3600 }),
    });
    globalThis.fetch = mockFetch;

    const { getAccessToken } = await import('../../src/google/auth.js');
    await getAccessToken();

    // Verify signal was passed to fetch
    const [, options] = mockFetch.mock.calls[0];
    expect(options.signal).toBeDefined();
  });
});
