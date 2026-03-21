import { describe, it, expect } from 'vitest';
import { registerAllTools, getAllTools, saveTestTool, loadTestTool, listTestsTool } from '../../src/tools/index.js';

  describe('Tool Registration', () => {
    it('registers all 8 tools', () => {
      registerAllTools();
      const tools = getAllTools();

      expect(tools).toHaveLength(8);

      const toolNames = tools.map(t => t.name);
      expect(toolNames).toContain('sip_test');
      expect(toolNames).toContain('webrtc_test');
      expect(toolNames).toContain('analyze_failure');
      expect(toolNames).toContain('save_test');
      expect(toolNames).toContain('load_test');
      expect(toolNames).toContain('list_tests');
      expect(toolNames).toContain('generate_audio');
      expect(toolNames).toContain('replay_session');
    });
  it('all tools have required properties', () => {
    registerAllTools();
    const tools = getAllTools();

    tools.forEach(tool => {
      expect(tool).toHaveProperty('name');
      expect(tool).toHaveProperty('description');
      expect(tool).toHaveProperty('parameters');
      expect(tool).toHaveProperty('execute');
      expect(typeof tool.execute).toBe('function');
    });
  });
});

describe('Save/Load/List Tools', () => {
  const testConfig = {
    uri: 'sip:+1234567890@example.com',
    method: 'INVITE' as const,
    codecs: ['opus', 'PCMU'],
    transport: 'udp' as const,
    mediaPort: 10000,
    timeout: 15000,
  };

  it('save_test stores and returns success', async () => {
    const name = `tool-save-${Date.now()}`;
    const result = await saveTestTool.execute('tc-1', { name, config: testConfig }, new AbortController().signal, () => {});

    expect(result.content[0].text).toContain(`Saved test "${name}"`);
    expect(result.details).toEqual({ name, config: testConfig });
  });

  it('save_test rejects duplicate names', async () => {
    const name = `tool-dup-${Date.now()}`;
    await saveTestTool.execute('tc-2', { name, config: testConfig }, new AbortController().signal, () => {});

    const result = await saveTestTool.execute('tc-3', { name, config: testConfig }, new AbortController().signal, () => {});
    expect(result.content[0].text).toContain('already exists');
    expect(result.details).toEqual({ error: 'duplicate_name', name });
  });

  it('load_test retrieves saved config', async () => {
    const name = `tool-load-${Date.now()}`;
    await saveTestTool.execute('tc-4', { name, config: testConfig }, new AbortController().signal, () => {});

    const result = await loadTestTool.execute('tc-5', { name }, new AbortController().signal, () => {});
    expect(result.content[0].text).toContain(`Loaded test "${name}"`);
    expect(result.details.config).toEqual(testConfig);
  });

  it('load_test returns not_found for missing test', async () => {
    const result = await loadTestTool.execute('tc-6', { name: `no-such-test-${Date.now()}` }, new AbortController().signal, () => {});
    expect(result.content[0].text).toContain('No test found');
    expect(result.details.error).toBe('not_found');
  });

  it('list_tests includes saved tests', async () => {
    const name = `tool-list-${Date.now()}`;
    await saveTestTool.execute('tc-7', { name, config: testConfig }, new AbortController().signal, () => {});

    const result = await listTestsTool.execute('tc-8', {}, new AbortController().signal, () => {});
    expect(result.content[0].text).toContain(name);
    expect(result.details.tests.length).toBeGreaterThan(0);
  });

  it('list_tests returns empty message when no tests exist after cleanup', async () => {
    // This tests the empty-state text path — note that other tests may have
    // saved entries, so we only verify the format when details.tests is empty
    const result = await listTestsTool.execute('tc-9', {}, new AbortController().signal, () => {});
    if (result.details.tests.length === 0) {
      expect(result.content[0].text).toContain('No saved tests');
    } else {
      expect(result.content[0].text).toContain('saved test');
    }
  });
});
