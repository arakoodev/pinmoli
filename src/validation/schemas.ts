import { Type, Static } from '@sinclair/typebox';
import os from 'os';

// Single source of truth for test events (SIP + WebRTC)
export const TestEventSchema = Type.Object({
  type: Type.Union([
    Type.Literal('sip'),
    Type.Literal('webrtc'),
    Type.Literal('rtp'),
    Type.Literal('network'),
    Type.Literal('diagnostic'),
    Type.Literal('dtmf'),
    Type.Literal('info'),
    Type.Literal('error')
  ]),
  timestamp: Type.Number(),
  message: Type.String(),
  method: Type.Optional(Type.String()),
  status: Type.Optional(Type.Number()),
  sdpOffer: Type.Optional(Type.String()),
  sdpAnswer: Type.Optional(Type.String()),
  severity: Type.Optional(Type.Union([
    Type.Literal('info'),
    Type.Literal('warning'),
    Type.Literal('error'),
    Type.Literal('fatal')
  ])),
  code: Type.Optional(Type.String()),
  recovery: Type.Optional(Type.String()),
  rawMessage: Type.Optional(Type.String()),
  dtmfDigit: Type.Optional(Type.String({ description: 'DTMF digit detected or sent (0-9, *, #, A-D)' })),
  dtmfDuration: Type.Optional(Type.Number({ description: 'DTMF digit duration in RTP timestamp units' }))
});

export type TestEvent = Static<typeof TestEventSchema>;

/** @deprecated Use TestEvent instead */
export type SipEvent = TestEvent;
/** @deprecated Use TestEventSchema instead */
export const SipEventSchema = TestEventSchema;

// SIP protocol validation
export const SipUriSchema = Type.String({
  pattern: '^sips?:[a-zA-Z0-9@.:+\\-]+$',
  description: 'SIP URI to test. For LiveKit (*.sip.livekit.cloud), MUST include a phone number — bare host returns 404. Format: sip:+1XXXXXXXXXX@host.',
  examples: ['sip:+15551234567@5eezfwavhxe.sip.livekit.cloud', 'sip:alice@pbx.example.com']
});

export const SipMethodSchema = Type.Union([
  Type.Literal('OPTIONS'),
  Type.Literal('INVITE'),
  Type.Literal('REGISTER')
], {
  description: 'SIP method. OPTIONS = connectivity check (no audio). INVITE = full call with audio. REGISTER = registration with auth.'
});

export const CodecSchema = Type.Union([
  Type.Literal('opus'),
  Type.Literal('PCMU'),
  Type.Literal('PCMA'),
  Type.Literal('G722')
], {
  description: 'Audio codec. LiveKit typically selects PCMU. Offer ["opus", "PCMU"] for compatibility.'
});

export const AudioSampleSchema = Type.Union([
  Type.Literal('sine-440hz'),
  Type.Literal('sine-1000hz'),
  Type.Literal('dtmf-123'),
  Type.Literal('voice-hello'),
  Type.Literal('silence')
], {
  description: 'Audio to send during INVITE. "voice-hello" recommended for voice agents, "silence" to just listen.'
});

export const TransportSchema = Type.Union([
  Type.Literal('udp'),
  Type.Literal('tcp'),
  Type.Literal('tls'),
  Type.Literal('auto')
], {
  description: 'Transport protocol. "auto" recommended for most cases. Use "tls" for sips: URIs.'
});

// Test configuration
export const TestConfigSchema = Type.Object({
  uri: SipUriSchema,
  method: SipMethodSchema,
  codecs: Type.Array(CodecSchema, {
    minItems: 1,
    description: 'Codecs to offer in SDP. LiveKit typically selects PCMU. Offer ["opus", "PCMU"] for compatibility.',
    examples: [['opus', 'PCMU']]
  }),
  transport: TransportSchema,
  mediaPort: Type.Number({ minimum: 1024, maximum: 65535, default: 10000 }),
  timeout: Type.Number({
    minimum: 1000,
    default: 5000,
    description: 'SIP transaction timeout in milliseconds.',
    examples: [5000, 30000]
  }),
  audioSample: Type.Optional(AudioSampleSchema),
  responseWaitTime: Type.Optional(Type.Number({
    minimum: 0,
    maximum: 60,
    default: 10,
    description: 'Seconds to wait for agent response after sending audio. Increase for slow agents.',
    examples: [10, 30]
  })),
  sendDelay: Type.Optional(Type.Number({
    minimum: 0,
    maximum: 60,
    default: 0,
    description: 'Seconds to listen for agent greeting BEFORE sending audio. 0 = send immediately. Use 8 for voice agents that speak first.',
    examples: [0, 8]
  })),
  auth: Type.Optional(Type.Object({
    username: Type.Optional(Type.String()),
    password: Type.Optional(Type.String())
  }, {
    description: 'Auth credentials. Usually required for REGISTER. Rarely needed for OPTIONS/INVITE.'
  })),
  headers: Type.Optional(Type.Record(Type.String(), Type.String(), {
    description: 'Custom SIP headers to include in the request.',
    examples: [{ 'X-Custom-Header': 'value' }]
  })),
  customSdp: Type.Optional(Type.String({
    description: 'Raw SDP to use instead of auto-generated. Must use CRLF line endings.'
  })),
  dtmfDigits: Type.Optional(Type.String({
    pattern: '^[0-9*#A-Da-d]+$',
    description: 'DTMF digits to send during the call (RFC 4733 telephone-event). e.g. "1234#"'
  }))
});

export type TestConfig = Static<typeof TestConfigSchema>;

// ICE server configuration
export const IceServerSchema = Type.Object({
  urls: Type.String({
    description: 'STUN/TURN server URL',
    examples: ['stun:stun.l.google.com:19302']
  }),
  username: Type.Optional(Type.String()),
  credential: Type.Optional(Type.String()),
});

// WebRTC test configuration
export const WebRtcTestConfigSchema = Type.Object({
  whipEndpoint: Type.String({
    description: 'WHIP endpoint URL (e.g. https://myproject.livekit.cloud/whip). RFC 9725.',
    examples: ['https://myproject.livekit.cloud/whip']
  }),
  bearerToken: Type.Optional(Type.String({
    description: 'Bearer token for authenticated WHIP endpoints (e.g. LiveKit participant token).'
  })),
  iceServers: Type.Optional(Type.Array(IceServerSchema, {
    description: 'STUN/TURN servers. Default: stun:stun.l.google.com:19302'
  })),
  audioSample: Type.Optional(AudioSampleSchema),
  sendDelay: Type.Optional(Type.Number({
    minimum: 0,
    maximum: 60,
    default: 0,
    description: 'Seconds to listen for agent greeting BEFORE sending audio. Use 5-8 for voice agents that speak first.',
    examples: [0, 5]
  })),
  responseWaitTime: Type.Optional(Type.Number({
    minimum: 0,
    maximum: 120,
    default: 10,
    description: 'Seconds to listen for agent response after sending audio.',
    examples: [10, 30]
  })),
  codec: Type.Optional(Type.Union([
    Type.Literal('opus'),
    Type.Literal('PCMU')
  ], {
    description: 'Audio codec. Default: opus. Most WebRTC platforms prefer opus.',
  })),
  timeout: Type.Optional(Type.Number({
    minimum: 1000,
    default: 10000,
    description: 'ICE/DTLS connection timeout in milliseconds.',
    examples: [10000, 30000]
  })),
  dtmfDigits: Type.Optional(Type.String({
    pattern: '^[0-9*#A-Da-d]+$',
    description: 'DTMF digits to send during the call (RFC 4733 telephone-event). e.g. "1234#"'
  })),
});

export type WebRtcTestConfig = Static<typeof WebRtcTestConfigSchema>;

// Storage path validation helper
export function isValidStoragePath(path: string): boolean {
  return path.startsWith(os.homedir() + '/.pinmoli/');
}

// Configuration schema
export const ConfigSchema = Type.Object({
  llm: Type.Object({
    provider: Type.Union([
      Type.Literal('anthropic'),
      Type.Literal('openai'),
      Type.Literal('google'),
      Type.Literal('google-vertex'),
      Type.Literal('groq'),
      Type.Literal('openrouter'),
    ]),
    model: Type.String(),
    apiKey: Type.Optional(Type.String())
  }),
  sip: Type.Object({
    defaultPort: Type.Number({ default: 5060 }),
    timeout: Type.Number({ default: 30000 }),
    maxDuration: Type.Number({ default: 300 })
  }),
  ui: Type.Object({
    maxTimelineEvents: Type.Number({ default: 1000 })
  })
});

export type Config = Static<typeof ConfigSchema>;

// Saved request schema
export const SavedRequestSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  config: TestConfigSchema,
  timestamp: Type.Number(),
  result: Type.Optional(Type.Union([
    Type.Literal('success'),
    Type.Literal('error')
  ])),
  statusCode: Type.Optional(Type.Number())
});

export type SavedRequest = Static<typeof SavedRequestSchema>;
