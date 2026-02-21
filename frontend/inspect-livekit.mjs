/**
 * Inspect LiveKit SIP configuration: trunks, dispatch rules, rooms, agents.
 * Requires LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET in .env or environment.
 */
import { SipClient, RoomServiceClient } from 'livekit-server-sdk';

const url = process.env.LIVEKIT_URL;
const apiKey = process.env.LIVEKIT_API_KEY;
const apiSecret = process.env.LIVEKIT_API_SECRET;

if (!url || !apiKey || !apiSecret) {
  console.error('Missing environment variables. Set:');
  console.error('  LIVEKIT_URL=wss://your-project.livekit.cloud');
  console.error('  LIVEKIT_API_KEY=APIxxxxx');
  console.error('  LIVEKIT_API_SECRET=xxxxx');
  process.exit(1);
}

const sipClient = new SipClient(url, apiKey, apiSecret);
const roomClient = new RoomServiceClient(url, apiKey, apiSecret);

async function main() {
  console.log('=== LiveKit SIP Configuration Inspection ===\n');
  console.log(`URL: ${url}\n`);

  // 1. List inbound trunks
  console.log('--- INBOUND SIP TRUNKS ---');
  try {
    const trunks = await sipClient.listSipInboundTrunk();
    if (trunks.length === 0) {
      console.log('  NO INBOUND TRUNKS CONFIGURED! This is why calls fail.');
    }
    for (const trunk of trunks) {
      console.log(`\n  Trunk ID: ${trunk.sipTrunkId}`);
      console.log(`  Name: ${trunk.name || '(unnamed)'}`);
      console.log(`  Numbers (matches toUser): ${JSON.stringify(trunk.numbers)}`);
      console.log(`  Allowed Addresses: ${JSON.stringify(trunk.allowedAddresses)}`);
      console.log(`  Allowed Numbers (caller filter): ${JSON.stringify(trunk.allowedNumbers)}`);
      console.log(`  Auth Username: ${trunk.authUsername || '(none)'}`);
      console.log(`  Auth Password: ${trunk.authPassword ? '***set***' : '(none)'}`);
      console.log(`  Headers: ${JSON.stringify(trunk.headers)}`);
      console.log(`  Krisp: ${trunk.krispEnabled}`);
    }
  } catch (e) {
    console.log(`  Error listing trunks: ${e.message}`);
  }

  // 2. List dispatch rules
  console.log('\n--- SIP DISPATCH RULES ---');
  try {
    const rules = await sipClient.listSipDispatchRule();
    if (rules.length === 0) {
      console.log('  NO DISPATCH RULES CONFIGURED! Trunks need dispatch rules to create rooms.');
    }
    for (const rule of rules) {
      console.log(`\n  Rule ID: ${rule.sipDispatchRuleId}`);
      console.log(`  Name: ${rule.name || '(unnamed)'}`);
      console.log(`  Trunk IDs: ${JSON.stringify(rule.trunkIds)}`);
      console.log(`  Rule: ${JSON.stringify(rule.rule)}`);
      console.log(`  Room Config: ${JSON.stringify(rule.roomConfig)}`);
      console.log(`  Metadata: ${rule.metadata || '(none)'}`);
    }
  } catch (e) {
    console.log(`  Error listing dispatch rules: ${e.message}`);
  }

  // 3. List active rooms
  console.log('\n--- ACTIVE ROOMS ---');
  try {
    const rooms = await roomClient.listRooms();
    if (rooms.length === 0) {
      console.log('  No active rooms.');
    }
    for (const room of rooms) {
      console.log(`  Room: ${room.name} | Participants: ${room.numParticipants} | Created: ${new Date(Number(room.creationTime) * 1000).toISOString()}`);
    }
  } catch (e) {
    console.log(`  Error listing rooms: ${e.message}`);
  }

  console.log('\n=== Inspection Complete ===');
}

main().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
