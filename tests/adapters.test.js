/**
 * Acourd RPC — Adapters Unit Tests
 * Verifies Claude Code and Google Antigravity 2.0 event translations and tool formatters.
 */

import assert from 'node:assert';
import {
  translateClaudeEvent,
  formatClaudeTool,
} from '../adapters/claude-code/hook.js';
import { generateClaudeHookConfig } from '../adapters/claude-code/config-helper.js';
import { translateAntigravityEvent } from '../adapters/antigravity/hook.js';
import { COGNITIVE_STATES } from '../core/constants.js';

export async function runAdaptersTests() {
  console.log('\n--- Running Adapters Unit Tests ---');

  // Test 1: formatClaudeTool
  assert.strictEqual(
    formatClaudeTool('Edit', { file_path: 'C:/src/kernel.js' }),
    'Editing kernel.js'
  );
  assert.strictEqual(
    formatClaudeTool('Bash', { command: 'git status --short' }),
    'Terminal: git'
  );
  assert.strictEqual(
    formatClaudeTool('Grep', {}),
    'Searching codebase'
  );
  console.log('✓ Claude Code tool formatter verified');

  // Test 2: translateClaudeEvent
  const sessionStart = translateClaudeEvent('SessionStart', {}, 'C:/Users/Ayzok/my-app');
  assert.strictEqual(sessionStart.state, COGNITIVE_STATES.IDLE);
  assert.strictEqual(sessionStart.project, 'my-app');
  assert.strictEqual(sessionStart.resetTimer, true);
  assert.strictEqual(sessionStart.forceImmediate, true);

  const promptSubmit = translateClaudeEvent(
    'UserPromptSubmit',
    { prompt: 'Optimize the binary framing socket' },
    'C:/Users/Ayzok/my-app'
  );
  assert.strictEqual(promptSubmit.state, COGNITIVE_STATES.THINKING);
  assert.ok(promptSubmit.details.includes('Optimize the binary framing'));

  const toolUse = translateClaudeEvent(
    'PreToolUse',
    { tool_name: 'Edit', tool_input: { path: 'index.js' } },
    'C:/Users/Ayzok/my-app'
  );
  assert.strictEqual(toolUse.state, COGNITIVE_STATES.TOOL_CALL);
  assert.strictEqual(toolUse.details, 'Editing index.js');

  const testToolUse = translateClaudeEvent(
    'PreToolUse',
    { tool_name: 'Bash', tool_input: { command: 'npm test -- --coverage' } },
    'C:/Users/Ayzok/my-app'
  );
  assert.strictEqual(testToolUse.state, COGNITIVE_STATES.VERIFYING);

  const stopTurn = translateClaudeEvent('Stop', {}, 'C:/Users/Ayzok/my-app');
  assert.strictEqual(stopTurn.state, COGNITIVE_STATES.IDLE);

  const sessionEnd = translateClaudeEvent('SessionEnd', {}, 'C:/Users/Ayzok/my-app');
  assert.strictEqual(sessionEnd.state, COGNITIVE_STATES.IDLE);
  assert.strictEqual(sessionEnd.forceImmediate, true);
  console.log('✓ Claude Code event translation verified');

  // Test 3: Claude Code Hook Configuration Generator (Schema Compliance)
  const hookConfig = generateClaudeHookConfig();
  assert.ok(hookConfig.hooks.SessionStart);
  assert.strictEqual(Array.isArray(hookConfig.hooks.SessionStart), true);
  assert.strictEqual(Array.isArray(hookConfig.hooks.SessionStart[0].hooks), true);
  assert.strictEqual(hookConfig.hooks.SessionStart[0].hooks[0].type, 'command');
  assert.strictEqual(hookConfig.hooks.SessionStart[0].hooks[0].timeout, 2);
  assert.ok(hookConfig.hooks.SessionStart[0].hooks[0].command.includes('hook.js'));
  assert.ok(hookConfig.hooks.UserPromptSubmit);
  assert.ok(hookConfig.hooks.PreToolUse);
  assert.ok(hookConfig.hooks.PostToolUse);
  assert.ok(hookConfig.hooks.Stop);
  assert.ok(hookConfig.hooks.SessionEnd);
  console.log('✓ Claude Code hook configuration generator (schema compliant) verified');

  // Test 4: translateAntigravityEvent
  const agIntent = translateAntigravityEvent('intent', {
    task: 'Create zero-bloat microkernel',
    workspace: 'C:/Users/Ayzok/universal_ai_discord_rpc',
    branch: 'feat/rpc',
  });
  assert.strictEqual(agIntent.state, COGNITIVE_STATES.THINKING);
  assert.strictEqual(agIntent.agentName, 'Google Antigravity 2.0');
  assert.strictEqual(agIntent.branch, 'feat/rpc');
  assert.ok(agIntent.details.includes('zero-bloat microkernel'));

  const agSwarm = translateAntigravityEvent('swarm', {
    subagentRole: 'SecurityAuditor',
    branch: 'feat/rpc',
  });
  assert.strictEqual(agSwarm.state, COGNITIVE_STATES.SWARM);
  assert.ok(agSwarm.details.includes('[SecurityAuditor]'));

  const agVerify = translateAntigravityEvent('verify', {
    summary: '17/17 tests passing',
    branch: 'feat/rpc',
  });
  assert.strictEqual(agVerify.state, COGNITIVE_STATES.VERIFYING);
  assert.strictEqual(agVerify.details, '17/17 tests passing');

  const agReview = translateAntigravityEvent('review', { branch: 'feat/rpc' });
  assert.strictEqual(agReview.state, COGNITIVE_STATES.REVIEWING);

  const agIdle = translateAntigravityEvent('idle', { branch: 'feat/rpc' });
  assert.strictEqual(agIdle.state, COGNITIVE_STATES.IDLE);
  assert.strictEqual(agIdle.forceImmediate, true);
  console.log('✓ Google Antigravity 2.0 event translation verified');
}

if (process.argv[1] && process.argv[1].endsWith('adapters.test.js')) {
  runAdaptersTests()
    .then(() => {
      console.log('All Adapters tests passed!');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Test failed:', err);
      process.exit(1);
    });
}
