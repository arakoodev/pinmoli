import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { Type } from '@sinclair/typebox';
import { sipTestHandler } from './sip-test.js';
import { analyzeFailureHandler } from './analyzer.js';
import { saveTestHandler, loadTestHandler, listTestsHandler } from './storage.js';

/**
 * Create all hardcoded tools.
 * Only these 5 tools - no dynamic registration allowed.
 */
export function createTools(): AgentTool[] {
  return [
    // Tool 1: Run SIP test
    {
      name: 'sip_test',
      label: 'SIP Test',
      description: 'Execute a SIP test with the given configuration',
      parameters: Type.Object({
        uri: Type.String({ description: 'SIP URI to test (sip: or sips:)' }),
        method: Type.Union([Type.Literal('OPTIONS'), Type.Literal('INVITE'), Type.Literal('REGISTER')]),
        codecs: Type.Array(Type.String()),
        transport: Type.Union([Type.Literal('udp'), Type.Literal('tcp'), Type.Literal('tls'), Type.Literal('auto')])
      }),
      execute: async (_toolCallId, params): Promise<AgentToolResult<unknown>> => {
        const events = [];
        for await (const event of sipTestHandler(params as never)) {
          events.push(event);
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(events, null, 2) }],
          details: { events }
        };
      }
    },

    // Tool 2: Analyze failure
    {
      name: 'analyze_failure',
      label: 'Analyze Failure',
      description: 'Analyze SIP test failure and provide recovery suggestions',
      parameters: Type.Object({
        events: Type.Array(Type.Any())
      }),
      execute: async (_toolCallId, params): Promise<AgentToolResult<unknown>> => {
        const analysis = await analyzeFailureHandler(params as never);
        return {
          content: [{ type: 'text', text: analysis }],
          details: { analysis }
        };
      }
    },

    // Tool 3: Save test
    {
      name: 'save_test',
      label: 'Save Test',
      description: 'Save a test configuration to collections',
      parameters: Type.Object({
        name: Type.String(),
        config: Type.Any()
      }),
      execute: async (_toolCallId, params): Promise<AgentToolResult<unknown>> => {
        const result = await saveTestHandler(params as never);
        return {
          content: [{ type: 'text', text: result }],
          details: { result }
        };
      }
    },

    // Tool 4: Load test
    {
      name: 'load_test',
      label: 'Load Test',
      description: 'Load a saved test configuration by name',
      parameters: Type.Object({
        name: Type.String()
      }),
      execute: async (_toolCallId, params): Promise<AgentToolResult<unknown>> => {
        const config = await loadTestHandler(params as never);
        return {
          content: [{ type: 'text', text: JSON.stringify(config, null, 2) }],
          details: { config }
        };
      }
    },

    // Tool 5: List tests
    {
      name: 'list_tests',
      label: 'List Tests',
      description: 'List all saved test configurations',
      parameters: Type.Object({}),
      execute: async (): Promise<AgentToolResult<unknown>> => {
        const tests = await listTestsHandler();
        return {
          content: [{ type: 'text', text: tests.join('\n') }],
          details: { tests }
        };
      }
    }
  ];
}


