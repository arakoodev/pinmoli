/**
 * Pre-flight connectivity check for SIP calls.
 *
 * Runs before INVITE to detect NAT type and warn about symmetric NAT
 * (which prevents inbound RTP). Saves 30-60s of doomed call time.
 */

import dgram from 'dgram';
import { resolve as dnsResolve } from 'dns/promises';
import { stunDiscoverAddress } from './utils.js';

const STUN_SERVER_1 = 'stun.l.google.com';
const STUN_PORT_1 = 19302;
const STUN_SERVER_2 = 'stun1.l.google.com';
const STUN_PORT_2 = 19302;

export type NatType = 'cone' | 'symmetric' | 'unknown';

export interface PreflightResult {
  /** Whether all critical checks passed */
  ok: boolean;
  /** Detected NAT type */
  natType: NatType;
  /** Public IP from STUN */
  publicIp: string;
  /** Mapped RTP port from primary STUN */
  mappedPort: number;
  /** Mapped port from secondary STUN (for NAT type comparison) */
  secondaryPort?: number;
  /** Whether the public IP is routable (not RFC 1918, CGNAT, loopback) */
  routable: boolean;
  /** SIP host DNS resolution result */
  sipHostResolved: boolean;
  /** Human-readable diagnostics */
  diagnostics: string[];
}

/** Check if an IP is publicly routable (not private, CGNAT, loopback) */
export function isRoutableIp(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p))) return false;

  // Loopback
  if (parts[0] === 127) return false;
  // RFC 1918 private
  if (parts[0] === 10) return false;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false;
  if (parts[0] === 192 && parts[1] === 168) return false;
  // CGNAT (RFC 6598)
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return false;
  // Link-local
  if (parts[0] === 169 && parts[1] === 254) return false;
  // 0.0.0.0
  if (parts[0] === 0) return false;

  return true;
}

/**
 * Resolve the STUN server to use.
 * Priority: explicit param > PINMOLI_STUN_SERVER env > default.
 */
export function resolveStunConfig(explicit?: string): { server: string; port: number } {
  if (explicit) {
    // Parse "host:port" or just "host"
    const parts = explicit.split(':');
    return { server: parts[0], port: parts[1] ? parseInt(parts[1]) : 3478 };
  }
  const envServer = process.env.PINMOLI_STUN_SERVER;
  if (envServer) {
    const parts = envServer.split(':');
    return { server: parts[0], port: parts[1] ? parseInt(parts[1]) : 3478 };
  }
  return { server: STUN_SERVER_1, port: STUN_PORT_1 };
}

/**
 * Run pre-flight checks before a SIP call.
 *
 * 1. DNS-resolve the SIP host
 * 2. STUN against primary server → get mapped IP:port
 * 3. Check if mapped IP is routable
 * 4. STUN against secondary server → compare ports for NAT type detection
 */
export async function runPreflight(
  sipHost: string,
  stunServer?: string,
): Promise<PreflightResult> {
  const diagnostics: string[] = [];
  const stun = resolveStunConfig(stunServer);

  // 1. DNS resolve SIP host
  let sipHostResolved = false;
  try {
    const addrs = await dnsResolve(sipHost);
    sipHostResolved = addrs.length > 0;
    diagnostics.push(`DNS ${sipHost} → ${addrs.join(', ')}`);
  } catch (e) {
    diagnostics.push(`DNS ${sipHost} FAILED: ${(e as Error).message}`);
  }

  // 2. Primary STUN
  const socket = dgram.createSocket('udp4');
  await new Promise<void>((resolve) => socket.bind(0, () => resolve()));

  let publicIp = ''; // empty until STUN succeeds
  let mappedPort = 0;

  try {
    const result = await stunDiscoverAddress(socket, stun.server, stun.port);
    publicIp = result.ip;
    mappedPort = result.port;
    diagnostics.push(`STUN ${stun.server}:${stun.port} → ${publicIp}:${mappedPort}`);
  } catch (e) {
    diagnostics.push(`STUN ${stun.server}:${stun.port} FAILED: ${(e as Error).message}`);
  }

  // 3. Routability check
  const routable = publicIp !== '' && isRoutableIp(publicIp);
  if (!routable) {
    diagnostics.push(`IP ${publicIp} is NOT routable (private/CGNAT/loopback)`);
  }

  // 4. NAT type detection — STUN same socket against a different server
  let natType: NatType = 'unknown';
  let secondaryPort: number | undefined;

  // Only detect NAT type if primary STUN succeeded and we're using the default
  // (custom STUN servers might be the same host, giving a false "cone" result)
  if (mappedPort > 0 && stun.server === STUN_SERVER_1) {
    try {
      const result2 = await stunDiscoverAddress(socket, STUN_SERVER_2, STUN_PORT_2);
      secondaryPort = result2.port;
      diagnostics.push(`STUN ${STUN_SERVER_2}:${STUN_PORT_2} → ${result2.ip}:${result2.port}`);

      if (result2.port === mappedPort) {
        natType = 'cone';
        diagnostics.push('NAT type: cone (same port for different destinations — RTP should work)');
      } else {
        natType = 'symmetric';
        diagnostics.push(`NAT type: symmetric (port ${mappedPort} vs ${result2.port} — inbound RTP will fail)`);
      }
    } catch {
      diagnostics.push('NAT type detection failed (secondary STUN unreachable)');
    }
  }

  try { socket.close(); } catch { /* already closed */ }

  const ok = sipHostResolved && routable && natType !== 'symmetric';

  return {
    ok,
    natType,
    publicIp,
    mappedPort,
    secondaryPort,
    routable,
    sipHostResolved,
    diagnostics,
  };
}
