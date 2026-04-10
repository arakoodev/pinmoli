/**
 * LiveKit SIP Diagnostics CLI — check trunks, dispatch rules, rooms, network.
 *
 * Usage:
 *   docker compose exec pinmoli npx tsx src/cli-livekit-diag.ts
 *   docker compose exec pinmoli npx tsx src/cli-livekit-diag.ts --active
 */

import { runFullDiagnostic } from './livekit/diagnostics.js';
import { getPublicIp } from './network/utils.js';
import { resolve as dnsResolve } from 'dns/promises';

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

function log(msg: string) { process.stderr.write(msg + '\n'); }

async function testDns(host: string): Promise<string> {
  try {
    const addrs = await dnsResolve(host);
    return `${green('OK')} → ${addrs.join(', ')}`;
  } catch (e) {
    return `${red('FAIL')} — ${(e as Error).message}`;
  }
}

async function testFetch(url: string, timeoutMs = 5000): Promise<string> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return `${green('OK')} (${resp.status})`;
  } catch (e) {
    return `${red('FAIL')} — ${(e as Error).message}`;
  }
}

async function main() {
  log(bold('=== LiveKit SIP Diagnostics ==='));
  log('');

  // Environment
  const url = process.env.LIVEKIT_URL || '(not set)';
  const phone = process.env.LIVEKIT_PHONE || '(not set)';
  const sipEndpoint = process.env.LIVEKIT_SIP_ENDPOINT || '(not set)';
  log(`${bold('LiveKit URL:')} ${url}`);
  log(`${bold('SIP Endpoint:')} ${sipEndpoint}`);
  log(`${bold('Phone:')} ${phone}`);
  log(`${bold('API Key:')} ${process.env.LIVEKIT_API_KEY ? '***' + process.env.LIVEKIT_API_KEY.slice(-4) : red('NOT SET')}`);
  log('');

  // Network tests
  log(bold('--- Network ---'));
  log(`STUN (public IP): ${dim('checking...')}`);
  try {
    const ip = await getPublicIp();
    log(`\x1b[1A\x1b[2K  STUN (public IP): ${green(ip)}`);
  } catch (e) {
    log(`\x1b[1A\x1b[2K  STUN (public IP): ${red((e as Error).message)}`);
  }

  log(`  DNS oauth2.googleapis.com: ${await testDns('oauth2.googleapis.com')}`);
  log(`  DNS aiplatform.googleapis.com: ${await testDns('us-central1-aiplatform.googleapis.com')}`);
  log(`  DNS ${sipEndpoint}: ${await testDns(sipEndpoint)}`);
  log(`  HTTPS oauth2.googleapis.com: ${await testFetch('https://oauth2.googleapis.com/', 5000)}`);
  log(`  HTTPS aiplatform: ${await testFetch('https://us-central1-aiplatform.googleapis.com/', 5000)}`);
  log('');

  // LiveKit API
  log(bold('--- LiveKit API ---'));
  const report = await runFullDiagnostic();

  if (report.errors.length > 0) {
    log(red('Errors:'));
    for (const err of report.errors) log(`  ${red(err)}`);
    log('');
  }

  // Trunks
  log(`${bold('SIP Inbound Trunks:')} ${report.trunks.length}`);
  for (const t of report.trunks) {
    const matchesPhone = t.numbers.some(n => n === phone);
    const marker = matchesPhone ? green(' ← matches LIVEKIT_PHONE') : '';
    log(`  ${cyan(t.id)} ${t.name}${marker}`);
    log(`    Numbers: ${t.numbers.join(', ') || dim('(none)')}`);
    log(`    Allowed: ${t.allowedAddresses.join(', ') || dim('(none)')}`);
  }
  log('');

  // Dispatch Rules
  log(`${bold('Dispatch Rules:')} ${report.dispatchRules.length}`);
  for (const r of report.dispatchRules) {
    log(`  ${cyan(r.id)} ${r.name}`);
    log(`    Rule: ${r.rule}`);
    log(`    Trunk IDs: ${r.trunkIds.join(', ') || dim('(all trunks)')}`);
  }
  log('');

  // Active Rooms
  log(`${bold('Active Rooms:')} ${report.rooms.length}`);
  if (report.rooms.length === 0) {
    log(`  ${dim('(no active rooms — agent may not be running)')}`);
  }
  for (const room of report.rooms) {
    log(`  ${cyan(room.name)} — ${room.participantCount} participants`);
    const parts = report.participants.get(room.name) || [];
    for (const p of parts) {
      const trackInfo = p.trackCount > 0 ? green(`${p.trackCount} tracks`) : yellow('0 tracks');
      log(`    ${p.identity} (${p.name}) — state=${p.state}, ${trackInfo}`);
      for (const track of p.tracks) {
        log(`      ${dim(track)}`);
      }
    }
  }
  log('');

  // Summary
  const hasMatchingTrunk = report.trunks.some(t => t.numbers.some(n => n === phone));
  const hasDispatchRule = report.dispatchRules.length > 0;

  log(bold('--- Summary ---'));
  log(`  Trunk for ${phone}: ${hasMatchingTrunk ? green('FOUND') : red('NOT FOUND')}`);
  log(`  Dispatch rules: ${hasDispatchRule ? green(`${report.dispatchRules.length} configured`) : red('NONE')}`);
  log(`  Active rooms: ${report.rooms.length > 0 ? green(`${report.rooms.length}`) : yellow('0 (agent idle)')}`);

  if (!hasMatchingTrunk) {
    log('');
    log(red('  No trunk matches the phone number. Calls will get 404 "No trunk found".'));
  }
  if (!hasDispatchRule) {
    log('');
    log(red('  No dispatch rules. Calls will ring forever (180) with no agent joining.'));
  }
}

main().catch(err => { log(red(`Fatal: ${err.message}`)); process.exit(1); });
