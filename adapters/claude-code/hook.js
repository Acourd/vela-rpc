/**
 * Acourd RPC — Claude Code Hook Adapter
 * Translates Claude Code lifecycle events (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop, SessionEnd)
 * into rich cognitive state events dispatched to the Acourd daemon.
 */

import path from 'node:path';
import { AcourdClient } from '../generic-client.js';
import { COGNITIVE_STATES } from '../../core/constants.js';

/**
 * Normalizes Claude Code tool names to friendly descriptive strings.
 */
export function formatClaudeTool(toolName, toolInput) {
  if (!toolName) return 'Tool Execution';
  const name = String(toolName).toLowerCase();

  if (name === 'edit' || name === 'strreplace' || name === 'file_edit') {
    const file = toolInput?.file_path || toolInput?.path || '';
    return file ? `Editing ${path.basename(file)}` : 'Editing code';
  }
  if (name === 'write' || name === 'file_write') {
    const file = toolInput?.file_path || toolInput?.path || '';
    return file ? `Writing ${path.basename(file)}` : 'Creating file';
  }
  if (name === 'read' || name === 'file_read') {
    const file = toolInput?.file_path || toolInput?.path || '';
    return file ? `Reading ${path.basename(file)}` : 'Reading code';
  }
  if (name === 'bash' || name === 'command' || name === 'exec') {
    const cmd = toolInput?.command || '';
    const cmdHead = cmd.trim().split(/\s+/)[0] || 'terminal';
    return `Terminal: ${cmdHead}`;
  }
  if (name === 'grep' || name === 'glob' || name === 'search') {
    return 'Searching codebase';
  }

  return `Executing ${toolName}`;
}

/**
 * Translates a Claude Code hook payload into an Acourd state event.
 */
export function translateClaudeEvent(hookName, payload = {}, cwd = process.cwd()) {
  const projectName = path.basename(cwd) || 'Project';
  const eventName = (hookName || payload.hook_event_name || 'unknown').toLowerCase();

  switch (eventName) {
    case 'sessionstart':
      return {
        state: COGNITIVE_STATES.IDLE,
        project: projectName,
        agentName: 'Claude Code',
        details: 'Session started • Ready',
        resetTimer: true,
        largeImage: 'claude_code',
        forceImmediate: true,
      };

    case 'userpromptsubmit': {
      const promptSnippet = payload.prompt ? payload.prompt.slice(0, 50) : null;
      return {
        state: COGNITIVE_STATES.THINKING,
        project: projectName,
        agentName: 'Claude Code',
        details: promptSnippet ? `Prompt: "${promptSnippet}..."` : 'Synthesizing reasoning & plan',
        largeImage: 'claude_code',
      };
    }

    case 'pretooluse': {
      const toolDesc = formatClaudeTool(payload.tool_name, payload.tool_input);
      const isTestTool = /test|verify|check|eval/i.test(payload.tool_name || '') ||
        /test|verify|npm test|vitest|jest|cargo test/i.test(payload.tool_input?.command || '');

      return {
        state: isTestTool ? COGNITIVE_STATES.VERIFYING : COGNITIVE_STATES.TOOL_CALL,
        project: projectName,
        agentName: 'Claude Code',
        tool: payload.tool_name,
        details: toolDesc,
        largeImage: 'claude_code',
      };
    }

    case 'posttooluse':
      return {
        state: COGNITIVE_STATES.THINKING,
        project: projectName,
        agentName: 'Claude Code',
        details: 'Reviewing tool outcome',
        largeImage: 'claude_code',
      };

    case 'stop':
      return {
        state: COGNITIVE_STATES.IDLE,
        project: projectName,
        agentName: 'Claude Code',
        details: 'Turn complete • Awaiting user',
        largeImage: 'claude_code',
      };

    case 'sessionend':
      return {
        state: COGNITIVE_STATES.IDLE,
        project: projectName,
        agentName: 'Claude Code',
        details: 'Session finished',
        largeImage: 'claude_code',
        forceImmediate: true,
      };

    default:
      return {
        state: COGNITIVE_STATES.IDLE,
        project: projectName,
        agentName: 'Claude Code',
        details: `Active in ${projectName}`,
        largeImage: 'claude_code',
      };
  }
}

/**
 * CLI execution entrypoint for Claude Code hook runner.
 */
async function main() {
  const args = process.argv.slice(2);
  let hookName = args[0] || process.env.CLAUDE_HOOK_NAME || null;

  // Read stdin if piped, with 250ms timeout
  let payload = {};
  if (!process.stdin.isTTY) {
    try {
      const chunks = [];
      const readPromise = new Promise((resolve) => {
        process.stdin.on('data', (d) => chunks.push(d));
        process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        process.stdin.on('error', () => resolve(''));
      });
      const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(''), 250));
      const raw = await Promise.race([readPromise, timeoutPromise]);
      if (raw && raw.trim()) {
        payload = JSON.parse(raw);
      }
    } catch (_) {}
  }

  hookName = hookName || payload.hook_event_name || 'SessionStart';

  const client = new AcourdClient();
  const event = translateClaudeEvent(hookName, payload, process.cwd());
  await client.sendEvent(event, true);

  // Silent exit code 0 so Claude Code hook runner is never blocked
  process.exit(0);
}

if (process.argv[1] && (process.argv[1].endsWith('claude-code/hook.js') || process.argv[1].endsWith('claude-code\\hook.js'))) {
  main().catch(() => process.exit(0));
}
