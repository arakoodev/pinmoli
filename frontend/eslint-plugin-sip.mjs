/**
 * eslint-plugin-sip — Custom ESLint rules for SIP/SDP test correctness.
 *
 * These rules guard against bugs that silently break SIP call flows and
 * produce misleading 503 diagnostics.  All three were extracted from
 * real production bugs discovered in this codebase.
 */

const plugin = {
  meta: { name: 'eslint-plugin-sip', version: '2.0.0' },
  rules: {
    /* ------------------------------------------------------------------ */
    /* Rule 1 — sip/no-sip-dialog                                        */
    /*                                                                    */
    /* sip.dialog() does not exist in the `sip` npm package (v0.0.6).     */
    /* Calling it throws a TypeError at runtime, which means ACK is never */
    /* sent after 200 OK and BYE crashes — the call never completes.      */
    /* ------------------------------------------------------------------ */
    'no-sip-dialog': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Disallow sip.dialog() which does not exist in sip v0.0.6.',
        },
        schema: [],
        messages: {
          forbidden:
            'sip.dialog() does not exist in sip v0.0.6. ' +
            'Manually construct ACK and BYE messages using the To (with remote tag), From, Call-ID, and CSeq headers from the INVITE transaction.',
        },
      },
      create(context) {
        return {
          CallExpression(node) {
            const c = node.callee;
            if (
              c.type === 'MemberExpression' &&
              c.object.type === 'Identifier' &&
              c.object.name === 'sip' &&
              c.property.type === 'Identifier' &&
              c.property.name === 'dialog'
            ) {
              context.report({ node, messageId: 'forbidden' });
            }
          },
        };
      },
    },

    /* ------------------------------------------------------------------ */
    /* Rule 2 — sip/no-unroutable-sdp-ip                                  */
    /*                                                                    */
    /* 0.0.0.0 and 1.1.1.1 in SDP o=/c= lines or SIP From/Contact/       */
    /* Call-ID headers make RTP media unroutable.  LiveKit's Pion ICE     */
    /* stack silently drops the session.                                   */
    /* ------------------------------------------------------------------ */
    'no-unroutable-sdp-ip': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Disallow unroutable placeholder IPs (0.0.0.0, 1.1.1.1) in SIP/SDP test files.',
        },
        schema: [],
        messages: {
          unroutable:
            'Unroutable IP "{{ip}}" found. ' +
            'Use os.networkInterfaces() to detect a real local IP for SDP o=/c= lines and SIP headers.',
        },
      },
      create(context) {
        const BAD_IPS = ['0.0.0.0', '1.1.1.1'];

        function checkValue(value, node) {
          if (typeof value !== 'string') return;
          for (const ip of BAD_IPS) {
            if (value.includes(ip)) {
              context.report({ node, messageId: 'unroutable', data: { ip } });
              return; // one report per node
            }
          }
        }

        return {
          Literal(node) {
            checkValue(node.value, node);
          },
          TemplateLiteral(node) {
            for (const quasi of node.quasis) {
              checkValue(quasi.value.cooked, node);
            }
          },
        };
      },
    },

    /* ------------------------------------------------------------------ */
    /* Rule 3 — sip/require-public-address                               */
    /*                                                                    */
    /* sip.start({ port }) without a `publicAddress` option causes the    */
    /* sip library to fall back to os.hostname(), which inside Docker     */
    /* returns the container ID (e.g. "6a2d87fd27fc").  The Via header    */
    /* then contains an unresolvable hostname.  While responses still     */
    /* arrive on the same TCP socket, LiveKit's trunk matching may fail   */
    /* because the source address is garbage — producing 0 sessions and   */
    /* an eventual 503 after 60s.                                         */
    /* ------------------------------------------------------------------ */
    'require-public-address': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Require publicAddress option in sip.start() to prevent Docker container ID in Via header.',
        },
        schema: [],
        messages: {
          missing:
            'sip.start() called without publicAddress option. ' +
            'Without it, the Via header defaults to os.hostname() which in Docker is the container ID. ' +
            'Pass { publicAddress: publicIp } to sip.start().',
        },
      },
      create(context) {
        return {
          CallExpression(node) {
            const c = node.callee;
            if (
              c.type !== 'MemberExpression' ||
              c.object.type !== 'Identifier' ||
              c.object.name !== 'sip' ||
              c.property.type !== 'Identifier' ||
              c.property.name !== 'start'
            ) {
              return;
            }

            const firstArg = node.arguments[0];
            if (!firstArg || firstArg.type !== 'ObjectExpression') {
              // sip.start() with no args or non-object — still bad
              context.report({ node, messageId: 'missing' });
              return;
            }

            const hasPublicAddress = firstArg.properties.some(
              (p) =>
                p.type === 'Property' &&
                ((p.key.type === 'Identifier' && p.key.name === 'publicAddress') ||
                 (p.key.type === 'Literal' && p.key.value === 'publicAddress'))
            );

            if (!hasPublicAddress) {
              context.report({ node, messageId: 'missing' });
            }
          },
        };
      },
    },

    /* ------------------------------------------------------------------ */
    /* Rule 4 — sip/no-local-ip-in-sip-uri                               */
    /*                                                                    */
    /* Template literals building `sip:` URIs (Contact, From headers)     */
    /* must use publicIp, not localIp.  Inside Docker, localIp resolves   */
    /* to a private bridge IP (e.g. 172.20.0.3) which is unreachable      */
    /* from LiveKit's SIP service.  LiveKit may use Contact/From to       */
    /* validate the registrant or route in-dialog requests, causing       */
    /* silent session creation failure.                                    */
    /* ------------------------------------------------------------------ */
    'no-local-ip-in-sip-uri': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Disallow localIp in SIP URI template literals — use publicIp for Contact/From headers.',
        },
        schema: [],
        messages: {
          localIpInUri:
            'localIp used in a SIP URI template. ' +
            'In Docker, localIp is a private bridge IP (e.g. 172.20.0.3) unreachable from LiveKit. ' +
            'Use publicIp instead for Contact and From headers.',
        },
      },
      create(context) {
        return {
          TemplateLiteral(node) {
            // Only flag templates that build sip: URIs
            const hasSipPrefix = node.quasis.some(
              (q) => q.value.cooked && q.value.cooked.includes('sip:')
            );
            if (!hasSipPrefix) return;

            for (const expr of node.expressions) {
              if (expr.type === 'Identifier' && expr.name === 'localIp') {
                context.report({ node: expr, messageId: 'localIpInUri' });
              }
            }
          },
        };
      },
    },

    /* ------------------------------------------------------------------ */
    /* Rule 5 — sip/require-allow-in-invite                               */
    /*                                                                    */
    /* RFC 3261 Section 20.5: the Allow header SHOULD be present in       */
    /* INVITE requests.  Some SIP proxies (including LiveKit's) may use   */
    /* it to determine supported methods for the dialog.  Missing it      */
    /* can contribute to session creation failures.                        */
    /* ------------------------------------------------------------------ */
    'require-allow-in-invite': {
      meta: {
        type: 'suggestion',
        docs: {
          description:
            'Require Allow header in SIP INVITE request objects (RFC 3261 Section 20.5).',
        },
        schema: [],
        messages: {
          missingAllow:
            'INVITE request missing Allow header. ' +
            "Add `allow: 'INVITE, ACK, BYE, CANCEL, OPTIONS'` to the headers object (RFC 3261 SHOULD).",
        },
      },
      create(context) {
        return {
          ObjectExpression(node) {
            // Look for { method: 'INVITE', headers: { ... } }
            const methodProp = node.properties.find(
              (p) =>
                p.type === 'Property' &&
                p.key.type === 'Identifier' &&
                p.key.name === 'method' &&
                p.value.type === 'Literal' &&
                p.value.value === 'INVITE'
            );
            if (!methodProp) return;

            const headersProp = node.properties.find(
              (p) =>
                p.type === 'Property' &&
                p.key.type === 'Identifier' &&
                p.key.name === 'headers' &&
                p.value.type === 'ObjectExpression'
            );
            if (!headersProp) return;

            const headersObj = headersProp.value;
            const hasAllow = headersObj.properties.some(
              (p) =>
                p.type === 'Property' &&
                ((p.key.type === 'Identifier' && p.key.name === 'allow') ||
                 (p.key.type === 'Literal' && p.key.value === 'allow'))
            );

            if (!hasAllow) {
              context.report({ node: headersProp, messageId: 'missingAllow' });
            }
          },
        };
      },
    },

    /* ------------------------------------------------------------------ */
    /* Rule 6 — sip/no-literal-crlf-escape                               */
    /*                                                                    */
    /* Writing '\\r\\n' produces a 4-char literal string (\r\n) instead   */
    /* of actual CRLF (2 chars).  SDP bodies joined with the wrong        */
    /* line ending are silently malformed; LiveKit/Opal/Odin parsers      */
    /* reject them or fall back to default media params.                   */
    /* ------------------------------------------------------------------ */
    'no-literal-crlf-escape': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Disallow literal backslash-r-backslash-n in strings (should be actual CRLF).',
        },
        schema: [],
        messages: {
          literalEscape:
            'String contains literal "\\r\\n" (4 chars) instead of actual CRLF (2 chars). ' +
            "Use '\\r\\n' (single-escaped) not '\\\\r\\\\n' (double-escaped).",
        },
      },
      create(context) {
        return {
          Literal(node) {
            if (
              typeof node.value === 'string' &&
              node.value.includes('\\r\\n')
            ) {
              context.report({ node, messageId: 'literalEscape' });
            }
          },
        };
      },
    },

    /* ------------------------------------------------------------------ */
    /* Rule 7 — sip/no-spread-in-sip-headers                              */
    /*                                                                    */
    /* Spread elements (...customHeaders) in SIP header objects can        */
    /* silently overwrite transaction-critical headers like `to`, `from`,  */
    /* `call-id`, `cseq`, `contact`, and `via`.  A user adding a custom   */
    /* header named "to" destroys the To header the code just built.      */
    /* Use Object.assign with explicit exclusions, or add custom headers  */
    /* before the critical ones (spread first, then explicit fields).     */
    /* ------------------------------------------------------------------ */
    'no-spread-in-sip-headers': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Disallow spread elements in SIP header objects that could overwrite critical transaction headers.',
        },
        schema: [],
        messages: {
          spreadOverwrite:
            'Spread element in SIP headers object may silently overwrite critical headers ' +
            '(to, from, call-id, cseq, contact, via). ' +
            'Move the spread BEFORE the critical fields, or filter out reserved keys before spreading.',
        },
      },
      create(context) {
        const SIP_CRITICAL_KEYS = new Set([
          'to', 'from', 'call-id', 'cseq', 'contact', 'via',
          'max-forwards', 'content-type',
        ]);

        return {
          ObjectExpression(node) {
            // Check if this object contains SIP-critical header keys
            const hasSipKeys = node.properties.some(
              (p) =>
                p.type === 'Property' &&
                ((p.key.type === 'Identifier' && SIP_CRITICAL_KEYS.has(p.key.name)) ||
                 (p.key.type === 'Literal' && SIP_CRITICAL_KEYS.has(p.key.value)))
            );
            if (!hasSipKeys) return;

            // Find spread elements that come AFTER critical keys
            let seenCriticalKey = false;
            for (const prop of node.properties) {
              if (
                prop.type === 'Property' &&
                ((prop.key.type === 'Identifier' && SIP_CRITICAL_KEYS.has(prop.key.name)) ||
                 (prop.key.type === 'Literal' && SIP_CRITICAL_KEYS.has(prop.key.value)))
              ) {
                seenCriticalKey = true;
              }

              if (prop.type === 'SpreadElement' && seenCriticalKey) {
                context.report({ node: prop, messageId: 'spreadOverwrite' });
              }
            }
          },
        };
      },
    },

    /* ------------------------------------------------------------------ */
    /* Rule 8 — sip/no-sdp-lf-join                                        */
    /*                                                                    */
    /* SDP bodies must use CRLF (\r\n) line endings per RFC 4566.         */
    /* Using .join('\n') on an SDP line array produces LF-only, which     */
    /* causes parsers to reject or misparse the SDP.  This is a different */
    /* bug vector than Rule 6 (escaped CRLF): this catches arrays of SDP */
    /* lines joined with the wrong separator.  Also catches template      */
    /* expressions that concatenate SDP with plain \n.                    */
    /* ------------------------------------------------------------------ */
    'no-sdp-lf-join': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Disallow .join("\\n") on SDP line arrays — must use .join("\\r\\n") for RFC 4566 compliance.',
        },
        schema: [],
        messages: {
          lfJoin:
            'SDP array joined with "\\n" (LF) instead of "\\r\\n" (CRLF). ' +
            'SDP requires CRLF line endings per RFC 4566. Use .join(\'\\r\\n\') + \'\\r\\n\'.',
        },
      },
      create(context) {
        // Detect patterns like: ['v=0', 'o=...', ...].join('\n')
        const SDP_PREFIXES = ['v=', 'o=', 's=', 'c=', 't=', 'm=', 'a='];

        function isLikelySdpArray(node) {
          if (node.type !== 'ArrayExpression') return false;
          return node.elements.some(
            (el) =>
              el &&
              el.type === 'Literal' &&
              typeof el.value === 'string' &&
              SDP_PREFIXES.some((p) => el.value.startsWith(p))
          );
        }

        return {
          CallExpression(node) {
            const c = node.callee;
            if (
              c.type !== 'MemberExpression' ||
              c.property.type !== 'Identifier' ||
              c.property.name !== 'join'
            ) {
              return;
            }

            // Check if the argument is '\n' (LF-only, not CRLF)
            const arg = node.arguments[0];
            if (
              !arg ||
              arg.type !== 'Literal' ||
              typeof arg.value !== 'string'
            ) {
              return;
            }

            // '\n' is LF-only; '\r\n' is correct
            if (arg.value === '\n') {
              // Check if the object being joined looks like SDP lines
              if (isLikelySdpArray(c.object)) {
                context.report({ node, messageId: 'lfJoin' });
              }
            }
          },
        };
      },
    },

    /* ------------------------------------------------------------------ */
    /* Rule 9 — sip/no-random-sip-port                                    */
    /*                                                                    */
    /* Using Math.random() to pick a SIP port produces ports that don't   */
    /* match Docker port exposure (typically 5060).  The Contact header   */
    /* advertises the random port, but the remote platform can't reach    */
    /* us on it for in-dialog requests (BYE, re-INVITE).  Always use a   */
    /* fixed port that matches Docker/firewall configuration.             */
    /* ------------------------------------------------------------------ */
    'no-random-sip-port': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Disallow Math.random() in SIP port assignments — use a fixed port matching Docker exposure.',
        },
        schema: [],
        messages: {
          randomPort:
            'Math.random() used to calculate a SIP port. ' +
            'Random ports do not match Docker port exposure. ' +
            'The Contact header will advertise an unreachable port. ' +
            'Use a fixed port (e.g. 5060) that matches your Docker/firewall configuration.',
        },
      },
      create(context) {
        return {
          VariableDeclarator(node) {
            // Check if the variable name contains "port" (case-insensitive)
            if (
              !node.id ||
              node.id.type !== 'Identifier' ||
              !node.id.name.toLowerCase().includes('port')
            ) {
              return;
            }

            // Check if the init expression contains Math.random()
            if (node.init && containsMathRandom(node.init)) {
              context.report({ node, messageId: 'randomPort' });
            }
          },
        };

        function containsMathRandom(node) {
          if (!node) return false;
          if (
            node.type === 'CallExpression' &&
            node.callee.type === 'MemberExpression' &&
            node.callee.object.type === 'Identifier' &&
            node.callee.object.name === 'Math' &&
            node.callee.property.type === 'Identifier' &&
            node.callee.property.name === 'random'
          ) {
            return true;
          }
          // Recurse into child expressions (BinaryExpression, CallExpression args, etc.)
          for (const key of Object.keys(node)) {
            if (key === 'type' || key === 'loc' || key === 'range' || key === 'parent') continue;
            const child = node[key];
            if (child && typeof child === 'object') {
              if (Array.isArray(child)) {
                for (const item of child) {
                  if (item && typeof item.type === 'string' && containsMathRandom(item)) return true;
                }
              } else if (child.type && containsMathRandom(child)) {
                return true;
              }
            }
          }
          return false;
        }
      },
    },
  },
};

export default plugin;
