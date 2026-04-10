/**
 * Shared REST client for Vertex AI Gemini generateContent endpoint.
 * Used by TTS (text→audio) and STT (audio→text).
 */

import { getAccessToken } from './auth.js';

/** Vertex AI generateContent response */
export interface GenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        inlineData?: {
          mimeType: string;
          data: string; // base64
        };
      }>;
    };
  }>;
  error?: { message: string; code: number };
}

/**
 * Call Gemini generateContent endpoint.
 *
 * Supports two auth paths:
 * 1. GEMINI_API_KEY → generativelanguage.googleapis.com (simpler, no OAuth)
 * 2. Vertex AI service account → {location}-aiplatform.googleapis.com (requires OAuth token exchange)
 *
 * Tries API key first (if set), then falls back to Vertex AI.
 *
 * @param model - Model ID (e.g. 'gemini-2.5-flash-preview-tts')
 * @param request - Full request body for generateContent
 * @returns Parsed response
 */
export async function callGenerateContent(
  model: string,
  request: Record<string, unknown>,
): Promise<GenerateContentResponse> {
  // Path 1: Gemini API key (simpler, no OAuth needed)
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${text}`);
    }

    const data = await response.json() as GenerateContentResponse;
    if (data.error) {
      throw new Error(`Gemini API error (${data.error.code}): ${data.error.message}`);
    }
    return data;
  }

  // Path 2: Vertex AI service account
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';

  if (!project) {
    throw new Error('GOOGLE_CLOUD_PROJECT not set (and no GEMINI_API_KEY)');
  }

  const token = await getAccessToken();
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${text}`);
  }

  const data = await response.json() as GenerateContentResponse;

  if (data.error) {
    throw new Error(`Gemini API error (${data.error.code}): ${data.error.message}`);
  }

  return data;
}
