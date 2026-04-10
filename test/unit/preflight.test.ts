import { describe, it, expect } from 'vitest';
import { isRoutableIp, resolveStunConfig } from '../../src/network/preflight.js';

describe('isRoutableIp', () => {
  it('accepts public IPs', () => {
    expect(isRoutableIp('8.8.8.8')).toBe(true);
    expect(isRoutableIp('94.156.149.30')).toBe(true);
    expect(isRoutableIp('171.79.126.80')).toBe(true);
    expect(isRoutableIp('161.115.181.157')).toBe(true);
  });

  it('rejects RFC 1918 private IPs', () => {
    expect(isRoutableIp('10.0.0.1')).toBe(false);
    expect(isRoutableIp('10.255.255.255')).toBe(false);
    expect(isRoutableIp('172.16.0.1')).toBe(false);
    expect(isRoutableIp('172.31.255.255')).toBe(false);
    expect(isRoutableIp('192.168.0.1')).toBe(false);
    expect(isRoutableIp('192.168.255.255')).toBe(false);
  });

  it('rejects CGNAT (RFC 6598)', () => {
    expect(isRoutableIp('100.64.0.1')).toBe(false);
    expect(isRoutableIp('100.127.255.255')).toBe(false);
  });

  it('accepts IPs outside CGNAT range', () => {
    expect(isRoutableIp('100.63.255.255')).toBe(true);
    expect(isRoutableIp('100.128.0.0')).toBe(true);
  });

  it('rejects loopback', () => {
    expect(isRoutableIp('127.0.0.1')).toBe(false);
    expect(isRoutableIp('127.255.255.255')).toBe(false);
  });

  it('rejects link-local', () => {
    expect(isRoutableIp('169.254.0.1')).toBe(false);
  });

  it('rejects 0.0.0.0', () => {
    expect(isRoutableIp('0.0.0.0')).toBe(false);
  });

  it('rejects malformed IPs', () => {
    expect(isRoutableIp('not.an.ip')).toBe(false);
    expect(isRoutableIp('')).toBe(false);
    expect(isRoutableIp('1.2.3')).toBe(false);
  });

  it('accepts 172.x outside 16-31 range', () => {
    expect(isRoutableIp('172.15.0.1')).toBe(true);
    expect(isRoutableIp('172.32.0.1')).toBe(true);
  });
});

describe('resolveStunConfig', () => {
  const originalEnv = process.env.PINMOLI_STUN_SERVER;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.PINMOLI_STUN_SERVER = originalEnv;
    } else {
      delete process.env.PINMOLI_STUN_SERVER;
    }
  });

  it('uses explicit param first', () => {
    process.env.PINMOLI_STUN_SERVER = 'env.example.com';
    const result = resolveStunConfig('explicit.example.com:5000');
    expect(result.server).toBe('explicit.example.com');
    expect(result.port).toBe(5000);
  });

  it('uses env var when no explicit param', () => {
    process.env.PINMOLI_STUN_SERVER = 'env.example.com:4000';
    const result = resolveStunConfig();
    expect(result.server).toBe('env.example.com');
    expect(result.port).toBe(4000);
  });

  it('defaults to Google STUN', () => {
    delete process.env.PINMOLI_STUN_SERVER;
    const result = resolveStunConfig();
    expect(result.server).toBe('stun.l.google.com');
    expect(result.port).toBe(19302);
  });

  it('defaults port to 3478 for host-only config', () => {
    const result = resolveStunConfig('custom.example.com');
    expect(result.server).toBe('custom.example.com');
    expect(result.port).toBe(3478);
  });
});
