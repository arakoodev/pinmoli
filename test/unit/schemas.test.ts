import { describe, it, expect } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import { TestConfigSchema, ConfigSchema, SipEventSchema, type TestConfig, type SipEvent } from '../../src/validation/schemas.js';

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

    it('accepts config with sendDelay', () => {
      const config = {
        uri: 'sip:test@example.com',
        method: 'INVITE',
        codecs: ['opus', 'PCMU'],
        transport: 'udp',
        mediaPort: 10000,
        timeout: 5000,
        sendDelay: 8,
        responseWaitTime: 15
      };

      expect(Value.Check(TestConfigSchema, config)).toBe(true);
    });

    it('accepts config without sendDelay (defaults to 0)', () => {
      const config = {
        uri: 'sip:test@example.com',
        method: 'INVITE',
        codecs: ['opus'],
        transport: 'udp',
        mediaPort: 10000,
        timeout: 5000
      };

      expect(Value.Check(TestConfigSchema, config)).toBe(true);
    });

    it('rejects sendDelay greater than 60', () => {
      const config = {
        uri: 'sip:test@example.com',
        method: 'INVITE',
        codecs: ['opus'],
        transport: 'udp',
        mediaPort: 10000,
        timeout: 5000,
        sendDelay: 61
      };

      expect(Value.Check(TestConfigSchema, config)).toBe(false);
    });

    it('rejects negative sendDelay', () => {
      const config = {
        uri: 'sip:test@example.com',
        method: 'INVITE',
        codecs: ['opus'],
        transport: 'udp',
        mediaPort: 10000,
        timeout: 5000,
        sendDelay: -1
      };

      expect(Value.Check(TestConfigSchema, config)).toBe(false);
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

    it('accepts config with dtmfDigits', () => {
      const config = {
        uri: 'sip:test@example.com',
        method: 'INVITE',
        codecs: ['opus', 'PCMU'],
        transport: 'udp',
        mediaPort: 10000,
        timeout: 5000,
        dtmfDigits: '1234#'
      };

      expect(Value.Check(TestConfigSchema, config)).toBe(true);
    });

    it('accepts dtmfDigits with A-D', () => {
      const config = {
        uri: 'sip:test@example.com',
        method: 'INVITE',
        codecs: ['PCMU'],
        transport: 'udp',
        mediaPort: 10000,
        timeout: 5000,
        dtmfDigits: '12*#ABcd'
      };

      expect(Value.Check(TestConfigSchema, config)).toBe(true);
    });

    it('rejects dtmfDigits with invalid characters', () => {
      const config = {
        uri: 'sip:test@example.com',
        method: 'INVITE',
        codecs: ['PCMU'],
        transport: 'udp',
        mediaPort: 10000,
        timeout: 5000,
        dtmfDigits: '12X'
      };

      expect(Value.Check(TestConfigSchema, config)).toBe(false);
    });
  });

  describe('ConfigSchema', () => {
    it('validates config with agent-only llm', () => {
      const config = {
        llm: { agent: { provider: 'anthropic', model: 'claude-sonnet-4-5' } },
        sip: { defaultPort: 5060, timeout: 30000, maxDuration: 300 },
        ui: { maxTimelineEvents: 1000 },
      };
      expect(Value.Check(ConfigSchema, config)).toBe(true);
    });

    it('validates config with tts and stt', () => {
      const config = {
        llm: {
          agent: { provider: 'google-vertex', model: 'gemini-3.1-pro-preview' },
          tts: { model: 'gemini-2.5-flash-tts' },
          stt: { model: 'gemini-2.5-flash' },
        },
        sip: { defaultPort: 5060, timeout: 30000, maxDuration: 300 },
        ui: { maxTimelineEvents: 1000 },
      };
      expect(Value.Check(ConfigSchema, config)).toBe(true);
    });

    it('validates config without tts/stt (optional)', () => {
      const config = {
        llm: { agent: { provider: 'openai', model: 'gpt-4o' } },
        sip: { defaultPort: 5060, timeout: 30000, maxDuration: 300 },
        ui: { maxTimelineEvents: 1000 },
      };
      expect(Value.Check(ConfigSchema, config)).toBe(true);
    });

    it('rejects config with flat llm (old format)', () => {
      const config = {
        llm: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
        sip: { defaultPort: 5060, timeout: 30000, maxDuration: 300 },
        ui: { maxTimelineEvents: 1000 },
      };
      expect(Value.Check(ConfigSchema, config)).toBe(false);
    });

    it('rejects config with unknown provider', () => {
      const config = {
        llm: { agent: { provider: 'unknown', model: 'test' } },
        sip: { defaultPort: 5060, timeout: 30000, maxDuration: 300 },
        ui: { maxTimelineEvents: 1000 },
      };
      expect(Value.Check(ConfigSchema, config)).toBe(false);
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

    it('validates DTMF event', () => {
      const dtmfEvent = {
        type: 'dtmf',
        timestamp: Date.now(),
        message: 'DTMF digit sent: 5',
        dtmfDigit: '5',
        dtmfDuration: 1280
      };

      expect(Value.Check(SipEventSchema, dtmfEvent)).toBe(true);
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
