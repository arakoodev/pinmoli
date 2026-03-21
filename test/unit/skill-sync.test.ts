/**
 * Skill-Code Sync Tests
 *
 * These tests prevent skill documentation from drifting out of sync with
 * the actual codebase. Every assertion here was born from a real mistake:
 *
 * 1. User-facing skill said "5 tools" when there were 7
 * 2. Skill referenced wrong file paths (packages/pinmoli/, src/skills/)
 * 3. Skill referenced non-existent functions (executeSipTest vs runSipTest)
 * 4. Skill claimed Zod schemas when codebase uses TypeBox
 * 5. New source directories (src/network/) added but not in skill docs
 * 6. Memory files created inside git repo instead of ~/.claude/
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { ALLOWED_TOOLS } from '../../src/tools/registry.js';

const ROOT = resolve(new URL('.', import.meta.url).pathname, '../..');
const DEV_SKILL_PATH = resolve(ROOT, '.claude/skills/pinmoli-dev/SKILL.md');

describe('Skill-Code Sync', () => {
  const devSkill = readFileSync(DEV_SKILL_PATH, 'utf-8');

  // ----- Tool registry -----

  describe('Tool registry matches skill documentation', () => {
    it('ALLOWED_TOOLS has exactly 12 entries', () => {
      expect(ALLOWED_TOOLS).toHaveLength(12);
    });

    it('dev skill claims 12 tools', () => {
      // Matches "12 tools", "12-tool", "Exactly 12 tools", etc.
      expect(devSkill).toMatch(/\b12[\s-]+tool/i);
    });

    it('all registered tool names appear in dev skill', () => {
      for (const toolName of ALLOWED_TOOLS) {
        expect(
          devSkill.includes(toolName),
          `Tool "${toolName}" missing from dev skill — add it to .claude/skills/pinmoli-dev/SKILL.md`
        ).toBe(true);
      }
    });
  });

  // ----- Source directory coverage -----

  describe('Dev skill file structure covers all src/ directories', () => {
    const srcDirs = readdirSync(resolve(ROOT, 'src'), { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    it.each(srcDirs)('src/%s/ is documented in dev skill', (dir) => {
      expect(
        devSkill.includes(dir + '/') || devSkill.includes(dir + '.'),
        `Directory src/${dir}/ is missing from dev skill file structure — update .claude/skills/pinmoli-dev/SKILL.md`
      ).toBe(true);
    });
  });

  // ----- Source file references -----

  describe('Source files referenced in dev skill exist on disk', () => {
    // Extract all src/foo/bar.ts paths from the skill markdown
    const fileRefs = [...new Set(devSkill.match(/src\/[\w/.-]+\.ts/g) || [])];

    it('found source file references in skill', () => {
      expect(fileRefs.length).toBeGreaterThan(0);
    });

    it.each(fileRefs)('%s exists', (ref) => {
      expect(
        existsSync(resolve(ROOT, ref)),
        `${ref} referenced in dev skill but does not exist on disk`
      ).toBe(true);
    });
  });

  // ----- Schema library -----

  describe('Schema library consistency', () => {
    it('dev skill references TypeBox, not Zod', () => {
      expect(devSkill).toContain('TypeBox');
      // "Zod schema" or "Zod validation" would indicate stale docs
      expect(devSkill).not.toMatch(/Zod\s+schema/i);
    });

    it('validation/schemas.ts imports TypeBox, not Zod', () => {
      const schemas = readFileSync(resolve(ROOT, 'src/validation/schemas.ts'), 'utf-8');
      expect(schemas).toContain('@sinclair/typebox');
      expect(schemas).not.toContain("from 'zod'");
      expect(schemas).not.toContain('from "zod"');
    });
  });

  // ----- Key exports exist -----

  describe('Key functions referenced in skill exist in source', () => {
    it('runSipTest is exported from src/sip/engine.ts', () => {
      const source = readFileSync(resolve(ROOT, 'src/sip/engine.ts'), 'utf-8');
      expect(source).toContain('export async function* runSipTest');
    });

    it('runWebRtcTest is exported from src/webrtc/engine.ts', () => {
      const source = readFileSync(resolve(ROOT, 'src/webrtc/engine.ts'), 'utf-8');
      expect(source).toContain('export async function* runWebRtcTest');
    });

    it('stunDiscoverAddress is exported from src/network/utils.ts', () => {
      const source = readFileSync(resolve(ROOT, 'src/network/utils.ts'), 'utf-8');
      expect(source).toContain('export async function stunDiscoverAddress');
    });

    it('registerAllTools is exported from src/tools/index.ts', () => {
      const source = readFileSync(resolve(ROOT, 'src/tools/index.ts'), 'utf-8');
      expect(source).toContain('export function registerAllTools');
    });
  });

  // ----- Stale reference detection -----

  describe('No stale references from previous codebase versions', () => {
    it('does not reference old packages/pinmoli/ path', () => {
      expect(devSkill).not.toContain('packages/pinmoli');
    });

    it('does not reference old src/skills/ directory', () => {
      expect(devSkill).not.toMatch(/src\/skills\//);
    });

    it('does not reference old executeSipTest function', () => {
      expect(devSkill).not.toContain('executeSipTest');
    });

    it('does not reference old src/sip/transport.ts file', () => {
      expect(devSkill).not.toContain('src/sip/transport.ts');
    });
  });
});

// ----- Git safety -----

describe('Git safety — prevent memory files in repo', () => {
  it('.gitignore blocks .claude/projects/', () => {
    const gitignore = readFileSync(resolve(ROOT, '.gitignore'), 'utf-8');
    expect(
      gitignore.includes('.claude/projects/'),
      '.gitignore must block .claude/projects/ to prevent user memory files from being committed'
    ).toBe(true);
  });

  it('.claude/projects/ directory does not exist in repo', () => {
    expect(
      existsSync(resolve(ROOT, '.claude/projects/')),
      '.claude/projects/ should not exist in the repo — memory files belong in ~/.claude/'
    ).toBe(false);
  });
});
