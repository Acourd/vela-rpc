/**
 * Acourd RPC — State Engine & Privacy Unit Tests
 * Tests UTF-8 safe truncation, privacy sanitization, rate-limit debounce, and state transitions.
 */

import assert from 'node:assert';
import {
  StateEngine,
  truncateUtf8,
  sanitizePrivacy,
} from '../core/state-engine.js';
import { COGNITIVE_STATES, DISCORD_LIMITS } from '../core/constants.js';

export async function runStateEngineTests() {
  console.log('\n--- Running State Engine Tests ---');

  // Test 1: truncateUtf8 boundary tests
  assert.strictEqual(truncateUtf8('hello', 10), 'hello');
  assert.strictEqual(truncateUtf8('', 10), '');

  // 130 ASCII chars truncated to 128
  const longAscii = 'a'.repeat(150);
  const truncatedAscii = truncateUtf8(longAscii, 128);
  assert.strictEqual(Buffer.byteLength(truncatedAscii, 'utf8'), 128);

  // Multi-byte Unicode boundary safety
  // '🧠' is 4 bytes in UTF-8
  const emojis = '🧠'.repeat(40); // 160 bytes
  const truncatedEmojis = truncateUtf8(emojis, 128);
  assert.ok(Buffer.byteLength(truncatedEmojis, 'utf8') <= 128);
  assert.ok(!truncatedEmojis.includes('\uFFFD'), 'Truncated string must not contain replacement characters');
  console.log('✓ UTF-8 safe boundary truncation verified');

  // Test 2: sanitizePrivacy
  const rawPathWindows = 'Processing C:\\Users\\Ayzok\\Projects\\secret-app\\index.js';
  const sanitizedPath = sanitizePrivacy(rawPathWindows);
  assert.ok(!sanitizedPath.includes('Users'), 'Must redact Windows user home path');
  assert.ok(sanitizedPath.includes('~'), 'Must replace home path with tilde');

  const rawEnv = 'Loaded configuration from .env.production and .env.local';
  const sanitizedEnv = sanitizePrivacy(rawEnv);
  assert.ok(!sanitizedEnv.includes('.env'), 'Must redact .env mentions');
  assert.ok(sanitizedEnv.includes('[REDACTED_ENV]'), 'Must replace with [REDACTED_ENV]');

  const rawSecret = 'Bearer sk-1234567890abcdef1234567890abcdef and ghp_123456789012345678901234567890123456';
  const sanitizedSecret = sanitizePrivacy(rawSecret);
  assert.ok(!sanitizedSecret.includes('sk-12345'), 'Must redact API keys');
  assert.ok(!sanitizedSecret.includes('ghp_12345'), 'Must redact GitHub tokens');
  assert.ok(sanitizedSecret.includes('[REDACTED_TOKEN]'));

  const stealthTest = sanitizePrivacy('Workspace: super-secret-corp', { stealthMode: true });
  assert.ok(stealthTest.includes('Workspace: [Private]'), 'Stealth mode must mask workspace name');
  console.log('✓ Privacy & secret sanitization verified');

  // Test 3: Rate-limit debounce (15s cooldown)
  const engine = new StateEngine({ debounceMs: 100 }); // Fast 100ms debounce for tests

  let dispatchedActivities = [];
  engine.on('activity', (act) => {
    dispatchedActivities.push(act);
  });

  // First event: should send immediately
  const res1 = engine.processEvent({
    state: COGNITIVE_STATES.THINKING,
    details: 'Analyzing architecture',
    project: 'Acourd',
  });
  assert.strictEqual(res1.sent, true, 'First event must dispatch immediately');
  assert.strictEqual(dispatchedActivities.length, 1);

  // Second event immediately after: should be debounced
  const res2 = engine.processEvent({
    state: COGNITIVE_STATES.TOOL_CALL,
    details: 'Editing state-engine.js',
    project: 'Acourd',
  });
  assert.strictEqual(res2.queued, true, 'Subsequent event during cooldown must be queued');
  assert.strictEqual(dispatchedActivities.length, 1, 'Debounced event must not have dispatched yet');

  // Wait for debounce timer (120ms)
  await new Promise((r) => setTimeout(r, 150));
  assert.strictEqual(dispatchedActivities.length, 2, 'Debounced event must dispatch after cooldown');
  assert.ok(dispatchedActivities[1].details.includes('Editing state-engine.js'));
  console.log('✓ Rate-limiting & cooldown debounce verified');

  // Test 4: Force immediate bypasses cooldown
  const res3 = engine.processEvent({
    state: COGNITIVE_STATES.IDLE,
    details: 'Finished mission',
    project: 'Acourd',
    forceImmediate: true,
  });
  assert.strictEqual(res3.sent, true, 'forceImmediate must bypass cooldown');
  assert.strictEqual(dispatchedActivities.length, 3);
  console.log('✓ forceImmediate override verified');

  // Test 5: Unknown cognitive state normalization
  engine.processEvent({
    state: 'completely_unknown_state',
    forceImmediate: true,
  });
  assert.strictEqual(engine.currentState, COGNITIVE_STATES.IDLE, 'Unknown state must fall back to IDLE');
  console.log('✓ Cognitive state normalization verified');

  engine.destroy();
}

if (process.argv[1] && process.argv[1].endsWith('state-engine.test.js')) {
  runStateEngineTests()
    .then(() => {
      console.log('All State Engine tests passed!');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Test failed:', err);
      process.exit(1);
    });
}
