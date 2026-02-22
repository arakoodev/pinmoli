import type { TestConfig, SipEvent } from '../validation/schemas.js';
import { executeSipTest } from '../sip/transport.js';

/**
 * Execute a SIP test with the given configuration.
 * Returns an async generator that yields events as they happen.
 */
export async function* sipTestHandler(config: TestConfig): AsyncGenerator<SipEvent> {
  // Validate at skill boundary
  const { TestConfigSchema } = await import('../validation/schemas.js');
  TestConfigSchema.parse(config);

  yield* executeSipTest(config);
}

