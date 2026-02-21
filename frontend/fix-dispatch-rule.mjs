/**
 * Fix dispatch rule: remove roomConfig to allow automatic agent dispatch.
 *
 * Problem: The current rule has `roomConfig: { agents: [{}] }` which forces
 * explicit dispatch with an empty agentName. Cloud agents using Agent Builder
 * use automatic dispatch (they watch for new rooms). The empty explicit dispatch
 * blocks automatic dispatch from triggering.
 *
 * Fix: Recreate the rule WITHOUT roomConfig so automatic dispatch works.
 *
 * Usage:
 *   node fix-dispatch-rule.mjs                     # automatic dispatch (no roomConfig)
 *   ROOM_PRESET=mypreset node fix-dispatch-rule.mjs # use a Cloud room preset
 *   AGENT_NAME=myagent node fix-dispatch-rule.mjs   # explicit dispatch with agent name
 */
import { SipClient, AgentDispatchClient, RoomServiceClient } from 'livekit-server-sdk';

const url = process.env.LIVEKIT_URL;
const apiKey = process.env.LIVEKIT_API_KEY;
const apiSecret = process.env.LIVEKIT_API_SECRET;

if (!url || !apiKey || !apiSecret) {
  console.error('Missing LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET');
  process.exit(1);
}

const sipClient = new SipClient(url, apiKey, apiSecret);
const roomClient = new RoomServiceClient(url, apiKey, apiSecret);

const TRUNK_ID = 'ST_t5vD8YeTzHUY';
const RULE_NAME = 'yamada-dispatch-rule-1';

async function main() {
  // --- Step 1: Inspect current state ---
  console.log('=== Current Dispatch Rules ===\n');
  const rules = await sipClient.listSipDispatchRule();

  if (rules.length === 0) {
    console.log('  No dispatch rules found.\n');
  }

  for (const rule of rules) {
    console.log(`  ID: ${rule.sipDispatchRuleId}`);
    console.log(`  Name: ${rule.name}`);
    console.log(`  Trunk IDs: ${JSON.stringify(rule.trunkIds)}`);
    console.log(`  Rule: ${JSON.stringify(rule.rule)}`);
    console.log(`  Room Config: ${JSON.stringify(rule.roomConfig)}`);
    console.log(`  Room Preset: ${rule.roomPreset || '(none)'}`);
    console.log();
  }

  // --- Step 2: Delete ALL existing rules for our trunk ---
  const toDelete = rules.filter(
    r => r.trunkIds?.includes(TRUNK_ID) || r.name === RULE_NAME
  );

  if (toDelete.length === 0) {
    console.log('No matching rules to delete. Creating fresh.\n');
  }

  for (const rule of toDelete) {
    console.log(`Deleting rule ${rule.sipDispatchRuleId} ("${rule.name}")...`);
    await sipClient.deleteSipDispatchRule(rule.sipDispatchRuleId);
    console.log('  Deleted.\n');
  }

  // --- Step 3: Determine dispatch mode ---
  const agentName = process.env.AGENT_NAME || '';
  const roomPreset = process.env.ROOM_PRESET || '';

  let opts = {
    name: RULE_NAME,
    trunkIds: [TRUNK_ID],
  };

  if (agentName) {
    // Explicit dispatch: agent must register with this exact name
    opts.roomConfig = { agents: [{ agentName }] };
    console.log(`Mode: EXPLICIT dispatch (agentName="${agentName}")`);
  } else if (roomPreset) {
    // Cloud room preset: references a preset configured in dashboard
    opts.roomPreset = roomPreset;
    console.log(`Mode: ROOM PRESET dispatch (preset="${roomPreset}")`);
  } else {
    // Automatic dispatch: no roomConfig, agent watches for new rooms
    console.log('Mode: AUTOMATIC dispatch (no roomConfig — agent auto-joins new rooms)');
  }

  // --- Step 4: Create new rule ---
  console.log('\nCreating dispatch rule...');
  const newRule = await sipClient.createSipDispatchRule(
    { type: 'individual', roomPrefix: 'call-' },
    opts,
  );

  console.log(`\n=== New Dispatch Rule Created ===`);
  console.log(`  ID: ${newRule.sipDispatchRuleId}`);
  console.log(`  Name: ${newRule.name}`);
  console.log(`  Trunk IDs: ${JSON.stringify(newRule.trunkIds)}`);
  console.log(`  Rule: ${JSON.stringify(newRule.rule)}`);
  console.log(`  Room Config: ${JSON.stringify(newRule.roomConfig)}`);
  console.log(`  Room Preset: ${newRule.roomPreset || '(none)'}`);

  // --- Step 5: Diagnostic — check for active rooms and dispatches ---
  console.log('\n=== Diagnostics ===\n');

  const rooms = await roomClient.listRooms();
  if (rooms.length > 0) {
    console.log(`Active rooms: ${rooms.length}`);
    const dispatchClient = new AgentDispatchClient(url, apiKey, apiSecret);
    for (const room of rooms) {
      console.log(`  Room: ${room.name} (participants: ${room.numParticipants})`);
      try {
        const dispatches = await dispatchClient.listDispatch(room.name);
        for (const d of dispatches) {
          console.log(`    Dispatch: ${d.id} agentName="${d.agentName}" state=${JSON.stringify(d.state)}`);
        }
        if (dispatches.length === 0) {
          console.log('    (no agent dispatches)');
        }
      } catch (e) {
        console.log(`    dispatch list error: ${e.message}`);
      }
    }
  } else {
    console.log('No active rooms.');
  }

  console.log('\n=== Done ===');
  console.log('\nNext steps:');
  console.log('  1. Run: docker compose exec frontend node test-with-room-check.mjs');
  console.log('  2. Watch for "[ROOMS]" lines showing agent participant joining');
  console.log('  3. If agent never joins after 30s, try:');
  console.log('     ROOM_PRESET=<preset> node fix-dispatch-rule.mjs');
  console.log('     AGENT_NAME=<name> node fix-dispatch-rule.mjs');
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
