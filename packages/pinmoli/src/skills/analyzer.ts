import type { SipEvent } from '../validation/schemas.js';

export async function analyzeFailureHandler(params: { events: SipEvent[] }): Promise<string> {
  const { events } = params;
  
  // Find error events
  const errors = events.filter(e => e.type === 'error' || (e.status && e.status >= 400));
  
  if (errors.length === 0) {
    return 'No errors found in the provided events.';
  }

  // TODO: Use LLM to analyze errors
  // For now, provide basic analysis
  const firstError = errors[0];
  
  if (firstError.status === 401) {
    return 'The test failed with 401 Unauthorized. This means:\n\n' +
           '1. The server requires authentication\n' +
           '2. No credentials were provided or they were incorrect\n\n' +
           'To fix: Add authentication with --auth username:password';
  }

  return `Error detected: ${firstError.message}`;
}
