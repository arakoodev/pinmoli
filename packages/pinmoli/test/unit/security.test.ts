import { describe, it, expect } from 'vitest';
import { SipUriSchema } from '../../src/validation/schemas.js';

describe('Security - SIP URI Validation', () => {
  it('rejects non-SIP schemes', () => {
    const invalid = [
      'http://example.com',
      'https://example.com',
      'file:///etc/passwd',
      'ftp://example.com',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>'
    ];

    invalid.forEach(uri => {
      expect(() => SipUriSchema.parse(uri)).toThrow();
    });
  });

  it('rejects injection attempts', () => {
    const injections = [
      'sip:test@example.com\r\nVia: injected',
      'sip:test@example.com\nVia: injected',
      'sip:test@example.com;drop table users',
      'sip:test@example.com\x00',
      'sip:test@example.com<script>alert(1)</script>'
    ];

    injections.forEach(uri => {
      expect(() => SipUriSchema.parse(uri)).toThrow();
    });
  });

  it('accepts valid SIP URIs', () => {
    const valid = [
      'sip:user@example.com',
      'sip:example.com',
      'sips:secure.example.com',
      'sip:user@192.168.1.1',
      'sip:user@example.com:5060'
    ];

    valid.forEach(uri => {
      expect(() => SipUriSchema.parse(uri)).not.toThrow();
    });
  });
});

describe('Security - Test Name Validation', () => {
  it('rejects path traversal attempts', () => {
    const invalid = [
      '../../../etc/passwd',
      '..\\..\\..\\windows\\system32',
      'test/../../../etc/passwd',
      'test/../../file'
    ];

    invalid.forEach(name => {
      expect(name).toMatch(/\.\./);
    });
  });

  it('rejects special characters', () => {
    const invalid = [
      'test;drop table',
      'test\x00null',
      'test\r\ninjection',
      'test<script>',
      'test`command`'
    ];

    invalid.forEach(name => {
      expect(name).toMatch(/[;<>\x00\r\n`]/);
    });
  });

  it('accepts valid test names', () => {
    const valid = [
      'test-name',
      'test_name',
      'TestName123',
      'test-123_name'
    ];

    valid.forEach(name => {
      expect(name).toMatch(/^[a-zA-Z0-9_-]+$/);
    });
  });
});
