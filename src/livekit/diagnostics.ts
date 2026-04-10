/**
 * LiveKit SIP diagnostics — query trunks, dispatch rules, rooms, and participants
 * via the LiveKit management API.
 *
 * Uses LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET from the environment.
 */

import { SipClient, RoomServiceClient } from 'livekit-server-sdk';

function getConfig() {
  const url = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!url || !apiKey || !apiSecret) {
    throw new Error(
      'LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET must be set in .env',
    );
  }
  // Convert wss:// to https:// for REST API
  const host = url.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
  return { host, apiKey, apiSecret };
}

export interface TrunkInfo {
  id: string;
  name: string;
  numbers: string[];
  allowedAddresses: string[];
}

export interface DispatchRuleInfo {
  id: string;
  name: string;
  trunkIds: string[];
  rule: string; // human-readable summary
}

export interface RoomInfo {
  name: string;
  participantCount: number;
  createdAt: number;
}

export interface ParticipantInfo {
  identity: string;
  name: string;
  state: string;
  joinedAt: number;
  trackCount: number;
  tracks: string[];
}

export interface DiagnosticReport {
  trunks: TrunkInfo[];
  dispatchRules: DispatchRuleInfo[];
  rooms: RoomInfo[];
  participants: Map<string, ParticipantInfo[]>;
  errors: string[];
}

export async function checkSipTrunks(): Promise<TrunkInfo[]> {
  const { host, apiKey, apiSecret } = getConfig();
  const client = new SipClient(host, apiKey, apiSecret);
  const trunks = await client.listSipInboundTrunk();
  return trunks.map(t => ({
    id: t.sipTrunkId,
    name: t.name,
    numbers: [...(t.numbers || [])],
    allowedAddresses: [...(t.allowedAddresses || [])],
  }));
}

export async function checkDispatchRules(): Promise<DispatchRuleInfo[]> {
  const { host, apiKey, apiSecret } = getConfig();
  const client = new SipClient(host, apiKey, apiSecret);
  const rules = await client.listSipDispatchRule();
  return rules.map(r => {
    let ruleSummary = 'unknown';
    const ruleOneOf = r.rule?.rule;
    if (ruleOneOf?.case === 'dispatchRuleDirect') {
      ruleSummary = `direct → room "${ruleOneOf.value.roomName}"`;
    } else if (ruleOneOf?.case === 'dispatchRuleIndividual') {
      ruleSummary = `individual → prefix "${ruleOneOf.value.roomPrefix}"`;
    } else if (ruleOneOf?.case === 'dispatchRuleCallee') {
      ruleSummary = `callee → prefix "${ruleOneOf.value.roomPrefix}"`;
    }
    return {
      id: r.sipDispatchRuleId,
      name: r.name,
      trunkIds: [...(r.trunkIds || [])],
      rule: ruleSummary,
    };
  });
}

export async function checkActiveRooms(): Promise<RoomInfo[]> {
  const { host, apiKey, apiSecret } = getConfig();
  const roomService = new RoomServiceClient(host, apiKey, apiSecret);
  const rooms = await roomService.listRooms();
  return rooms.map(r => ({
    name: r.name,
    participantCount: r.numParticipants,
    createdAt: Number(r.creationTime),
  }));
}

export async function checkRoomParticipants(roomName: string): Promise<ParticipantInfo[]> {
  const { host, apiKey, apiSecret } = getConfig();
  const roomService = new RoomServiceClient(host, apiKey, apiSecret);
  const participants = await roomService.listParticipants(roomName);
  return participants.map(p => ({
    identity: p.identity,
    name: p.name,
    state: p.state !== undefined ? String(p.state) : 'unknown',
    joinedAt: Number(p.joinedAt),
    trackCount: p.tracks?.length ?? 0,
    tracks: (p.tracks || []).map(t => `${t.type}/${t.source} (${t.mimeType || 'unknown'})`),
  }));
}

export async function runFullDiagnostic(): Promise<DiagnosticReport> {
  const errors: string[] = [];
  let trunks: TrunkInfo[] = [];
  let dispatchRules: DispatchRuleInfo[] = [];
  let rooms: RoomInfo[] = [];
  const participants = new Map<string, ParticipantInfo[]>();

  try {
    trunks = await checkSipTrunks();
  } catch (e) {
    errors.push(`SIP trunks: ${(e as Error).message}`);
  }

  try {
    dispatchRules = await checkDispatchRules();
  } catch (e) {
    errors.push(`Dispatch rules: ${(e as Error).message}`);
  }

  try {
    rooms = await checkActiveRooms();
    for (const room of rooms) {
      try {
        const parts = await checkRoomParticipants(room.name);
        participants.set(room.name, parts);
      } catch (e) {
        errors.push(`Room "${room.name}" participants: ${(e as Error).message}`);
      }
    }
  } catch (e) {
    errors.push(`Rooms: ${(e as Error).message}`);
  }

  return { trunks, dispatchRules, rooms, participants, errors };
}
