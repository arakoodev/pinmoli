import { describe, it, expect, beforeEach } from 'vitest';
import { createTools } from '../../src/skills/index.js';

describe('Skills - Tool Registration', () => {
  let tools: ReturnType<typeof createTools>;

  beforeEach(() => {
    tools = createTools();
  });

  it('registers exactly 5 tools', () => {
    expect(tools).toHaveLength(5);
  });

  it('has correct tool names', () => {
    const names = tools.map(t => t.name);
    expect(names).toEqual(['sip_test', 'analyze_failure', 'save_test', 'load_test', 'list_tests']);
  });

  it('all tools have required properties', () => {
    tools.forEach(tool => {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.parameters).toBeDefined();
      expect(typeof tool.execute).toBe('function');
    });
  });
});

describe('Skills - sip_test', () => {
  const tools = createTools();
  const sipTest = tools[0];

  it('has endpoint and method in parameters', () => {
    const props = sipTest.parameters.properties;
    expect(props).toHaveProperty('endpoint');
    expect(props).toHaveProperty('method');
    expect(props).toHaveProperty('timeout');
  });

  it('rejects invalid SIP URI', async () => {
    const result = await sipTest.execute('test-id', {
      endpoint: 'not-a-sip-uri',
      method: 'OPTIONS'
    });
    
    const events = result.details?.events as any[];
    expect(events).toBeDefined();
    expect(events.some(e => e.type === 'error')).toBe(true);
  });

  it('rejects invalid method', async () => {
    const result = await sipTest.execute('test-id', {
      endpoint: 'sip:test.example.com',
      method: 'INVALID'
    });
    
    const events = result.details?.events as any[];
    expect(events).toBeDefined();
    expect(events.some(e => e.type === 'error')).toBe(true);
  });

  it('uses default timeout when not provided', async () => {
    const result = await sipTest.execute('test-id', {
      endpoint: 'sip:test.example.com',
      method: 'OPTIONS'
    });
    
    expect(result.details).toBeDefined();
  });
});

describe('Skills - analyze_failure', () => {
  const tools = createTools();
  const analyzeTool = tools[1];

  it('has testId parameter', () => {
    const props = analyzeTool.parameters.properties;
    expect(props).toHaveProperty('testId');
  });
});

describe('Skills - save_test', () => {
  const tools = createTools();
  const saveTool = tools[2];

  it('has name, endpoint, method parameters', () => {
    const props = saveTool.parameters.properties;
    expect(props).toHaveProperty('name');
    expect(props).toHaveProperty('endpoint');
    expect(props).toHaveProperty('method');
    expect(props).toHaveProperty('timeout');
  });
});

describe('Skills - load_test', () => {
  const tools = createTools();
  const loadTool = tools[3];

  it('has name parameter', () => {
    const props = loadTool.parameters.properties;
    expect(props).toHaveProperty('name');
  });
});

describe('Skills - list_tests', () => {
  const tools = createTools();
  const listTool = tools[4];

  it('has empty parameters object', () => {
    expect(listTool.parameters.properties).toBeDefined();
  });

  it('can be executed without parameters', async () => {
    const result = await listTool.execute('test-id', {});
    expect(result).toBeDefined();
    expect(result.details).toHaveProperty('tests');
  });
});
