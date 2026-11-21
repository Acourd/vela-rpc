/**
 * Acourd RPC — Claude Code Configuration Generator
 * Produces clean hook manifests ready to insert into .claude/settings.json
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function generateClaudeHookConfig() {
  const hookScript = path.resolve(__dirname, 'hook.js');

  return {
    hooks: {
      SessionStart: [
        {
          command: `node "${hookScript}" SessionStart`,
          timeout: 2000,
        },
      ],
      UserPromptSubmit: [
        {
          command: `node "${hookScript}" UserPromptSubmit`,
          timeout: 2000,
        },
      ],
      PreToolUse: [
        {
          command: `node "${hookScript}" PreToolUse`,
          timeout: 2000,
        },
      ],
      PostToolUse: [
        {
          command: `node "${hookScript}" PostToolUse`,
          timeout: 2000,
        },
      ],
      Stop: [
        {
          command: `node "${hookScript}" Stop`,
          timeout: 2000,
        },
      ],
      SessionEnd: [
        {
          command: `node "${hookScript}" SessionEnd`,
          timeout: 2000,
        },
      ],
    },
  };
}
