import { describe, it, expect, vi, beforeEach } from 'vitest';
import { whipOffer, whipDelete, WhipError } from '../../src/webrtc/whip.js';

interface FetchInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
}

describe('WHIP Client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('whipOffer', () => {
    it('sends SDP offer and returns answer', async () => {
      const mockSdpAnswer = 'v=0\r\no=- 1234 0 IN IP4 1.2.3.4\r\ns=-\r\n';
      const mockResponse = new Response(mockSdpAnswer, {
        status: 201,
        headers: { 'Location': '/resource/abc123' },
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

      const result = await whipOffer(
        'https://example.com/whip',
        'v=0\r\no=- 5678 0 IN IP4 0.0.0.0\r\ns=-\r\n'
      );

      expect(result.sdpAnswer).toBe(mockSdpAnswer);
      expect(result.resourceUrl).toContain('/resource/abc123');

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      expect(fetchCall[0]).toBe('https://example.com/whip');
      const init = fetchCall[1] as FetchInit;
      expect(init.method).toBe('POST');
      expect(init.headers['Content-Type']).toBe('application/sdp');
    });

    it('includes bearer token when provided', async () => {
      const mockResponse = new Response('v=0\r\ns=-\r\n', {
        status: 201,
        headers: { 'Location': '/resource/xyz' },
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

      await whipOffer(
        'https://example.com/whip',
        'v=0\r\ns=-\r\n',
        'my-secret-token'
      );

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const init = fetchCall[1] as FetchInit;
      expect(init.headers['Authorization']).toBe('Bearer my-secret-token');
    });

    it('throws WhipError on HTTP error', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' })
      );

      await expect(
        whipOffer('https://example.com/whip', 'v=0\r\ns=-\r\n')
      ).rejects.toThrow(WhipError);

      try {
        await whipOffer('https://example.com/whip', 'v=0\r\ns=-\r\n');
      } catch (err) {
        expect(err).toBeInstanceOf(WhipError);
        expect((err as WhipError).httpStatus).toBe(401);
      }
    });

    it('throws on invalid SDP response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('not an sdp', { status: 200 })
      );

      await expect(
        whipOffer('https://example.com/whip', 'v=0\r\ns=-\r\n')
      ).rejects.toThrow(/not valid SDP/);
    });

    it('uses endpoint as resourceUrl when no Location header', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('v=0\r\ns=-\r\n', { status: 200 })
      );

      const result = await whipOffer('https://example.com/whip', 'v=0\r\ns=-\r\n');
      expect(result.resourceUrl).toBe('https://example.com/whip');
    });
  });

  describe('whipDelete', () => {
    it('sends DELETE request', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(null, { status: 204 })
      );

      await whipDelete('https://example.com/resource/abc123');

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      expect(fetchCall[0]).toBe('https://example.com/resource/abc123');
      const init = fetchCall[1] as FetchInit;
      expect(init.method).toBe('DELETE');
    });

    it('accepts 404 as session already gone', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(null, { status: 404 })
      );

      // Should not throw
      await whipDelete('https://example.com/resource/abc123');
    });

    it('throws on unexpected HTTP error', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(null, { status: 500, statusText: 'Internal Server Error' })
      );

      await expect(
        whipDelete('https://example.com/resource/abc123')
      ).rejects.toThrow(WhipError);
    });

    it('includes bearer token when provided', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(null, { status: 204 })
      );

      await whipDelete('https://example.com/resource/abc123', 'my-token');

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const init = fetchCall[1] as FetchInit;
      expect(init.headers['Authorization']).toBe('Bearer my-token');
    });
  });
});
