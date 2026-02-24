import { describe, it, expect } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import { TestConfigSchema, SipEventSchema, SipUriSchema } from '../../src/validation/schemas.js';

describe('Validation Schemas', () => {
  describe('SipUriSchema', () => {
    it('accepts valid sip URI', () => {
      expect(Value.Check(SipUriSchema, 'sip:agent@example.com')).toBe(true);
    });

    it('accepts valid sips URI', () => {
      expect(Value.Check(SipUriSchema, 'sips:agent@example.com')).toBe(true);
    });

    it('rejects invalid URI', () => {
      expect(Value.Check(SipUriSchema, 'http://example.com')).toBe(false);
    });

    it('rejects file:// URI', () => {
      expect(Value.Check(SipUriSchema, 'file:///etc/passwd')).toBe(false);
    });
  });

  describe('TestConfigSchema', () => {
    it('validates complete config', () => {
      const config = {
        uri: 'sip:agent@example.com',
        method: 'OPTIONS' as const,
        codecs: ['opus', 'PCMU'],
        transport: 'auto' as const,
        mediaPort: 10000,
        timeout: 5000
      };
      expect(Value.Check(TestConfigSchema, config)).toBe(true);
    });

    it('requires at least one codec', () => {
      const config = {
        uri: 'sip:agent@example.com',
        method: 'OPTIONS' as const,
        codecs: [],
        transport: 'auto' as const,
        mediaPort: 10000,
        timeout: 5000
      };
      expect(Value.Check(TestConfigSchema, config)).toBe(false);
    });

    it('rejects invalid method', () => {
      const config = {
        uri: 'sip:agent@example.com',
        method: 'GET',
        codecs: ['opus'],
        transport: 'auto',
        mediaPort: 10000,
        timeout: 5000
      };
      expect(Value.Check(TestConfigSchema, config)).toBe(false);
    });
  });

  describe('SipEventSchema', () => {
    it('validates info event', () => {
      const event = {
        type: 'info',
        timestamp: Date.now(),
        message: 'Test message'
      };
      expect(Value.Check(SipEventSchema, event)).toBe(true);
    });

    it('validates error event with recovery', () => {
      const event = {
        type: 'error',
        timestamp: Date.now(),
        message: 'Test failed',
        severity: 'fatal',
        code: 'SIP_TIMEOUT',
        recovery: 'Check network'
      };
      expect(Value.Check(SipEventSchema, event)).toBe(true);
    });
  });
});
