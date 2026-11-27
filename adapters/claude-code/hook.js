/**
 * Acourd RPC — Claude Code Hook Adapter (Privacy-First & Real Model Telemetry)
 * Translates Claude Code lifecycle events (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop, SessionEnd)
 * into minimalist Acourd Rich Presence payloads.
 * - NEVER exposes user prompt text (strict privacy guarantee)
 * - Reads real session title from ~/.claude/sessions/*.json
 * - Reads exact active model (e.g. Claude Opus 5.5) from hook payload or session JSONL metadata
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AcourdClient } from '../generic-client.js';
import { COGNITIVE_STATES } from '../../core/constants.js';
import { formatModelName, detectGitBranch } from '../../core/antigravity-telemetry.js';

const CLAUDE_DIR = path.join(os.homedir(), '.claude');

/**
 * Reads the clean session name from ~/.claude/sessions/*.json (no prompt content).
 */
export function readClaudeSessionName(sessionId, sessionsDir = path.join(CLAUDE_DIR, 'sessions')) {
  try {
    if (!fs.existsSync(sessionsDir)) return null;
    const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith('.json'));
    let bestFallback = null;

    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(sessionsDir, file), 'utf8');
        const data = JSON.parse(raw);
        if (sessionId && data.sessionId === sessionId) {
          return (data.name || '').trim() || null;
        }
        if (data.name && (!bestFallback || (data.updatedAt || 0) > bestFallback.updatedAt)) {
          bestFallback = { name: String(data.name).trim(), updatedAt: data.updatedAt || 0 };
        }
      } catch (_) {}
    }

    return sessionId ? null : (bestFallback?.name || null);
  } catch (_) {
    return null;
  }
}

/**
 * Extracts ONLY the latest `"model": "..."` metadata key from the tail of a Claude session JSONL.
 */
export function readClaudeSessionModel(payload = {}) {
  const candidates = [];
  if (payload.transcript_path && fs.existsSync(payload.transcript_path)) {
    candidates.push(payload.transcript_path);
  } else if (payload.session_id) {
    const projectsDir = path.join(CLAUDE_DIR, 'projects');
    if (fs.existsSync(projectsDir)) {
      try {
        for (const dir of fs.readdirSync(projectsDir)) {
          const p = path.join(projectsDir, dir, `${payload.session_id}.jsonl`);
          if (fs.existsSync(p)) {
            candidates.push(p);
            break;
          }
        }
      } catch (_) {}
    }
  }

  for (const filePath of candidates) {
    let fd = null;
    try {
      const stat = fs.statSync(filePath);
      const readSize = Math.min(stat.size, 32768);
      if (readSize <= 0) continue;
      fd = fs.openSync(filePath, 'r');
      const buf = Buffer.alloc(readSize);
      fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
      const text = buf.toString('utf8');
      const matches = [...text.matchAll(/"model"\s*:\s*"([^"]+)"/g)];
      if (matches.length > 0) {
        return matches[matches.length - 1][1];
      }
    } catch (_) {
    } finally {
      if (fd !== null) {
        try { fs.closeSync(fd); } catch (_) {}
      }
    }
  }

  return null;
}

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
 * Strict Privacy: NEVER includes `payload.prompt` text.
 */
export function translateClaudeEvent(hookName, payload = {}, cwd = process.cwd()) {
  const effectiveCwd = payload.cwd || cwd || process.cwd();
  const projectName = path.basename(effectiveCwd) || 'Workspace';
  const branch = detectGitBranch(effectiveCwd) || undefined;

  const detectedModel = payload.model
    || payload.model_name
    || readClaudeSessionModel(payload)
    || process.env.ANTHROPIC_MODEL
    || null;
  const model = detectedModel ? formatModelName(detectedModel) : null;

  const sessionId = payload.sessionId || payload.session_id || undefined;
  const sessionTitle = payload.session_name
    || (payload.session_id ? readClaudeSessionName(payload.session_id) : null)
    || undefined;

  const eventName = (hookName || payload.hook_event_name || 'unknown').toLowerCase();

  const base = {
    source: 'claude',
    harness: 'claude-code',
    ...(sessionId ? { sessionId } : {}),
    project: projectName,
    ...(branch ? { branch } : {}),
    ...(sessionTitle ? { chatTitle: sessionTitle } : {}),
    agentName: 'Claude Code',
    model,
    largeImage: 'claude-code',
  };

  switch (eventName) {
    case 'sessionstart':
      return {
        ...base,
        state: COGNITIVE_STATES.IDLE,
        details: sessionTitle || projectName,
        resetTimer: true,
        forceImmediate: true,
      };

    case 'userpromptsubmit':
      return {
        ...base,
        state: COGNITIVE_STATES.THINKING,
        // Privacy guarantee: never echo user prompt text
        details: sessionTitle || `Working on ${projectName}`,
        forceImmediate: true,
      };

    case 'pretooluse': {
      const toolDesc = formatClaudeTool(payload.tool_name, payload.tool_input);
      const isTestTool = /test|verify|check|eval/i.test(payload.tool_name || '') ||
        /test|verify|npm test|vitest|jest|cargo test/i.test(payload.tool_input?.command || '');

      return {
        ...base,
        state: isTestTool ? COGNITIVE_STATES.VERIFYING : COGNITIVE_STATES.TOOL_CALL,
        tool: payload.tool_name,
        details: toolDesc,
      };
    }

    case 'posttooluse':
      return {
        ...base,
        state: COGNITIVE_STATES.THINKING,
        details: sessionTitle || `Working on ${projectName}`,
      };

    case 'stop':
      return {
        ...base,
        state: COGNITIVE_STATES.IDLE,
        details: sessionTitle || projectName,
      };

    case 'sessionend':
      return {
        ...base,
        state: COGNITIVE_STATES.IDLE,
        details: sessionTitle || projectName,
        releaseLease: true,
        forceImmediate: true,
      };

    default:
      return {
        ...base,
        state: COGNITIVE_STATES.IDLE,
        details: sessionTitle || projectName,
      };
  }
}

/**
 * CLI execution entrypoint for Claude Code hook runner.
 */
export async function runClaudeHook(cliArgs = process.argv.slice(2)) {
  let hookName = cliArgs[0] || process.env.CLAUDE_HOOK_NAME || null;

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
  runClaudeHook().catch(() => process.exit(0));
}
