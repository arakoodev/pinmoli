/**
 * Tests for eslint-plugin-pinmoli
 *
 * Each rule was born from a real mistake. These tests encode the exact
 * patterns that caused bugs so they can never recur.
 */

import { describe, it } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { RuleTester } = require('eslint');
const plugin = require('../../eslint-plugin-pinmoli.cjs');

const ruleTester = new RuleTester({
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

// ---------- Rule 1: no-console-in-lib ----------

describe('pinmoli/no-console-in-lib', () => {
  it('flags console.log, console.error, console.warn', () => {
    ruleTester.run('no-console-in-lib', plugin.rules['no-console-in-lib'], {
      valid: [
        // No console usage
        'const x = 1;',
        // A variable named console but not the global
        'const console = { log() {} }; console.log("ok");',
      ],
      invalid: [
        {
          code: 'console.log("hello");',
          errors: [{ messageId: 'forbidden', data: { method: 'log' } }],
        },
        {
          code: 'console.error(`RTP send error: ${err.message}`);',
          errors: [{ messageId: 'forbidden', data: { method: 'error' } }],
        },
        {
          code: 'console.warn("deprecated");',
          errors: [{ messageId: 'forbidden', data: { method: 'warn' } }],
        },
        {
          code: 'console.info("starting");',
          errors: [{ messageId: 'forbidden', data: { method: 'info' } }],
        },
      ],
    });
  });
});

// ---------- Rule 2: no-process-exit ----------

describe('pinmoli/no-process-exit', () => {
  it('flags process.exit() calls', () => {
    ruleTester.run('no-process-exit', plugin.rules['no-process-exit'], {
      valid: [
        'process.env.NODE_ENV;',
        'process.argv;',
        'process.on("SIGTERM", handler);',
      ],
      invalid: [
        {
          code: 'process.exit(0);',
          errors: [{ messageId: 'forbidden' }],
        },
        {
          code: 'process.exit(1);',
          errors: [{ messageId: 'forbidden' }],
        },
        {
          code: 'if (fatal) process.exit();',
          errors: [{ messageId: 'forbidden' }],
        },
      ],
    });
  });
});

// ---------- Rule 3: no-shared-tmp-path ----------

describe('pinmoli/no-shared-tmp-path', () => {
  it('flags hardcoded /tmp/ file paths', () => {
    ruleTester.run('no-shared-tmp-path', plugin.rules['no-shared-tmp-path'], {
      valid: [
        // Template literal with dynamic component (not a Literal node)
        'const f = `/tmp/speech-${Date.now()}.wav`;',
        // Not a /tmp/ path
        'const f = "/var/data/file.wav";',
        // Directory, not a file (no extension)
        'const f = "/tmp/pinmoli";',
        // Just /tmp/ without filename
        'const f = "/tmp/";',
      ],
      invalid: [
        {
          code: 'const f = "/tmp/speech.wav";',
          errors: [{ messageId: 'shared', data: { path: '/tmp/speech.wav' } }],
        },
        {
          code: 'spawn("espeak", [text, "-w", "/tmp/speech.wav"]);',
          errors: [{ messageId: 'shared', data: { path: '/tmp/speech.wav' } }],
        },
        {
          code: 'const out = "/tmp/output.pcm";',
          errors: [{ messageId: 'shared', data: { path: '/tmp/output.pcm' } }],
        },
      ],
    });
  });
});

// ---------- Rule 4: no-unabortable-spawn ----------

describe('pinmoli/no-unabortable-spawn', () => {
  it('flags spawn() in tool execute without signal handling', () => {
    ruleTester.run('no-unabortable-spawn', plugin.rules['no-unabortable-spawn'], {
      valid: [
        // spawn() outside of tool execute — not our concern
        'const child = spawn("ls");',
        // Tool execute with signal handling
        `const tool = {
          async execute(id, params, signal, onUpdate) {
            const child = spawn("ffmpeg", []);
            signal.addEventListener("abort", () => child.kill());
          }
        };`,
        // Tool execute that checks signal.aborted
        `const tool = {
          async execute(id, params, signal, onUpdate) {
            const child = spawn("ffmpeg", []);
            if (signal.aborted) child.kill();
          }
        };`,
        // Tool execute without spawn — no issue
        `const tool = {
          async execute(id, params, signal, onUpdate) {
            return { content: [] };
          }
        };`,
      ],
      invalid: [
        // The exact pattern from generate-audio.ts: spawn without signal
        {
          code: `const tool = {
            async execute(id, params, signal, onUpdate) {
              const child = spawn("ffmpeg", ["-f", "lavfi"]);
              child.on("close", (code) => {});
            }
          };`,
          errors: [{ messageId: 'unabortable' }],
        },
      ],
    });
  });
});

// ---------- Rule 5: no-unroutable-ip-fallback ----------

describe('pinmoli/no-unroutable-ip-fallback', () => {
  it('flags 0.0.0.0 and 127.0.0.1 as IP fallbacks', () => {
    ruleTester.run('no-unroutable-ip-fallback', plugin.rules['no-unroutable-ip-fallback'], {
      valid: [
        // Dynamic IP from os.networkInterfaces()
        'let localIp = getLocalIp();',
        // 0.0.0.0 used in a non-IP context (e.g., socket bind)
        'socket.bind(0);',
        // Variable name doesn't suggest IP
        'let timeout = "0.0.0.0";',
        // 127.0.0.1 in a test assertion — not a variable named *ip*
        'expect(result).toBe("127.0.0.1");',
      ],
      invalid: [
        // The exact pattern from engine.ts:62
        {
          code: 'let localIp = "0.0.0.0";',
          errors: [{ messageId: 'unroutable', data: { ip: '0.0.0.0' } }],
        },
        // The exact pattern from network/utils.ts:16
        {
          code: 'function getLocalIp() { return "127.0.0.1"; }',
          errors: [{ messageId: 'unroutable', data: { ip: '127.0.0.1' } }],
        },
        {
          code: 'let hostAddress = "0.0.0.0";',
          errors: [{ messageId: 'unroutable', data: { ip: '0.0.0.0' } }],
        },
      ],
    });
  });
});

// ---------- Rule 6: no-random-sip-port ----------

describe('pinmoli/no-random-sip-port', () => {
  it('flags Math.random() in port assignments', () => {
    ruleTester.run('no-random-sip-port', plugin.rules['no-random-sip-port'], {
      valid: [
        // Fixed port
        'const localPort = 5060;',
        // OS-assigned port (bind to 0)
        'socket.bind(0);',
        // Math.random() for non-port use
        'const callId = Math.random().toString(36);',
        'const tag = Math.random().toString(36).substr(2, 9);',
      ],
      invalid: [
        // The exact pattern from transport.ts:42
        {
          code: 'const localPort = 5060 + Math.floor(Math.random() * 1000);',
          errors: [{ messageId: 'random' }],
        },
        {
          code: 'let sipPort = Math.floor(Math.random() * 65535);',
          errors: [{ messageId: 'random' }],
        },
      ],
    });
  });
});

// ---------- Rule 7: no-unrefed-timer-in-sip ----------

describe('pinmoli/no-unrefed-timer-in-sip', () => {
  it('flags setTimeout without .unref()', () => {
    ruleTester.run('no-unrefed-timer-in-sip', plugin.rules['no-unrefed-timer-in-sip'], {
      valid: [
        // Chained .unref()
        'setTimeout(() => {}, 1000).unref();',
        // Assigned to variable (may be unref'd later)
        'const timer = setTimeout(() => {}, 1000);',
        'let t = setTimeout(() => {}, 1000);',
      ],
      invalid: [
        // The exact pattern from rtp-receiver.ts:187
        {
          code: 'setTimeout(() => { socket.off("message", handler); }, duration * 1000);',
          errors: [{ messageId: 'unrefed' }],
        },
        // Bare setTimeout as an expression statement
        {
          code: 'setTimeout(resolve, 1000);',
          errors: [{ messageId: 'unrefed' }],
        },
      ],
    });
  });
});

// ---------- Rule 8: require-to-tag-in-dialog ----------

describe('pinmoli/require-to-tag-in-dialog', () => {
  it('flags ACK/BYE builders without toTag parameter', () => {
    ruleTester.run('require-to-tag-in-dialog', plugin.rules['require-to-tag-in-dialog'], {
      valid: [
        // ACK builder with toTag parameter
        'function buildAckRequest(uri, host, port, callId, fromTag, toTag, branch, localIp, localPort) { return ""; }',
        // BYE builder with toTag parameter
        'function buildByeRequest(uri, host, port, callId, fromTag, toTag, branch, localIp, localPort) { return ""; }',
        // Non-ACK/BYE function — not our concern
        'function buildInviteRequest(uri, host, port) { return ""; }',
        // Function with remoteTag
        'function buildAckRequest(uri, remoteTag) { return ""; }',
      ],
      invalid: [
        // The exact pattern from engine.ts:450 — has fromTag but NOT toTag
        {
          code: 'function buildAckRequest(uri, host, port, callId, fromTag, branch, localIp, localPort) { return ""; }',
          errors: [{ messageId: 'missingTag', data: { method: 'ACK' } }],
        },
        // The exact pattern from engine.ts:466
        {
          code: 'function buildByeRequest(uri, host, port, callId, fromTag, branch, localIp, localPort) { return ""; }',
          errors: [{ messageId: 'missingTag', data: { method: 'BYE' } }],
        },
        // fromTag alone is NOT sufficient — the remote tag is what's needed
        {
          code: 'function buildAckRequest(uri, fromTag) { return ""; }',
          errors: [{ messageId: 'missingTag', data: { method: 'ACK' } }],
        },
      ],
    });
  });
});

// ---------- Rule 9: no-setinterval-in-ui ----------

describe('pinmoli/no-setinterval-in-ui', () => {
  it('flags setInterval() in UI code', () => {
    ruleTester.run('no-setinterval-in-ui', plugin.rules['no-setinterval-in-ui'], {
      valid: [
        // setTimeout is fine
        'setTimeout(() => {}, 1000);',
        // Loader usage (the correct pattern)
        'const loader = new Loader(tui, green, dim, "Thinking...");',
        // requestAnimationFrame or other APIs
        'requestAnimationFrame(render);',
      ],
      invalid: [
        // The exact pattern from tui.ts — manual braille spinner
        {
          code: 'const id = setInterval(() => { frame++; tui.requestRender(); }, 200);',
          errors: [{ messageId: 'forbidden' }],
        },
        // Bare setInterval
        {
          code: 'setInterval(tick, 80);',
          errors: [{ messageId: 'forbidden' }],
        },
      ],
    });
  });
});

// ---------- Rule 10: require-cursor-hide-with-loader ----------

describe('pinmoli/require-cursor-hide-with-loader', () => {
  it('flags new Loader() without setShowHardwareCursor(false)', () => {
    ruleTester.run('require-cursor-hide-with-loader', plugin.rules['require-cursor-hide-with-loader'], {
      valid: [
        // Correct: hide cursor before creating Loader
        `function startThinking() {
          setShowHardwareCursor(false);
          const loader = new Loader(tui, green, dim, "Thinking...");
        }`,
        // Correct: method call on tui object
        `function startThinking() {
          tui.setShowHardwareCursor(false);
          const loader = new Loader(tui, green, dim, "Thinking...");
        }`,
        // No Loader — no issue
        `function doStuff() {
          const x = 1;
        }`,
        // Arrow function with cursor hide
        `const start = () => {
          setShowHardwareCursor(false);
          new Loader(tui, green, dim, "Working...");
        }`,
      ],
      invalid: [
        // The exact pattern from tui.ts — Loader without cursor hide
        {
          code: `function startThinking() {
            const loader = new Loader(tui, green, dim, "Thinking...");
          }`,
          errors: [{ messageId: 'missingCursorHide' }],
        },
        // Arrow function missing cursor hide
        {
          code: `const start = () => {
            new Loader(tui, green, dim, "Working...");
          }`,
          errors: [{ messageId: 'missingCursorHide' }],
        },
      ],
    });
  });
});

// ---------- Rule 10: no-hardcoded-payload-type ----------

describe('pinmoli/no-hardcoded-payload-type', () => {
  it('flags literal payload types in RTP code', () => {
    ruleTester.run('no-hardcoded-payload-type', plugin.rules['no-hardcoded-payload-type'], {
      valid: [
        // Using codec.payloadType (the correct pattern)
        'const pt = codec.payloadType;',
        'buildRTPPacket({ payloadType: codec.payloadType, sequenceNumber: 1 });',
        // Literal 0 not in a payloadType context
        'const x = 0;',
        'const count = 0;',
        // Codec table definitions (not RTP code)
        'const PCMU = { name: "PCMU", clockRate: 8000 };',
        // Literal in unrelated array
        'const arr = [0, 1, 2];',
      ],
      invalid: [
        // The exact pattern: hardcoded payloadType in object literal
        {
          code: 'buildRTPPacket({ payloadType: 0, sequenceNumber: 1 });',
          errors: [{ messageId: 'hardcoded', data: { value: 0 } }],
        },
        // Hardcoded PCMA payload type
        {
          code: 'buildRTPPacket({ payloadType: 8 });',
          errors: [{ messageId: 'hardcoded', data: { value: 8 } }],
        },
        // Comparison against hardcoded PT
        {
          code: 'if (packet.payloadType === 0) { handle(); }',
          errors: [{ messageId: 'hardcoded', data: { value: 0 } }],
        },
      ],
    });
  });
});

// ---------- Rule 11: no-optional-codec-in-media ----------

const tsRuleTester = new RuleTester({
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

describe('pinmoli/no-optional-codec-in-media', () => {
  it('flags optional codec parameters in media functions', () => {
    tsRuleTester.run('no-optional-codec-in-media', plugin.rules['no-optional-codec-in-media'], {
      valid: [
        // Required codec parameter (the correct pattern)
        'function saveAsWAV(data, path, codec) { }',
        // No codec parameter at all — fine
        'function parseHeaders(raw) { }',
        // Parameter named something else
        'function transcode(data, format) { }',
      ],
      invalid: [
        // The exact pattern from saveAsWAV: codec with default value
        {
          code: 'function saveAsWAV(data, path, codec = CODEC_TABLE.PCMU) { }',
          errors: [{ messageId: 'optional', data: { name: 'codec', fn: 'saveAsWAV' } }],
        },
      ],
    });
  });
});

// ---------- Rule 13: no-incomplete-enum-description ----------

describe('pinmoli/no-incomplete-enum-description', () => {
  it('flags Type.Union descriptions missing literal values', () => {
    ruleTester.run('no-incomplete-enum-description', plugin.rules['no-incomplete-enum-description'], {
      valid: [
        // All values mentioned in description
        `Type.Union([
          Type.Literal('opus'),
          Type.Literal('PCMU'),
          Type.Literal('PCMA'),
          Type.Literal('G722')
        ], {
          description: 'Audio codec: opus, PCMU (G.711 mu-law), PCMA (G.711 A-law), G722 (wideband).'
        })`,
        // No description — nothing to check
        `Type.Union([
          Type.Literal('opus'),
          Type.Literal('PCMU')
        ])`,
        // Non-string literals (numbers) — not checked
        `Type.Union([
          Type.Literal(1),
          Type.Literal(2)
        ], { description: 'A number.' })`,
        // Single literal — not meaningful to check
        `Type.Union([
          Type.Literal('opus')
        ], { description: 'Only opus.' })`,
        // Not a Type.Union call
        `SomeOther.Union([
          Type.Literal('a'),
          Type.Literal('b')
        ], { description: 'Only a.' })`,
      ],
      invalid: [
        // The exact bug: description mentions only opus and PCMU, missing PCMA and G722
        {
          code: `Type.Union([
            Type.Literal('opus'),
            Type.Literal('PCMU'),
            Type.Literal('PCMA'),
            Type.Literal('G722')
          ], {
            description: 'Audio codec. LiveKit typically selects PCMU. Offer opus for compatibility.'
          })`,
          errors: [{ messageId: 'incomplete', data: { missing: 'PCMA, G722' } }],
        },
        // Missing one value
        {
          code: `Type.Union([
            Type.Literal('udp'),
            Type.Literal('tcp'),
            Type.Literal('tls')
          ], {
            description: 'Transport: udp or tcp.'
          })`,
          errors: [{ messageId: 'incomplete', data: { missing: 'tls' } }],
        },
        // String concatenation in description
        {
          code: `Type.Union([
            Type.Literal('OPTIONS'),
            Type.Literal('INVITE'),
            Type.Literal('REGISTER')
          ], {
            description: 'SIP method. ' + 'OPTIONS or INVITE.'
          })`,
          errors: [{ messageId: 'incomplete', data: { missing: 'REGISTER' } }],
        },
      ],
    });
  });
});

// ---------- Rule 12: no-silent-transcode-fallback ----------

describe('pinmoli/no-silent-transcode-fallback', () => {
  it('flags transcode functions with silent identity fallback', () => {
    ruleTester.run('no-silent-transcode-fallback', plugin.rules['no-silent-transcode-fallback'], {
      valid: [
        // Transcode that throws for unsupported codecs (correct pattern)
        `function transcodePcmuTo(pcmuData, targetCodec) {
          if (targetCodec.name === 'PCMU') return pcmuData;
          if (targetCodec.name === 'PCMA') return convert(pcmuData);
          throw new Error('unsupported');
        }`,
        // Non-transcode function — not our concern
        `function getData(input, options) {
          if (options.fast) return input;
          return process(input);
        }`,
        // Transcode without the if-return pattern
        `function transcodePcmuTo(pcmuData, targetCodec) {
          return convert(pcmuData, targetCodec);
        }`,
      ],
      invalid: [
        // The exact pattern from codec.ts: identity fallback for unsupported codecs
        {
          code: `function transcodePcmuTo(pcmuData, targetCodec) {
            if (targetCodec.name === 'PCMU') return pcmuData;
            if (targetCodec.name === 'PCMA') return convert(pcmuData);
            return pcmuData;
          }`,
          errors: [{ messageId: 'silentFallback', data: { fn: 'transcodePcmuTo' } }],
        },
        // Any convert function with the same pattern
        {
          code: `function convertAudio(input, codec) {
            if (codec === 'wav') return toWav(input);
            return input;
          }`,
          errors: [{ messageId: 'silentFallback', data: { fn: 'convertAudio' } }],
        },
      ],
    });
  });
});
