import { describe, it, expect } from 'vitest';
import { TestConfigSchema, SipEventSchema, SipUriSchema } from '../../src/validation/schemas.js';

describe('Validation Schemas', () => {
  describe('SipUriSchema', () => {
    it('accepts valid sip URI', () => {
      expect(() => SipUriSchema.parse('sip:agent@example.com')).not.toThrow();
    });

    it('accepts valid sips URI', () => {
      expect(() => SipUriSchema.parse('sips:agent@example.com')).not.toThrow();
    });

    it('rejects invalid URI', () => {
      expect(() => SipUriSchema.parse('http://example.com')).toThrow();
    });

    it('rejects file:// URI', () => {
      expect(() => SipUriSchema.parse('file:///etc/passwd')).toThrow();
    });
  });

  describe('TestConfigSchema', () => {
    it('validates complete config', () => {
      const config = {
        uri: 'sip:agent@example.com',
        method: 'OPTIONS' as const,
        codecs: ['opus', 'PCMU'],
        transport: 'auto' as const
      };
      expect(() => TestConfigSchema.parse(config)).not.toThrow();
    });

    it('requires at least one codec', () => {
      const config = {
        uri: 'sip:agent@example.com',
        method: 'OPTIONS' as const,
        codecs: [],
        transport: 'auto' as const
      };
      expect(() => TestConfigSchema.parse(config)).toThrow();
    });

    it('rejects invalid method', () => {
      const config = {
        uri: 'sip:agent@example.com',
        method: 'GET',
        codecs: ['opus'],
        transport: 'auto'
      };
      expect(() => TestConfigSchema.parse(config)).toThrow();
    });
  });

  describe('SipEventSchema', () => {
    it('validates info event', () => {
      const event = {
        type: 'info',
        timestamp: Date.now(),
        message: 'Test message'
      };
      expect(() => SipEventSchema.parse(event)).not.toThrow();
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
      expect(() => SipEventSchema.parse(event)).not.toThrow();
    });
  });
});
