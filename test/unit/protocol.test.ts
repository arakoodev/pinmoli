import { describe, it, expect } from 'vitest';
import { mergeCustomHeaders, generateCallId, generateTag } from '../../src/sip/protocol.js';

describe('SIP Protocol', () => {
  describe('mergeCustomHeaders', () => {
    it('merges non-reserved headers', () => {
      const base = { to: 'sip:test@example.com' };
      const custom = { 'X-Custom': 'value' };
      const { headers, warnings } = mergeCustomHeaders(base, custom);
      
      expect(headers['X-Custom']).toBe('value');
      expect(warnings).toHaveLength(0);
    });

    it('blocks reserved headers', () => {
      const base = { to: 'sip:test@example.com' };
      const custom = { 'call-id': 'malicious' };
      const { headers, warnings } = mergeCustomHeaders(base, custom);
      
      expect(headers['call-id']).toBeUndefined();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('call-id');
    });

    it('blocks multiple reserved headers', () => {
      const base = { to: 'sip:test@example.com', from: 'sip:me@example.com' };
      const custom = { 'call-id': 'bad', 'cseq': 'bad', 'X-Good': 'ok' };
      const { headers, warnings } = mergeCustomHeaders(base, custom);
      
      expect(headers['X-Good']).toBe('ok');
      expect(warnings).toHaveLength(2);
    });
  });

  describe('generateCallId', () => {
    it('generates unique call IDs', () => {
      const id1 = generateCallId();
      const id2 = generateCallId();
      expect(id1).not.toBe(id2);
    });

    it('includes @pinmoli domain', () => {
      const id = generateCallId();
      expect(id).toContain('@pinmoli');
    });
  });

  describe('generateTag', () => {
    it('generates unique tags', () => {
      const tag1 = generateTag();
      const tag2 = generateTag();
      expect(tag1).not.toBe(tag2);
    });
  });
});
