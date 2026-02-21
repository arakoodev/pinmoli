import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import sipPlugin from "./eslint-plugin-sip.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),

  // SIP/SDP correctness rules — applied to all SIP test scripts and test files.
  {
    files: ["test-*.mjs", "src/**/*.test.ts", "src/lib/sip-engine.mjs"],
    plugins: { sip: sipPlugin },
    rules: {
      "sip/no-sip-dialog": "error",
      "sip/no-unroutable-sdp-ip": "error",
      "sip/no-literal-crlf-escape": "error",
      "sip/require-public-address": "error",
      "sip/no-local-ip-in-sip-uri": "error",
      "sip/require-allow-in-invite": "warn",
      "sip/no-spread-in-sip-headers": "error",
      "sip/no-sdp-lf-join": "error",
      "sip/no-random-sip-port": "error",
    },
  },
]);

export default eslintConfig;
