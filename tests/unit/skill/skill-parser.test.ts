/**
 * SkillParser unit tests.
 *
 * Tests cover: frontmatter parsing, malformed input, missing fields,
 * empty content, and edge cases.
 */

import { describe, it, expect } from 'vitest';
import { parseSkillContent, parseSkillFile } from '../../../src/skill/skill-parser';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_DIR = join(tmpdir(), 'aesyclaw-test-skill-parser');

describe('parseSkillContent', () => {
  describe('valid frontmatter', () => {
    it('should parse a skill with name and description', () => {
      const content = `---
name: my-skill
description: A test skill
---
This is the skill content.`;

      const result = parseSkillContent(content);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('my-skill');
      expect(result!.description).toBe('A test skill');
      expect(result!.content).toBe('This is the skill content.');
    });

    it('should parse a skill with only name (no description)', () => {
      const content = `---
name: minimal
---
Content here.`;

      const result = parseSkillContent(content);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('minimal');
      expect(result!.description).toBe('');
      expect(result!.content).toBe('Content here.');
    });

    it('should handle multiline body content', () => {
      const content = `---
name: complex-skill
description: A complex skill
---
## Step 1
Do something.

## Step 2
Do another thing.`;

      const result = parseSkillContent(content);
      expect(result).not.toBeNull();
      expect(result!.content).toContain('## Step 1');
      expect(result!.content).toContain('## Step 2');
    });

    it('should handle quoted string values', () => {
      const content = `---
name: "quoted name"
description: 'single quoted desc'
---
Content.`;

      const result = parseSkillContent(content);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('quoted name');
      expect(result!.description).toBe('single quoted desc');
    });

    it('should handle empty body after closing delimiter', () => {
      const content = `---
name: empty
description: No body
---`;

      const result = parseSkillContent(content);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('empty');
      expect(result!.content).toBe('');
    });

    it('should handle values with colons', () => {
      const content = `---
name: api-skill
description: Calls the API at https://example.com/api
---
Content.`;

      const result = parseSkillContent(content);
      expect(result).not.toBeNull();
      expect(result!.description).toBe('Calls the API at https://example.com/api');
    });

    it('should ignore comment lines in frontmatter', () => {
      const content = `---
# This is a comment
name: commented
description: Has comments
---
Content.`;

      const result = parseSkillContent(content);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('commented');
    });
  });

  describe('malformed input', () => {
    it('should return null for content without frontmatter', () => {
      const content = 'Just regular markdown without frontmatter.';
      expect(parseSkillContent(content)).toBeNull();
    });

    it('should return null for missing closing delimiter', () => {
      const content = `---
name: unclosed
description: No closing delimiter`;

      expect(parseSkillContent(content)).toBeNull();
    });

    it('should return null for missing name in frontmatter', () => {
      const content = `---
description: No name field
---
Content.`;

      expect(parseSkillContent(content)).toBeNull();
    });

    it('should return null for empty frontmatter', () => {
      const content = `---
---
Content.`;

      expect(parseSkillContent(content)).toBeNull();
    });
  });
});

describe('parseSkillFile', () => {
  beforeEach(() => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterAll(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('should parse a valid skill file', () => {
    const filePath = join(TEST_DIR, 'valid-skill.md');
    writeFileSync(
      filePath,
      `---
name: file-skill
description: Skill from file
---
File content.`,
    );

    const result = parseSkillFile(filePath, true);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('file-skill');
    expect(result!.description).toBe('Skill from file');
    expect(result!.content).toBe('File content.');
    expect(result!.isSystem).toBe(true);
    expect(result!.filePath).toBe(filePath);
  });

  it('should return null for a malformed skill file', () => {
    const filePath = join(TEST_DIR, 'malformed.md');
    writeFileSync(filePath, 'No frontmatter here, just text.');

    const result = parseSkillFile(filePath, false);
    expect(result).toBeNull();
  });

  it('should return null for a non-existent file', () => {
    const result = parseSkillFile('/nonexistent/path/skill.md', false);
    expect(result).toBeNull();
  });

  it('should mark user skills as isSystem=false', () => {
    const filePath = join(TEST_DIR, 'user-skill.md');
    writeFileSync(
      filePath,
      `---
name: user-skill
description: A user skill
---
User content.`,
    );

    const result = parseSkillFile(filePath, false);
    expect(result).not.toBeNull();
    expect(result!.isSystem).toBe(false);
  });
});
