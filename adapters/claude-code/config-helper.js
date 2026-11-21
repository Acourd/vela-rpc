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

  const events = [
    'SessionStart',
    'UserPromptSubmit',
    'PreToolUse',
    'PostToolUse',
    'Stop',
    'SessionEnd',
  ];

  const config = { hooks: {} };

  for (const event of events) {
    config.hooks[event] = [
      {
        hooks: [
          {
            type: 'command',
            command: `node "${hookScript}" ${event}`,
            timeout: 2,
          },
        ],
      },
    ];
  }

  return config;
}
