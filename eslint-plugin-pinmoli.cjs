/**
 * eslint-plugin-pinmoli — Custom ESLint rules for Pinmoli correctness.
 *
 * Every rule here was extracted from a real bug in this codebase —
 * mistakes made by Claude Code that caused silent failures, corrupted
 * TUI output, or violated SIP protocol requirements.
 */

const plugin = {
  meta: { name: 'eslint-plugin-pinmoli', version: '1.0.0' },
  rules: {

    /* ------------------------------------------------------------------ */
    /* Rule 1 — pinmoli/no-console-in-lib                                 */
    /*                                                                    */
    /* When the TUI is in raw terminal mode, console.log/error writes     */
    /* directly to stdout/stderr and corrupts the display. Library code   */
    /* must communicate through the event system (yield events, onUpdate  */
    /* callbacks), not console.*.                                         */
    /*                                                                    */
    /* Origin: rtp-receiver.ts:152 had console.error("RTP send error:")   */
    /* which garbled the TUI during packet loss.                          */
    /* ------------------------------------------------------------------ */
    'no-console-in-lib': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Disallow console.log/warn/error in library code. ' +
            'The TUI owns the terminal; direct writes corrupt the display.',
        },
        schema: [],
        messages: {
          forbidden:
            'console.{{method}}() in library code corrupts the TUI display. ' +
            'Use the event system (yield events, onUpdate callbacks) instead.',
        },
      },
      create(context) {
        const METHODS = ['log', 'warn', 'error', 'info', 'debug'];
        return {
          MemberExpression(node) {
            if (
              node.object.type === 'Identifier' &&
              node.object.name === 'console' &&
              node.property.type === 'Identifier' &&
              METHODS.includes(node.property.name)
            ) {
              context.report({
                node,
                messageId: 'forbidden',
                data: { method: node.property.name },
              });
            }
          },
        };
      },
    },

    /* ------------------------------------------------------------------ */
    /* Rule 2 — pinmoli/no-process-exit                                   */
    /*                                                                    */
    /* process.exit() in library/UI code skips cleanup: active SIP calls  */
    /* don't send BYE, UDP sockets aren't closed, tini can't forward      */
    /* SIGTERM to children. Only the CLI entry point should call exit().   */
    /*                                                                    */
    /* Origin: tui.ts:128 called process.exit(0) from the Ctrl+C handler */
    /* inside the TUI widget — active calls were abandoned without BYE.   */
    /* ------------------------------------------------------------------ */
    'no-process-exit': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Disallow process.exit() outside the CLI entry point. ' +
            'Library code must propagate errors, not force-quit.',
        },
        schema: [],
        messages: {
          forbidden:
            'process.exit() bypasses cleanup (no BYE for active SIP calls, no socket close). ' +
            'Throw an error or return a failure status instead. Only cli.ts may call process.exit().',
        },
      },
      create(context) {
        return {
          CallExpression(node) {
            const c = node.callee;
            if (
              c.type === 'MemberExpression' &&
              c.object.type === 'Identifier' &&
              c.object.name === 'process' &&
              c.property.type === 'Identifier' &&
              c.property.name === 'exit'
            ) {
              context.report({ node, messageId: 'forbidden' });
            }
          },
        };
      },
    },

    /* ------------------------------------------------------------------ */
    /* Rule 3 — pinmoli/no-shared-tmp-path                                */
    /*                                                                    */
    /* Hardcoded /tmp/foo.ext paths collide when two tool executions run  */
    /* concurrently — the second overwrites the first's temp file mid-    */
    /* read. Temp files must include a unique component (PID, timestamp,  */
    /* or random suffix).                                                 */
    /*                                                                    */
    /* Origin: generate-audio.ts:150 used /tmp/speech.wav — concurrent    */
    /* speech generation produced corrupted audio.                        */
    /* ------------------------------------------------------------------ */
    'no-shared-tmp-path': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Disallow hardcoded /tmp/ file paths. ' +
            'Concurrent tool executions will clobber each other.',
        },
        schema: [],
        messages: {
          shared:
            'Hardcoded temp path "{{path}}" is not concurrency-safe. ' +
            'Use a unique suffix: /tmp/speech-${Date.now()}.wav or /tmp/speech-${process.pid}.wav',
        },
      },
      create(context) {
        // Match /tmp/ followed by a static filename (no template expressions)
        const TMP_PATTERN = /^\/tmp\/[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/;
        return {
          Literal(node) {
            if (typeof node.value === 'string' && TMP_PATTERN.test(node.value)) {
              context.report({
                node,
                messageId: 'shared',
                data: { path: node.value },
              });
            }
          },
        };
      },
    },

    /* ------------------------------------------------------------------ */
    /* Rule 4 — pinmoli/no-unabortable-spawn                              */
    /*                                                                    */
    /* Tool execute() methods receive an AbortSignal to support Ctrl+C    */
    /* cancellation. If spawn() is called without wiring signal to        */
    /* childProcess.kill(), the user presses Ctrl+C but ffmpeg/espeak     */
    /* keeps running in the background.                                   */
    /*                                                                    */
    /* Origin: generate-audio.ts spawned ffmpeg and espeak without ever   */
    /* referencing the signal parameter — Ctrl+C left orphan processes.   */
    /* ------------------------------------------------------------------ */
    'no-unabortable-spawn': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Disallow spawn() in tool execute() without abort signal handling.',
        },
        schema: [],
        messages: {
          unabortable:
            'spawn() in a tool execute() method without signal handling. ' +
            'Wire signal.addEventListener("abort", () => child.kill()) so Ctrl+C stops child processes.',
        },
      },
      create(context) {
        let inToolExecute = false;
        let hasSignalRef = false;
        let spawnNodes = [];

        return {
          // Detect: async execute(toolCallId, params, signal, onUpdate)
          'Property[key.name="execute"] > :function'(node) {
            // Check if the third param is named "signal"
            if (node.params.length >= 3 && node.params[2].type === 'Identifier' && node.params[2].name === 'signal') {
              inToolExecute = true;
              hasSignalRef = false;
              spawnNodes = [];
            }
          },
          'Property[key.name="execute"] > :function:exit'(node) {
            if (inToolExecute) {
              // If we saw spawn() but never saw signal referenced beyond the parameter
              if (spawnNodes.length > 0 && !hasSignalRef) {
                for (const spawnNode of spawnNodes) {
                  context.report({ node: spawnNode, messageId: 'unabortable' });
                }
              }
              inToolExecute = false;
            }
          },
          CallExpression(node) {
            if (!inToolExecute) return;
            // Detect spawn() calls
            if (node.callee.type === 'Identifier' && node.callee.name === 'spawn') {
              spawnNodes.push(node);
            }
          },
          // Detect signal.addEventListener, signal.aborted, signal.onabort, etc.
          MemberExpression(node) {
            if (!inToolExecute) return;
            if (
              node.object.type === 'Identifier' &&
              node.object.name === 'signal' &&
              node.property.type === 'Identifier' &&
              ['addEventListener', 'aborted', 'onabort', 'removeEventListener'].includes(node.property.name)
            ) {
              hasSignalRef = true;
            }
          },
          // Also detect signal?.aborted (optional chaining)
          'ChainExpression > MemberExpression'(node) {
            if (!inToolExecute) return;
            if (
              node.object.type === 'Identifier' &&
              node.object.name === 'signal'
            ) {
              hasSignalRef = true;
            }
          },
        };
      },
    },

    /* ------------------------------------------------------------------ */
    /* Rule 5 — pinmoli/no-unroutable-ip-fallback                         */
    /*                                                                    */
    /* Assigning 0.0.0.0 or 127.0.0.1 as a fallback IP for SIP headers   */
    /* or SDP creates silently broken calls. Remote peers can't route     */
    /* responses or RTP media to these addresses. The code should throw   */
    /* instead of silently using an unroutable address.                   */
    /*                                                                    */
    /* Origin: engine.ts:62 initialized localIp = '0.0.0.0' and          */
    /* network/utils.ts:16 fell back to '127.0.0.1'. Both ended up in    */
    /* SDP c= lines and SIP Contact headers, causing silent ICE failures */
    /* and unroutable SIP responses.                                     */
    /* ------------------------------------------------------------------ */
    'no-unroutable-ip-fallback': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Disallow 0.0.0.0 or 127.0.0.1 as IP address fallbacks.',
        },
        schema: [],
        messages: {
          unroutable:
            '"{{ip}}" as IP fallback creates unroutable SDP/SIP headers. ' +
            'Throw an error if no routable interface is found — silent fallback to {{ip}} produces calls that connect but have no audio.',
        },
      },
      create(context) {
        const BAD_IPS = ['0.0.0.0', '127.0.0.1'];
        return {
          // Match: let localIp = '0.0.0.0', return '127.0.0.1', etc.
          Literal(node) {
            if (typeof node.value !== 'string') return;
            if (!BAD_IPS.includes(node.value)) return;

            const parent = node.parent;
            // Assignment: let ip = '0.0.0.0'
            if (parent.type === 'VariableDeclarator' && parent.init === node) {
              const name = parent.id.type === 'Identifier' ? parent.id.name.toLowerCase() : '';
              if (/ip|addr|host|address|local/.test(name)) {
                context.report({ node, messageId: 'unroutable', data: { ip: node.value } });
              }
            }
            // Return statement: return '127.0.0.1'
            if (parent.type === 'ReturnStatement') {
              context.report({ node, messageId: 'unroutable', data: { ip: node.value } });
            }
          },
        };
      },
    },

    /* ------------------------------------------------------------------ */
    /* Rule 6 — pinmoli/no-cwd-captures-default                           */
    /*                                                                    */
    /* resolve(process.cwd(), 'captures') makes session artifacts depend   */
    /* on the current checkout being writable. In Docker this is fine,     */
    /* but local tests/read-only worktrees fail before protocol logic      */
    /* even runs. Use getCapturesBaseDir()/PINMOLI_CAPTURES_DIR or a       */
    /* user-home fallback instead of hardcoding cwd-relative captures.     */
    /* ------------------------------------------------------------------ */
    'no-cwd-captures-default': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Disallow process.cwd()/captures as the default artifact root.',
        },
        schema: [],
        messages: {
          repoLocal:
            'process.cwd() + "captures" hardcodes artifacts into the current checkout. ' +
            'Use getCapturesBaseDir(), PINMOLI_CAPTURES_DIR, or a writable fallback outside the repo.',
        },
      },
      create(context) {
        return {
          CallExpression(node) {
            const callee = node.callee;
            const isPathCall = (
              (callee.type === 'Identifier' && ['join', 'resolve'].includes(callee.name)) ||
              (
                callee.type === 'MemberExpression' &&
                callee.property.type === 'Identifier' &&
                ['join', 'resolve'].includes(callee.property.name)
              )
            );
            if (!isPathCall || node.arguments.length < 2) return;

            const firstArg = node.arguments[0];
            const hasCapturesSegment = node.arguments.some(
              (arg) => arg.type === 'Literal' && arg.value === 'captures',
            );
            if (!hasCapturesSegment) return;

            if (
              firstArg.type === 'CallExpression' &&
              firstArg.callee.type === 'MemberExpression' &&
              firstArg.callee.object.type === 'Identifier' &&
              firstArg.callee.object.name === 'process' &&
              firstArg.callee.property.type === 'Identifier' &&
              firstArg.callee.property.name === 'cwd'
            ) {
              context.report({ node, messageId: 'repoLocal' });
            }
          },
        };
      },
    },

    /* ------------------------------------------------------------------ */
    /* Rule 7 — pinmoli/no-random-sip-port                                */
    /*                                                                    */
    /* Math.random() for SIP port produces ports that don't match Docker  */
    /* port exposure. The Contact header advertises an unreachable port.  */
    /* SIP responses and RTP media go to a port the container doesn't     */
    /* expose.                                                            */
    /*                                                                    */
    /* Origin: transport.ts:42 used 5060 + Math.floor(Math.random() *     */
    /* 1000), advertising random ports that Docker never exposes.         */
    /* ------------------------------------------------------------------ */
    'no-random-sip-port': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Disallow Math.random() for SIP/RTP port assignment.',
        },
        schema: [],
        messages: {
          random:
            'Math.random() for port assignment produces ports that don\'t match Docker/firewall exposure. ' +
            'Use a fixed port (5060 for SIP, 10000 for RTP) or bind to port 0 and read the assigned port.',
        },
      },
      create(context) {
        return {
          CallExpression(node) {
            // Match Math.random() in expressions near port-related code
            if (
              node.callee.type === 'MemberExpression' &&
              node.callee.object.type === 'Identifier' &&
              node.callee.object.name === 'Math' &&
              node.callee.property.type === 'Identifier' &&
              node.callee.property.name === 'random'
            ) {
              // Walk up to find if this is in a port assignment context
              let current = node.parent;
              let depth = 0;
              while (current && depth < 6) {
                if (current.type === 'VariableDeclarator') {
                  const name = current.id.type === 'Identifier'
                    ? current.id.name.toLowerCase()
                    : '';
                  if (/port/.test(name)) {
                    context.report({ node, messageId: 'random' });
                    return;
                  }
                }
                if (current.type === 'AssignmentExpression') {
                  const left = current.left;
                  if (left.type === 'Identifier' && /port/i.test(left.name)) {
                    context.report({ node, messageId: 'random' });
                    return;
                  }
                }
                current = current.parent;
                depth++;
              }
            }
          },
        };
      },
    },

    /* ------------------------------------------------------------------ */
    /* Rule 8 — pinmoli/no-unrefed-timer-in-sip                          */
    /*                                                                    */
    /* setTimeout() keeps the Node.js event loop alive. In SIP code,     */
    /* this means the process hangs after Ctrl+C because the RTP receive */
    /* timer is still pending. Timer.unref() allows the process to exit  */
    /* if the timer is the only thing keeping it alive.                   */
    /*                                                                    */
    /* Origin: rtp-receiver.ts:187 had a duration*1000ms setTimeout      */
    /* without unref() — process hung for up to 60s after the user       */
    /* pressed Ctrl+C.                                                   */
    /* ------------------------------------------------------------------ */
    'no-unrefed-timer-in-sip': {
      meta: {
        type: 'suggestion',
        docs: {
          description:
            'Require .unref() on setTimeout in SIP/RTP code to prevent process hangs.',
        },
        schema: [],
        messages: {
          unrefed:
            'setTimeout() without .unref() keeps the event loop alive. ' +
            'Call .unref() on the timer so the process can exit cleanly on Ctrl+C/SIGTERM.',
        },
      },
      create(context) {
        return {
          CallExpression(node) {
            if (
              node.callee.type === 'Identifier' &&
              node.callee.name === 'setTimeout'
            ) {
              const parent = node.parent;
              // OK: const timer = setTimeout(...); timer.unref() — too complex to track
              // Catch: bare setTimeout(...) not assigned or not chained with .unref()
              // Check for: setTimeout(...).unref()  (chained call)
              if (
                parent.type === 'MemberExpression' &&
                parent.property.type === 'Identifier' &&
                parent.property.name === 'unref'
              ) {
                return; // OK — .unref() is chained
              }
              // Check for: const t = setTimeout(...) and then t.unref() nearby
              // This is hard to track statically, so we flag unless chained.
              // Assignment + later unref is acceptable but we can't prove it.
              if (parent.type === 'VariableDeclarator') {
                // Assigned to variable — may be unref'd later. Skip.
                return;
              }
              if (parent.type === 'AssignmentExpression' && parent.right === node) {
                // Assigned to variable — may be unref'd later. Skip.
                return;
              }
              context.report({ node, messageId: 'unrefed' });
            }
          },
        };
      },
    },

    /* ------------------------------------------------------------------ */
    /* Rule 9 — pinmoli/require-to-tag-in-dialog                          */
    /*                                                                    */
    /* RFC 3261 Section 12.2.1.1: Requests within a dialog (ACK, BYE)    */
    /* MUST include the remote tag in the To header. Without it, some     */
    /* SIP servers reject the request or can't match it to the dialog.   */
    /*                                                                    */
    /* Origin: engine.ts buildAckRequest() and buildByeRequest() both     */
    /* constructed To: <${uri}> without ;tag= from the 200 OK response.  */
    /* LiveKit silently accepted, but other servers would reject.         */
    /* ------------------------------------------------------------------ */
    'require-to-tag-in-dialog': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Require To-tag in ACK and BYE SIP message builders.',
        },
        schema: [],
        messages: {
          missingTag:
            '{{method}} request missing To-tag. RFC 3261 requires in-dialog requests ' +
            '(ACK, BYE) to include the remote tag: To: <${uri}>;tag=${toTag}. ' +
            'Extract the To-tag from the response that created the dialog (e.g., 200 OK).',
        },
      },
      create(context) {
        return {
          FunctionDeclaration(node) {
            checkFunction(context, node);
          },
          FunctionExpression(node) {
            checkFunction(context, node);
          },
          ArrowFunctionExpression(node) {
            checkFunction(context, node);
          },
        };
      },
    },

    /* ------------------------------------------------------------------ */
    /* Rule 10 — pinmoli/no-setinterval-in-ui                              */
    /*                                                                    */
    /* pi-tui provides Loader and CancellableLoader for animations with   */
    /* proper cursor management, synchronized output (CSI 2026), and      */
    /* 80ms frame timing. Raw setInterval bypasses the render pipeline,   */
    /* causing flicker and unsynchronized cursor positioning.             */
    /*                                                                    */
    /* Origin: tui.ts had a manual setInterval at 200ms cycling braille   */
    /* frames + calling requestRender(). Should have been new Loader().   */
    /* ------------------------------------------------------------------ */
    'no-setinterval-in-ui': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Disallow setInterval() in UI code. ' +
            'Use pi-tui Loader/CancellableLoader for animations.',
        },
        schema: [],
        messages: {
          forbidden:
            'setInterval() in UI code bypasses pi-tui\'s render pipeline (synchronized output, differential rendering, cursor tracking). ' +
            'Use new Loader(tui, colorFn, colorFn, "label") or CancellableLoader instead.',
        },
      },
      create(context) {
        return {
          CallExpression(node) {
            if (
              node.callee.type === 'Identifier' &&
              node.callee.name === 'setInterval'
            ) {
              context.report({ node, messageId: 'forbidden' });
            }
          },
        };
      },
    },

    /* ------------------------------------------------------------------ */
    /* Rule 11 — pinmoli/no-hardcoded-payload-type                        */
    /*                                                                    */
    /* Literal payload type numbers (0, 8, 9, 111) in RTP code bypass     */
    /* codec negotiation. When the code says payloadType: 0 or filters    */
    /* packets with === 0, it assumes PCMU. If the SDP answer selects     */
    /* PCMA (PT=8) or G722 (PT=9), those packets are silently dropped     */
    /* or sent with the wrong encoding.                                   */
    /*                                                                    */
    /* Origin: receiveRTPAudio() defaulted acceptedPayloadTypes to [0],   */
    /* meaning PCMA/G722 packets were silently dropped. sendRTPFromSocket  */
    /* used payloadType: 0 instead of codec.payloadType.                  */
    /* ------------------------------------------------------------------ */
    'no-hardcoded-payload-type': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Disallow literal RTP payload type numbers. ' +
            'Use codec.payloadType from the negotiated CodecInfo instead.',
        },
        schema: [],
        messages: {
          hardcoded:
            'Hardcoded payload type {{value}} bypasses codec negotiation. ' +
            'Use codec.payloadType (from CODEC_TABLE or parseSdpAnswer result) instead of a literal number. ' +
            'Hardcoded PTs silently break when the negotiated codec is not PCMU.',
        },
      },
      create(context) {
        // Known static payload types that indicate hardcoded PCMU/PCMA/G722 assumptions
        const KNOWN_PTS = new Set([0, 8, 9, 111]);
        return {
          // Match: payloadType: 0, payloadType === 0, etc.
          Literal(node) {
            if (typeof node.value !== 'number') return;
            if (!KNOWN_PTS.has(node.value)) return;

            const parent = node.parent;

            // Property assignment: { payloadType: 0 }
            // Exclude CODEC_TABLE definitions (the source of truth)
            if (
              parent.type === 'Property' &&
              parent.value === node &&
              parent.key.type === 'Identifier' &&
              parent.key.name === 'payloadType'
            ) {
              // Walk up to check if this is inside CODEC_TABLE or a codec definition object
              if (!isInsideCodecTable(node)) {
                context.report({ node, messageId: 'hardcoded', data: { value: node.value } });
              }
              return;
            }

            // Binary comparison: packet.payloadType === 0
            if (
              parent.type === 'BinaryExpression' &&
              ['===', '==', '!==', '!='].includes(parent.operator)
            ) {
              const other = parent.left === node ? parent.right : parent.left;
              if (
                other.type === 'MemberExpression' &&
                other.property.type === 'Identifier' &&
                other.property.name === 'payloadType'
              ) {
                context.report({ node, messageId: 'hardcoded', data: { value: node.value } });
                return;
              }
            }

            // Array literal default for acceptedPayloadTypes: ?? [0]
            if (parent.type === 'ArrayExpression' && parent.elements.length === 1) {
              const grandparent = parent.parent;
              // ?? [0]  or || [0]
              if (
                grandparent.type === 'LogicalExpression' &&
                (grandparent.operator === '??' || grandparent.operator === '||')
              ) {
                // Check if left side references "acceptedPayloadTypes" or "payloadType"
                const sourceCode = context.getSourceCode();
                const leftText = sourceCode.getText(grandparent.left);
                if (/payload|acceptedP/i.test(leftText)) {
                  context.report({ node, messageId: 'hardcoded', data: { value: node.value } });
                  return;
                }
              }
            }
          },
        };
      },
    },

    /* ------------------------------------------------------------------ */
    /* Rule 11 — pinmoli/no-optional-codec-in-media                       */
    /*                                                                    */
    /* Making the codec parameter optional in media functions means        */
    /* callers can silently forget to pass it. The function defaults to    */
    /* PCMU, producing wrong WAV format codes, wrong RTP payload types,   */
    /* or wrong transcoding for the actual negotiated codec.              */
    /*                                                                    */
    /* Origin: saveAsWAV(data, path, codec?) defaulted to PCMU format     */
    /* code 7 in the WAV header. When called without codec for PCMA       */
    /* audio, the WAV header said "mulaw" but the data was alaw.          */
    /* receiveRTPAudio defaulted acceptedPayloadTypes to [0] (PCMU),      */
    /* silently dropping PCMA (PT=8) and G722 (PT=9) packets.             */
    /* ------------------------------------------------------------------ */
    'no-optional-codec-in-media': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Disallow optional codec parameters in media functions. ' +
            'Codec should be required so callers must explicitly specify it.',
        },
        schema: [],
        messages: {
          optional:
            'Optional codec parameter "{{name}}" in media function "{{fn}}". ' +
            'Make it required — defaulting to PCMU silently produces wrong output ' +
            'for any other negotiated codec (PCMA, G722, opus).',
        },
      },
      create(context) {
        return {
          // Match: function declarations/expressions/arrows with ?-annotated codec param
          FunctionDeclaration(node) { checkOptionalCodec(context, node); },
          FunctionExpression(node) { checkOptionalCodec(context, node); },
          ArrowFunctionExpression(node) { checkOptionalCodec(context, node); },
        };
      },
    },

    /* ------------------------------------------------------------------ */
    /* Rule 12 — pinmoli/no-silent-transcode-fallback                     */
    /*                                                                    */
    /* Transcoding functions that handle some codecs (PCMU, PCMA, G722)   */
    /* but return the input unchanged for others produce silent data      */
    /* corruption. The returned buffer has the wrong encoding but the     */
    /* RTP packet claims the correct codec PT — the peer can't decode it. */
    /*                                                                    */
    /* Origin: transcodePcmuTo() returned pcmuData unchanged for opus.    */
    /* The RTP packet had PT=111 (opus) but contained mu-law audio.       */
    /* No error, no warning. The peer got noise.                          */
    /* ------------------------------------------------------------------ */
    'no-silent-transcode-fallback': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Disallow silent fallback returns in transcode/convert functions. ' +
            'Must throw for unsupported codecs.',
        },
        schema: [],
        messages: {
          silentFallback:
            'Transcode function "{{fn}}" has a fallback return that silently ' +
            'passes through input data for unsupported codecs. This produces ' +
            'audio with the wrong encoding but the correct payload type label — ' +
            'the peer gets noise. Throw an error for unsupported codecs instead.',
        },
      },
      create(context) {
        return {
          FunctionDeclaration(node) { checkTranscodeFallback(context, node); },
          FunctionExpression(node) { checkTranscodeFallback(context, node); },
          ArrowFunctionExpression(node) { checkTranscodeFallback(context, node); },
        };
      },
    },

    /* ------------------------------------------------------------------ */
    /* Rule 13 — pinmoli/no-incomplete-enum-description                   */
    /*                                                                    */
    /* TypeBox Type.Union descriptions are the primary way the LLM learns */
    /* what values a tool parameter accepts. If the description mentions  */
    /* only a subset of the union's Literal values, the LLM rejects the  */
    /* rest — even though the schema technically allows them.             */
    /*                                                                    */
    /* Origin: CodecSchema was Type.Union([Literal('opus'),               */
    /* Literal('PCMU'), Literal('PCMA'), Literal('G722')]) but the       */
    /* description said "opus and PCMU". The LLM responded "I cannot run  */
    /* the test with g722 — the tool only supports opus and PCMU."        */
    /* ------------------------------------------------------------------ */
    'no-incomplete-enum-description': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Require TypeBox Union descriptions to mention all Literal values. ' +
            'The LLM reads descriptions to determine valid tool inputs.',
        },
        schema: [],
        messages: {
          incomplete:
            'Type.Union description is missing values: {{missing}}. ' +
            'The LLM reads description text (not schema definitions) to determine valid inputs. ' +
            'When a description mentions only a subset of values, the LLM rejects the rest.',
        },
      },
      create(context) {
        return {
          CallExpression(node) {
            // Match: Type.Union([Type.Literal(...), ...], { description: '...' })
            const callee = node.callee;
            if (
              callee.type !== 'MemberExpression' ||
              callee.object.type !== 'Identifier' ||
              callee.object.name !== 'Type' ||
              callee.property.type !== 'Identifier' ||
              callee.property.name !== 'Union'
            ) return;

            const args = node.arguments;
            if (args.length < 2) return;

            const arrayArg = args[0];
            const optionsArg = args[1];

            if (arrayArg.type !== 'ArrayExpression') return;
            if (optionsArg.type !== 'ObjectExpression') return;

            // Extract literal string values from Type.Literal('value') calls
            const literalValues = [];
            for (const element of arrayArg.elements) {
              if (
                element &&
                element.type === 'CallExpression' &&
                element.callee.type === 'MemberExpression' &&
                element.callee.object.type === 'Identifier' &&
                element.callee.object.name === 'Type' &&
                element.callee.property.type === 'Identifier' &&
                element.callee.property.name === 'Literal' &&
                element.arguments.length >= 1 &&
                element.arguments[0].type === 'Literal' &&
                typeof element.arguments[0].value === 'string'
              ) {
                literalValues.push(element.arguments[0].value);
              }
            }

            // Need at least 2 values for an incomplete description to matter
            if (literalValues.length < 2) return;

            // Find description property in options object
            const descProp = optionsArg.properties.find(p =>
              p.type === 'Property' &&
              p.key.type === 'Identifier' &&
              p.key.name === 'description'
            );

            if (!descProp) return;

            // Get description text from string literal or concatenation
            let descText = '';
            if (descProp.value.type === 'Literal' && typeof descProp.value.value === 'string') {
              descText = descProp.value.value;
            } else if (descProp.value.type === 'BinaryExpression' && descProp.value.operator === '+') {
              descText = extractConcatenatedString(descProp.value);
            }

            if (!descText) return;

            // Check which literal values are missing from the description (case-insensitive)
            const descLower = descText.toLowerCase();
            const missing = literalValues.filter(v => !descLower.includes(v.toLowerCase()));

            if (missing.length > 0) {
              context.report({
                node: descProp.value,
                messageId: 'incomplete',
                data: { missing: missing.join(', ') },
              });
            }
          },
        };
      },
    },

    /* ------------------------------------------------------------------ */
    /* Rule 14 — pinmoli/require-cursor-hide-with-loader                */
    /*                                                                    */
    /* When an animated component (Loader) triggers requestRender() every */
    /* 80ms, the hardware cursor gets repositioned on each render —       */
    /* causing visible flashing in the editor and next to rendered text.  */
    /* Must hide cursor before adding animated components.                */
    /*                                                                    */
    /* Origin: tui.ts startThinking() created new Loader(tui, ...) without*/
    /* hiding the cursor. Both the editor cursor and a phantom cursor     */
    /* next to "Thinking..." flashed rapidly.                             */
    /* ------------------------------------------------------------------ */
    'require-cursor-hide-with-loader': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Require setShowHardwareCursor(false) in functions that create a Loader. ' +
            'Without it, the hardware cursor flashes on every 80ms render cycle.',
        },
        schema: [],
        messages: {
          missingCursorHide:
            'new Loader() without setShowHardwareCursor(false) in the same function. ' +
            'The Loader triggers requestRender() every 80ms, repositioning the hardware cursor each time. ' +
            'Call setShowHardwareCursor(false) before creating the Loader to prevent cursor flashing.',
        },
      },
      create(context) {
        return {
          // Check function declarations, expressions, and arrow functions
          FunctionDeclaration(node) {
            checkLoaderCursorHide(context, node);
          },
          FunctionExpression(node) {
            checkLoaderCursorHide(context, node);
          },
          ArrowFunctionExpression(node) {
            checkLoaderCursorHide(context, node);
          },
          // Also check method definitions (class methods, object methods)
          'Property > :function'(node) {
            checkLoaderCursorHide(context, node);
          },
        };
      },
    },

    /* ------------------------------------------------------------------ */
    /* Rule 15 — pinmoli/require-cancel-with-invite                        */
    /*                                                                    */
    /* RFC 3261 Section 9: A UAC that gives up waiting for a final        */
    /* response to an INVITE MUST send CANCEL. Without it, the server     */
    /* keeps the transaction alive (retransmitting 180 Ringing) and the   */
    /* agent slot stays occupied until the server's own timer fires.      */
    /*                                                                    */
    /* Origin: engine.ts sent INVITE, got 180 Ringing, timed out, and    */
    /* just closed the socket. No CANCEL was sent. The engine then said   */
    /* "Test completed successfully" despite the call never being         */
    /* answered. The server kept retransmitting 180 for 32 seconds.       */
    /* ------------------------------------------------------------------ */
    'require-cancel-with-invite': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Files that build INVITE requests must also handle CANCEL. ' +
            'RFC 3261 requires CANCEL when giving up on a pending INVITE.',
        },
        schema: [],
        messages: {
          missingCancel:
            'This file builds SIP INVITE requests but has no CANCEL handling. ' +
            'RFC 3261 Section 9 requires sending CANCEL when a UAC gives up waiting ' +
            'for a final response to INVITE. Without CANCEL, the proxy keeps the ' +
            'transaction alive and the agent slot stays occupied.',
        },
      },
      create(context) {
        let hasInviteBuilder = false;
        let hasCancelRef = false;

        return {
          // Detect functions that build INVITE requests
          // Match: buildInviteRequest, or string literal 'INVITE' in a SIP message builder
          FunctionDeclaration(node) {
            if (node.id && /buildInvite/i.test(node.id.name)) {
              hasInviteBuilder = true;
            }
          },
          // Detect CANCEL references
          Literal(node) {
            if (typeof node.value === 'string' && /CANCEL/.test(node.value)) {
              hasCancelRef = true;
            }
          },
          Identifier(node) {
            if (/cancel/i.test(node.name) && /build|send|Cancel/.test(node.name)) {
              hasCancelRef = true;
            }
          },
          'Program:exit'(node) {
            if (hasInviteBuilder && !hasCancelRef) {
              context.report({ node, messageId: 'missingCancel' });
            }
          },
        };
      },
    },
    /* ------------------------------------------------------------------ */
    /* Rule 16 — pinmoli/no-stun-on-sip-socket                            */
    /*                                                                    */
    /* STUN is a media-layer NAT discovery technique. SIP has its own     */
    /* NAT traversal: the rport mechanism (RFC 3581). The client sends    */
    /* ;rport in Via, and the server fills in the observed source IP:port */
    /* from the UDP packet. Calling stunDiscoverAddress() on a SIP socket */
    /* is wrong because:                                                  */
    /*   1. STUN timeout → fallback to private LAN IP in Via/Contact     */
    /*   2. STUN-mapped port != what the SIP proxy sees (symmetric NAT)  */
    /*   3. Adds 2-3s latency for zero benefit                           */
    /*                                                                    */
    /* Origin: engine.ts called stunDiscoverAddress(sipSocket) in a       */
    /* Promise.all with the RTP socket. STUN timed out, fallback returned */
    /* 192.168.1.2, which went into Via/Contact. LiveKit's SIP proxy     */
    /* overwrote Via to 192.168.1.2:51286 — completely unroutable.       */
    /* ------------------------------------------------------------------ */
    'no-stun-on-sip-socket': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Disallow STUN discovery on SIP signaling sockets. ' +
            'SIP uses rport (RFC 3581) for NAT traversal, not STUN.',
        },
        schema: [],
        messages: {
          stunOnSip:
            'stunDiscoverAddress() called on SIP socket "{{name}}". ' +
            'STUN is for RTP/media sockets only — SIP relies on the rport mechanism (RFC 3581). ' +
            'A STUN timeout on the SIP socket falls back to a private IP in Via/Contact headers, ' +
            'making Pinmoli unreachable for SIP responses.',
        },
      },
      create(context) {
        return {
          CallExpression(node) {
            // Match: stunDiscoverAddress(sipSocket), stun*(sipSock), etc.
            const callee = node.callee;
            let fnName = '';
            if (callee.type === 'Identifier') {
              fnName = callee.name;
            } else if (
              callee.type === 'MemberExpression' &&
              callee.property.type === 'Identifier'
            ) {
              fnName = callee.property.name;
            }

            if (!/stun/i.test(fnName)) return;
            if (node.arguments.length === 0) return;

            const arg = node.arguments[0];
            if (arg.type === 'Identifier' && /sip|signaling/i.test(arg.name)) {
              context.report({
                node,
                messageId: 'stunOnSip',
                data: { name: arg.name },
              });
            }
          },
        };
      },
    },

    /* ------------------------------------------------------------------ */
    /* Rule 17 — pinmoli/require-rport-in-via                             */
    /*                                                                    */
    /* RFC 3581: A client behind NAT SHOULD include ;rport (with no       */
    /* value) in Via to explicitly request the server record and use the   */
    /* actual observed source port. Without it, the server MAY use the    */
    /* port from the Via header (which could be wrong behind NAT).        */
    /*                                                                    */
    /* Without rport, the temptation is to solve SIP NAT traversal with   */
    /* STUN on the SIP socket — which is wrong (see rule 16). rport is   */
    /* the correct, protocol-level mechanism.                             */
    /*                                                                    */
    /* Origin: engine.ts Via headers omitted ;rport. This led to a        */
    /* misguided attempt to STUN the SIP socket for NAT discovery (rule   */
    /* 16 bug), which timed out and put a private IP in Via/Contact.      */
    /* ------------------------------------------------------------------ */
    'require-rport-in-via': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Require ;rport in SIP Via headers. ' +
            'RFC 3581 — client must request rport for NAT traversal.',
        },
        schema: [],
        messages: {
          missingRport:
            'Via header missing ;rport parameter. RFC 3581 requires ;rport for reliable ' +
            'NAT traversal. Without it, the server may use the Via port (wrong behind NAT) ' +
            'instead of the observed source port. Add ;rport before ;branch=.',
        },
      },
      create(context) {
        return {
          TemplateLiteral(node) {
            // Build the full quasi text (ignoring expressions)
            const quasiText = node.quasis.map(q => q.value.raw).join('*');
            if (!/Via:\s*SIP\/2\.0/i.test(quasiText)) return;
            if (/;rport/.test(quasiText)) return;
            context.report({ node, messageId: 'missingRport' });
          },
          Literal(node) {
            if (typeof node.value !== 'string') return;
            if (!/Via:\s*SIP\/2\.0/i.test(node.value)) return;
            if (/;rport/.test(node.value)) return;
            context.report({ node, messageId: 'missingRport' });
          },
        };
      },
    },

    /* ------------------------------------------------------------------ */
    /* Rule 18 — pinmoli/no-unguarded-post-close-write                     */
    /*                                                                    */
    /* writeFileSync() or writeFlowJson() after closeDialog() inside a    */
    /* try block, without its own try/catch, is dangerous. If the write   */
    /* throws (disk full, permissions), the outer catch returns a "call   */
    /* failed" result even though the SIP call itself succeeded.          */
    /*                                                                    */
    /* Origin: run-scenarios.ts wrote scenario-manifest.json after        */
    /* closeDialog(). A writeFileSync failure would fall into the outer   */
    /* catch that returns passed:false — misrepresenting a successful     */
    /* call as failed.                                                    */
    /* ------------------------------------------------------------------ */
    'no-unguarded-post-close-write': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Require try/catch around file writes after closeDialog(). ' +
            'A disk error during post-call bookkeeping masks the successful call result.',
        },
        schema: [],
        messages: {
          unguarded:
            '{{fn}}() after closeDialog() is not guarded by its own try/catch. ' +
            'If this write throws (disk full, permissions), the outer catch will ' +
            'misreport the call as failed. Wrap post-close writes in try { } catch { }.',
        },
      },
      create(context) {
        return {
          TryStatement(node) {
            const block = node.block;
            if (!block || block.type !== 'BlockStatement') return;

            let afterClose = false;

            for (const stmt of block.body) {
              if (!afterClose) {
                if (astContainsCall(stmt, 'closeDialog')) {
                  afterClose = true;
                }
                continue;
              }

              // Nested try blocks are guarded — skip
              if (stmt.type === 'TryStatement') continue;

              // Flag unguarded write calls after closeDialog
              const WRITE_FNS = ['writeFileSync', 'writeFlowJson'];
              for (const fn of WRITE_FNS) {
                const writeNodes = findCallNodes(stmt, fn);
                for (const writeNode of writeNodes) {
                  context.report({
                    node: writeNode,
                    messageId: 'unguarded',
                    data: { fn },
                  });
                }
              }
            }
          },
        };
      },
    },

    /* ------------------------------------------------------------------ */
    /* Rule 19 — pinmoli/no-direct-mulaw-wrap                              */
    /*                                                                    */
    /* wrapMulawWav() is a low-level helper that wraps raw bytes in a     */
    /* mu-law WAV header. Calling it with PCM16 bytes (e.g. from Gemini   */
    /* TTS which returns audio/L16 24kHz) produces garbled noise —        */
    /* the header lies about the format, and 24kHz audio plays at 8kHz.   */
    /*                                                                    */
    /* Tool code must use wrapAudioAsWav(result) which reads the actual   */
    /* encoding field from the API response and dispatches correctly.     */
    /*                                                                    */
    /* Origin: generate-audio.ts called wrapMulawWav(samples) with PCM16  */
    /* bytes from Gemini TTS. The output was 6× time-stretched noise —    */
    /* unintelligible to both humans and the SIP voice agent.             */
    /* ------------------------------------------------------------------ */
    'no-direct-mulaw-wrap': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Disallow wrapMulawWav() in tool/consumer code. ' +
            'Use wrapAudioAsWav() which checks the actual audio encoding.',
        },
        schema: [],
        messages: {
          directWrap:
            'wrapMulawWav() wraps bytes as mu-law regardless of their actual encoding. ' +
            'Gemini TTS returns PCM16 24kHz, not mu-law — wrapping it as mu-law produces ' +
            '6× time-stretched noise. Use wrapAudioAsWav(result) which reads result.encoding ' +
            'and dispatches to the correct wrapper.',
        },
      },
      create(context) {
        return {
          CallExpression(node) {
            const callee = node.callee;
            if (callee.type !== 'Identifier' || callee.name !== 'wrapMulawWav') return;

            // Allow in tts.ts where it's defined as a low-level helper
            const filename = context.getFilename();
            if (filename.endsWith('tts.ts') || filename.endsWith('tts.js')) return;

            context.report({ node, messageId: 'directWrap' });
          },
        };
      },
    },
  },
};

/**
 * Check if a function that creates a Loader also calls setShowHardwareCursor(false).
 */
function checkLoaderCursorHide(context, node) {
  const body = node.body;
  if (!body) return;

  // Collect all nodes in the function body
  const sourceCode = context.getSourceCode();
  let hasLoader = false;
  let loaderNode = null;
  let hasCursorHide = false;

  // Walk all descendant nodes
  function walk(n) {
    if (!n || typeof n !== 'object') return;
    // Check for new Loader(
    if (
      n.type === 'NewExpression' &&
      n.callee &&
      n.callee.type === 'Identifier' &&
      n.callee.name === 'Loader'
    ) {
      hasLoader = true;
      if (!loaderNode) loaderNode = n;
    }
    // Check for setShowHardwareCursor(false)
    if (
      n.type === 'CallExpression' &&
      n.callee &&
      n.callee.type === 'Identifier' &&
      n.callee.name === 'setShowHardwareCursor' &&
      n.arguments.length >= 1 &&
      n.arguments[0].type === 'Literal' &&
      n.arguments[0].value === false
    ) {
      hasCursorHide = true;
    }
    // Also check method call: tui.setShowHardwareCursor(false), this.setShowHardwareCursor(false)
    if (
      n.type === 'CallExpression' &&
      n.callee &&
      n.callee.type === 'MemberExpression' &&
      n.callee.property &&
      n.callee.property.type === 'Identifier' &&
      n.callee.property.name === 'setShowHardwareCursor' &&
      n.arguments.length >= 1 &&
      n.arguments[0].type === 'Literal' &&
      n.arguments[0].value === false
    ) {
      hasCursorHide = true;
    }
    // Recurse into child nodes, but skip nested function boundaries
    if (
      n.type === 'FunctionDeclaration' ||
      n.type === 'FunctionExpression' ||
      n.type === 'ArrowFunctionExpression'
    ) {
      // Don't recurse into nested functions — scope is the containing function
      if (n !== node) return;
    }
    for (const key of Object.keys(n)) {
      if (key === 'parent') continue;
      const child = n[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item.type === 'string') walk(item);
        }
      } else if (child && typeof child.type === 'string') {
        walk(child);
      }
    }
  }

  walk(body);

  if (hasLoader && !hasCursorHide) {
    context.report({ node: loaderNode, messageId: 'missingCursorHide' });
  }
}

/**
 * Check if a function that builds ACK/BYE messages includes a toTag parameter.
 */
function checkFunction(context, node) {
  const name = node.id?.name || '';
  const isAck = /buildAck/i.test(name);
  const isBye = /buildBye/i.test(name);
  if (!isAck && !isBye) return;

  // Check if any parameter is named toTag, remoteTag, or similar.
  // IMPORTANT: fromTag does NOT count — that's the local tag.
  // The missing one is the REMOTE tag from the response.
  const paramNames = node.params
    .filter((p) => p.type === 'Identifier')
    .map((p) => p.name.toLowerCase());

  const hasTagParam = paramNames.some((n) =>
    /totag|remotetag|dialogtag/.test(n)
  );

  if (!hasTagParam) {
    context.report({
      node,
      messageId: 'missingTag',
      data: { method: isAck ? 'ACK' : 'BYE' },
    });
  }
}

/**
 * Check if a node is inside a CODEC_TABLE definition or similar codec constant.
 * CODEC_TABLE is the source of truth for payload types — literal values there are correct.
 */
function isInsideCodecTable(node) {
  let current = node.parent;
  let depth = 0;
  while (current && depth < 10) {
    // const CODEC_TABLE = { ... }
    if (
      current.type === 'VariableDeclarator' &&
      current.id.type === 'Identifier' &&
      /CODEC|codec_table|DTMF_DEFAULTS/i.test(current.id.name)
    ) {
      return true;
    }
    // Property in an object named like a codec: PCMU: { payloadType: 0 }
    if (
      current.type === 'Property' &&
      current.key.type === 'Identifier' &&
      /^(PCMU|PCMA|G722|opus)$/i.test(current.key.name)
    ) {
      return true;
    }
    current = current.parent;
    depth++;
  }
  return false;
}

/**
 * Check if a function has an optional parameter named "codec" (TypeScript optional ?:).
 * Only flags functions in media-related files (sip/, webrtc/, tools/).
 */
function checkOptionalCodec(context, node) {
  const fn = node.id?.name || '';
  for (const param of node.params) {
    // TypeScript optional: param?: Type  →  AssignmentPattern is param = default
    // In TS AST: Identifier with optional=true, or name ending with ?
    // ESLint TS parser: param.optional === true for `codec?: CodecInfo`
    let paramName = '';
    let isOptional = false;

    if (param.type === 'Identifier') {
      paramName = param.name;
      isOptional = param.optional === true;
    }
    // Also check AssignmentPattern: codec = CODEC_TABLE.PCMU (default value = optional)
    if (param.type === 'AssignmentPattern' && param.left.type === 'Identifier') {
      paramName = param.left.name;
      isOptional = true; // has a default value → effectively optional
    }

    if (/^codec$/i.test(paramName) && isOptional) {
      context.report({
        node: param,
        messageId: 'optional',
        data: { name: paramName, fn: fn || '(anonymous)' },
      });
    }
  }
}

/**
 * Check if a transcode/convert function has a silent fallback return.
 *
 * Pattern detected: function transcode*(input, target) {
 *   if (target.name === 'A') { ... return ...; }
 *   if (target.name === 'B') { ... return ...; }
 *   return input;  // ← FLAGGED: silent identity fallback
 * }
 *
 * The last return in a function named transcode or convert that returns
 * a parameter (first or second param name) without a preceding throw.
 */
function checkTranscodeFallback(context, node) {
  const name = node.id?.name || '';
  if (!/transcode|convert|encode|recode/i.test(name)) return;

  const body = node.body;
  if (!body || body.type !== 'BlockStatement') return;

  const stmts = body.body;
  if (stmts.length < 2) return; // too small to have the pattern

  // Collect parameter names (first and second)
  const paramNames = new Set();
  for (const p of node.params.slice(0, 2)) {
    if (p.type === 'Identifier') paramNames.add(p.name);
  }
  if (paramNames.size === 0) return;

  // Find the last statement in the function body
  const lastStmt = stmts[stmts.length - 1];
  if (lastStmt.type !== 'ReturnStatement' || !lastStmt.argument) return;

  // Check if it returns one of the input parameters (identity fallback)
  if (
    lastStmt.argument.type === 'Identifier' &&
    paramNames.has(lastStmt.argument.name)
  ) {
    // Make sure there's at least one if-return before it (the "handled cases" pattern)
    const hasIfReturn = stmts.some(s =>
      s.type === 'IfStatement' &&
      s.consequent &&
      containsReturn(s.consequent)
    );
    if (hasIfReturn) {
      context.report({
        node: lastStmt,
        messageId: 'silentFallback',
        data: { fn: name },
      });
    }
  }
}

/**
 * Extract a string from a BinaryExpression chain of string concatenations.
 * Handles: 'foo' + 'bar' + 'baz' → 'foobarbaz'
 */
function extractConcatenatedString(node) {
  if (node.type === 'Literal' && typeof node.value === 'string') {
    return node.value;
  }
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    const left = extractConcatenatedString(node.left);
    const right = extractConcatenatedString(node.right);
    if (left !== null && right !== null) return left + right;
  }
  return null;
}

/** Check if an AST node contains a ReturnStatement */
function containsReturn(node) {
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'ReturnStatement') return true;
  if (node.type === 'BlockStatement') {
    return node.body.some(s => containsReturn(s));
  }
  return false;
}

/**
 * Check if an AST subtree contains a call to the named function.
 */
function astContainsCall(node, fnName) {
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'CallExpression') {
    const c = node.callee;
    if (c.type === 'Identifier' && c.name === fnName) return true;
    if (c.type === 'MemberExpression' && c.property && c.property.type === 'Identifier' && c.property.name === fnName) return true;
  }
  for (const key of Object.keys(node)) {
    if (key === 'parent') continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item.type === 'string' && astContainsCall(item, fnName)) return true;
      }
    } else if (child && typeof child.type === 'string') {
      if (astContainsCall(child, fnName)) return true;
    }
  }
  return false;
}

/**
 * Find all CallExpression nodes for the named function in an AST subtree.
 */
function findCallNodes(node, fnName) {
  const results = [];
  if (!node || typeof node !== 'object') return results;
  if (node.type === 'CallExpression') {
    const c = node.callee;
    if (c.type === 'Identifier' && c.name === fnName) results.push(node);
    if (c.type === 'MemberExpression' && c.property && c.property.type === 'Identifier' && c.property.name === fnName) results.push(node);
  }
  for (const key of Object.keys(node)) {
    if (key === 'parent') continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item.type === 'string') results.push(...findCallNodes(item, fnName));
      }
    } else if (child && typeof child.type === 'string') {
      results.push(...findCallNodes(child, fnName));
    }
  }
  return results;
}

module.exports = plugin;
