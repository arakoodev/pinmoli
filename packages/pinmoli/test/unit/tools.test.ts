import { describe, it, expect } from 'vitest';
import { registerAllTools, getAllTools } from '../../src/tools/index.js';

  describe('Tool Registration', () => {
    it('registers all 6 SIP tools', () => {
      registerAllTools();
      const tools = getAllTools();
      
      expect(tools).toHaveLength(6);
      
      const toolNames = tools.map(t => t.name);
      expect(toolNames).toContain('sip_test');
      expect(toolNames).toContain('analyze_failure');
      expect(toolNames).toContain('save_test');
      expect(toolNames).toContain('load_test');
      expect(toolNames).toContain('list_tests');
      expect(toolNames).toContain('generate_audio');
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
