import { Type, Static } from '@sinclair/typebox';
import os from 'os';

// Single source of truth for SIP events
export const SipEventSchema = Type.Object({
  type: Type.Union([
    Type.Literal('sip'),
    Type.Literal('rtp'),
    Type.Literal('network'),
    Type.Literal('diagnostic'),
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
  recovery: Type.Optional(Type.String())
});

export type SipEvent = Static<typeof SipEventSchema>;

// SIP protocol validation
export const SipUriSchema = Type.String({ 
  pattern: '^sips?:[a-zA-Z0-9@.:-]+$',
  description: 'Must be valid SIP URI (sip: or sips:)'
});

export const SipMethodSchema = Type.Union([
  Type.Literal('OPTIONS'),
  Type.Literal('INVITE'),
  Type.Literal('REGISTER')
]);

export const CodecSchema = Type.Union([
  Type.Literal('opus'),
  Type.Literal('PCMU'),
  Type.Literal('PCMA'),
  Type.Literal('G722')
]);

export const AudioSampleSchema = Type.Union([
  Type.Literal('sine-440hz'),
  Type.Literal('sine-1000hz'),
  Type.Literal('dtmf-123'),
  Type.Literal('voice-hello'),
  Type.Literal('silence')
]);

export const TransportSchema = Type.Union([
  Type.Literal('udp'),
  Type.Literal('tcp'),
  Type.Literal('tls'),
  Type.Literal('auto')
]);

// Test configuration
export const TestConfigSchema = Type.Object({
  uri: SipUriSchema,
  method: SipMethodSchema,
  codecs: Type.Array(CodecSchema, { minItems: 1 }),
  transport: TransportSchema,
  mediaPort: Type.Number({ minimum: 1024, maximum: 65535, default: 10000 }),
  timeout: Type.Number({ minimum: 1000, default: 5000 }),
  audioSample: Type.Optional(AudioSampleSchema),
  auth: Type.Optional(Type.Object({
    username: Type.Optional(Type.String()),
    password: Type.Optional(Type.String())
  })),
  headers: Type.Optional(Type.Record(Type.String(), Type.String())),
  customSdp: Type.Optional(Type.String())
});

export type TestConfig = Static<typeof TestConfigSchema>;

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
      Type.Literal('local')
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
