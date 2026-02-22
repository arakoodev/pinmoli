import { z } from 'zod';
import os from 'os';

// Single source of truth for SIP events
export const SipEventSchema = z.object({
  type: z.enum(['sip', 'rtp', 'network', 'diagnostic', 'info', 'error']),
  timestamp: z.number(),
  message: z.string(),
  method: z.string().optional(),
  status: z.number().optional(),
  sdpOffer: z.string().optional(),
  sdpAnswer: z.string().optional(),
  severity: z.enum(['info', 'warning', 'error', 'fatal']).optional(),
  code: z.string().optional(),
  recovery: z.string().optional()
});

export type SipEvent = z.infer<typeof SipEventSchema>;

// SIP protocol validation
export const SipUriSchema = z.string().regex(/^sips?:[^;?]+/, 'Must be valid SIP URI (sip: or sips:)');
export const SipMethodSchema = z.enum(['OPTIONS', 'INVITE', 'REGISTER']);
export const CodecSchema = z.enum(['opus', 'PCMU', 'PCMA', 'G722']);
export const TransportSchema = z.enum(['udp', 'tcp', 'tls', 'auto']);

// Test configuration
export const TestConfigSchema = z.object({
  uri: SipUriSchema,
  method: SipMethodSchema,
  codecs: z.array(CodecSchema).min(1, 'At least one codec required'),
  transport: TransportSchema,
  mediaPort: z.number().int().min(1024).max(65535).default(10000),
  timeout: z.number().int().min(1000).default(5000),
  auth: z.object({
    username: z.string().optional(),
    password: z.string().optional()
  }).optional(),
  headers: z.record(z.string()).optional(),
  customSdp: z.string().optional()
});

export type TestConfig = z.infer<typeof TestConfigSchema>;

// Storage path validation
export const StoragePathSchema = z.string().refine(
  (path) => path.startsWith(os.homedir() + '/.pinmoli/'),
  'Path must be within ~/.pinmoli/ directory'
);

// Configuration schema
export const ConfigSchema = z.object({
  llm: z.object({
    provider: z.enum(['anthropic', 'openai', 'local']),
    model: z.string(),
    apiKey: z.string().optional()
  }),
  sip: z.object({
    defaultPort: z.number().default(5060),
    timeout: z.number().default(30000),
    maxDuration: z.number().default(300)
  }),
  ui: z.object({
    maxTimelineEvents: z.number().default(1000)
  })
});

export type Config = z.infer<typeof ConfigSchema>;

// Saved request schema
export const SavedRequestSchema = z.object({
  id: z.string(),
  name: z.string(),
  config: TestConfigSchema,
  timestamp: z.number(),
  result: z.enum(['success', 'error']).optional(),
  statusCode: z.number().optional()
});

export type SavedRequest = z.infer<typeof SavedRequestSchema>;
