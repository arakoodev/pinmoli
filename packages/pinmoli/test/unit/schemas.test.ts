import { describe, it, expect } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import { TestConfigSchema, SipEventSchema, type TestConfig, type SipEvent } from '../src/validation/schemas.js';

describe('TypeBox Schemas', () => {
  describe('TestConfigSchema', () => {
    it('validates valid test config', () => {
      const validConfig: TestConfig = {
        uri: 'sip:test@example.com',
        method: 'OPTIONS',
        codecs: ['opus'],
        transport: 'udp',
        mediaPort: 10000,
        timeout: 5000
      };

      const result = Value.Check(TestConfigSchema, validConfig);
      expect(result).toBe(true);
    });

    it('rejects invalid SIP URI', () => {
      const invalidConfig = {
        uri: 'http://example.com',  // Not a SIP URI
        method: 'OPTIONS',
        codecs: ['opus'],
        transport: 'udp',
        mediaPort: 10000,
        timeout: 5000
      };

      const result = Value.Check(TestConfigSchema, invalidConfig);
      expect(result).toBe(false);
    });

    it('rejects empty codecs array', () => {
      const invalidConfig = {
        uri: 'sip:test@example.com',
        method: 'OPTIONS',
        codecs: [],  // Empty array
        transport: 'udp',
        mediaPort: 10000,
        timeout: 5000
      };

      const result = Value.Check(TestConfigSchema, invalidConfig);
      expect(result).toBe(false);
    });
  });

  describe('SipEventSchema', () => {
    it('validates valid SIP event', () => {
      const validEvent: SipEvent = {
        type: 'sip',
        timestamp: Date.now(),
        message: 'Received 200 OK',
        status: 200
      };

      const result = Value.Check(SipEventSchema, validEvent);
      expect(result).toBe(true);
    });

    it('validates error event with recovery', () => {
      const errorEvent: SipEvent = {
        type: 'error',
        timestamp: Date.now(),
        message: 'Connection timeout',
        severity: 'fatal',
        code: 'SIP_TIMEOUT',
        recovery: 'Check network connectivity'
      };

      const result = Value.Check(SipEventSchema, errorEvent);
      expect(result).toBe(true);
    });
  });
});
