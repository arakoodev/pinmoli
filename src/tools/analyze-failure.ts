/**
 * Analyze Failure Tool
 * Analyzes SIP test failures and provides recovery suggestions
 */

import type { AgentTool } from '@mariozechner/pi-agent-core';
import { Type } from '@sinclair/typebox';

export const analyzeFailureTool: AgentTool = {
  name: 'analyze_failure',
  label: 'Analyze Failure',
  description: 'Analyze SIP or WebRTC test failure and provide recovery suggestions',
  parameters: Type.Object({
    events: Type.Array(Type.Object({
      type: Type.String(),
      timestamp: Type.Number(),
      message: Type.String(),
      status: Type.Optional(Type.Number()),
      severity: Type.Optional(Type.String()),
      code: Type.Optional(Type.String())
    }))
  }),
  
  async execute(toolCallId, params, _signal, _onUpdate) {
    const { events } = params as { events: Array<{ type: string; message: string; status?: number; severity?: string; code?: string }> };
    
    // Find error events
    const errors = events.filter(e => e.type === 'error' || e.severity === 'error' || e.severity === 'fatal');
    
    if (errors.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No errors found in the test events.'
        }],
        details: {}
      };
    }
    
    // Analyze the first error
    const error = errors[0];
    let analysis = `Error: ${error.message}\n\n`;
    
    // Provide recovery suggestions based on error type
    if (error.status === 401) {
      analysis += 'Recovery: Add authentication credentials (username/password) to the test configuration.';
    } else if (error.status === 404) {
      analysis += 'Recovery: Check that the SIP URI is correct and the endpoint exists.';
    } else if (error.status === 488) {
      analysis += 'Recovery: The server rejected the codec offer. Try different codecs (opus, PCMU, PCMA, G722).';
    } else if (error.code === 'SIP_TIMEOUT') {
      analysis += 'Recovery: Check network connectivity and increase timeout value.';
    } else if (error.code === 'DNS_ERROR') {
      analysis += 'Recovery: Verify the domain name is correct and DNS is working.';
    } else if (error.code === 'WHIP_HTTP_ERROR') {
      analysis += 'Recovery: Check WHIP endpoint URL and authentication token. Ensure the endpoint supports WHIP (RFC 9725).';
    } else if (error.code === 'ICE_FAILED') {
      analysis += 'Recovery: ICE connectivity failed. Check firewall/NAT settings. Try adding a TURN server to iceServers.';
    } else if (error.code === 'DTLS_FAILED') {
      analysis += 'Recovery: DTLS handshake failed. The remote may not support the offered fingerprint or cipher suite.';
    } else {
      analysis += 'Recovery: Review the error message and check server logs for more details.';
    }
    
    return {
      content: [{
        type: 'text',
        text: analysis
      }],
      details: { errors, analysis }
    };
  }
};
