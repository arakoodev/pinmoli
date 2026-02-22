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
      description: 'Execute a SIP test against an endpoint',
      parameters: Type.Object({
        endpoint: Type.String({ description: 'SIP URI (e.g., sip:example.com)' }),
        method: Type.Union([Type.Literal('OPTIONS'), Type.Literal('INVITE'), Type.Literal('REGISTER')]),
        timeout: Type.Optional(Type.Number({ description: 'Timeout in milliseconds', default: 5000 }))
      }),
      execute: async (_toolCallId, params: any): Promise<AgentToolResult<unknown>> => {
        // Convert simple API to full config with smart defaults
        const config = {
          uri: params.endpoint,
          method: params.method,
          codecs: ['opus', 'PCMU', 'PCMA'] as const,
          transport: 'auto' as const,
          timeout: params.timeout || 5000
        };
        
        const events = [];
        try {
          for await (const event of sipTestHandler(config as never)) {
            events.push(event);
          }
        } catch (error) {
          events.push({
            type: 'error',
            timestamp: Date.now(),
            message: error instanceof Error ? error.message : String(error),
            severity: 'fatal'
          });
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
        testId: Type.String({ description: 'UUID of the failed test' })
      }),
      execute: async (_toolCallId, params: any): Promise<AgentToolResult<unknown>> => {
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
      description: 'Save a test configuration for later reuse',
      parameters: Type.Object({
        name: Type.String({ description: 'Unique test name (alphanumeric, hyphens, underscores)' }),
        endpoint: Type.String({ description: 'SIP URI' }),
        method: Type.Union([Type.Literal('OPTIONS'), Type.Literal('INVITE'), Type.Literal('REGISTER')]),
        timeout: Type.Optional(Type.Number({ description: 'Timeout in milliseconds' }))
      }),
      execute: async (_toolCallId, params: any): Promise<AgentToolResult<unknown>> => {
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
      description: 'Load and execute a saved test configuration',
      parameters: Type.Object({
        name: Type.String({ description: 'Name of the saved test' })
      }),
      execute: async (_toolCallId, params: any): Promise<AgentToolResult<unknown>> => {
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


