export interface SipPreset {
  id: string;
  name: string;
  description: string;
  uriTemplate: string;
  transport: 'udp' | 'tcp' | 'auto';
  headers: Record<string, string>;
  codecs: string[];
  authRequired: boolean;
  placeholders: Record<string, string>;
}

export const presets: SipPreset[] = [
  {
    id: 'livekit',
    name: 'LiveKit Cloud',
    description: 'LiveKit SIP Trunk — proven INVITE/ACK/BYE flow',
    uriTemplate: 'sip:+{number}@{trunkId}.sip.livekit.cloud',
    transport: 'auto',
    headers: {},
    codecs: ['opus', 'PCMU'],
    authRequired: false,
    placeholders: {
      number: '1234567890',
      trunkId: '5eezfwavhxe',
    },
  },
  {
    id: 'daily',
    name: 'Daily.co',
    description: 'Daily SIP interconnect for voice agents',
    uriTemplate: 'sip:{roomName}@sip.daily.co',
    transport: 'udp',
    headers: {
      'X-Daily-Room': '{roomName}',
    },
    codecs: ['opus', 'PCMU'],
    authRequired: false,
    placeholders: {
      roomName: 'my-room',
    },
  },
  {
    id: 'twilio',
    name: 'Twilio Elastic SIP',
    description: 'Twilio Elastic SIP Trunk — REGISTER required',
    uriTemplate: 'sip:{number}@{accountSid}.pstn.twilio.com',
    transport: 'tcp',
    headers: {},
    codecs: ['PCMU', 'PCMA'],
    authRequired: true,
    placeholders: {
      number: '+15551234567',
      accountSid: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    },
  },
  {
    id: 'asterisk',
    name: 'Asterisk / FreePBX',
    description: 'Self-hosted PBX — standard SIP',
    uriTemplate: 'sip:{extension}@{host}:5060',
    transport: 'udp',
    headers: {},
    codecs: ['PCMU', 'PCMA', 'G722'],
    authRequired: true,
    placeholders: {
      extension: '100',
      host: '192.168.1.100',
    },
  },
  {
    id: 'generic',
    name: 'Generic SIP',
    description: 'Blank template — configure everything manually',
    uriTemplate: 'sip:{user}@{host}',
    transport: 'auto',
    headers: {},
    codecs: ['opus', 'PCMU'],
    authRequired: false,
    placeholders: {
      user: 'agent',
      host: 'example.com',
    },
  },
];

export function resolvePresetUri(preset: SipPreset, values: Record<string, string>): string {
  let uri = preset.uriTemplate;
  for (const [key, defaultVal] of Object.entries(preset.placeholders)) {
    uri = uri.replace(`{${key}}`, values[key] || defaultVal);
  }
  return uri;
}

export function resolvePresetHeaders(preset: SipPreset, values: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [hdr, val] of Object.entries(preset.headers)) {
    let resolved = val;
    for (const [key, defaultVal] of Object.entries(preset.placeholders)) {
      resolved = resolved.replace(`{${key}}`, values[key] || defaultVal);
    }
    result[hdr] = resolved;
  }
  return result;
}
