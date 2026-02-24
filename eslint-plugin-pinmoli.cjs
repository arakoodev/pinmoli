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
    /* Rule 6 — pinmoli/no-random-sip-port                                */
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
    /* Rule 7 — pinmoli/no-unrefed-timer-in-sip                          */
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
    /* Rule 8 — pinmoli/require-to-tag-in-dialog                          */
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
  },
};

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

module.exports = plugin;
