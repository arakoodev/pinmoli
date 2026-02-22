import { Agent } from '@mariozechner/pi-agent-core';
import { getModel } from '@mariozechner/pi-ai';
import { SYSTEM_PROMPT } from '../system-prompt.js';
import { createTools } from '../skills/index.js';

export function createPinmoliAgent(): Agent {
  return new Agent({
    initialState: {
      systemPrompt: SYSTEM_PROMPT,
      model: getModel('anthropic', 'claude-3-5-sonnet-20241022'),
      tools: createTools(),
      messages: []
    }
  });
}

