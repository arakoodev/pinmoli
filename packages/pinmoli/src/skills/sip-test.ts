import type { TestConfig, SipEvent } from '../validation/schemas.js';
import { runSipTest } from '../sip/engine.js';

/**
 * Execute a SIP test with the given configuration.
 * Returns an async generator that yields events as they happen.
 */
export async function* sipTestHandler(config: TestConfig): AsyncGenerator<SipEvent> {
  // Validate at skill boundary
  const { TestConfigSchema } = await import('../validation/schemas.js');
  const { Value } = await import('@sinclair/typebox/value');
  if (!Value.Check(TestConfigSchema, config)) {
    throw new Error('Invalid test configuration');
  }

  yield* runSipTest(config);
}

