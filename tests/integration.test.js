/**
 * Acourd RPC — End-to-End Integration Test
 * Verifies full chain: Adapter Hook -> Local HTTP Daemon -> State Engine & Rate Limiter -> Pure IPC -> Mock Discord RPC Server
 */

import assert from 'node:assert';
import { MockDiscordServer } from './mock-discord-ipc.js';
import { AcourdDaemon } from '../core/daemon.js';
import { AcourdClient } from '../adapters/generic-client.js';
import { translateClaudeEvent } from '../adapters/claude-code/hook.js';
import { translateAntigravityEvent } from '../adapters/antigravity/hook.js';

export async function runIntegrationTests() {
  console.log('\n--- Running End-to-End Integration Test ---');

  // 1. Launch Mock Discord Server
  const mockServer = new MockDiscordServer();
  const pipePath = await mockServer.start();
  console.log(`✓ Mock Discord Server listening on: ${pipePath}`);

  // 2. Launch Acourd Daemon connected to the mock pipe
  const testPort = 19456;
  const daemon = new AcourdDaemon({
    port: testPort,
    customIpcPath: pipePath,
    debounceMs: 50,
    pidFile: false,
  });

  await daemon.start();
  console.log(`✓ Acourd Daemon running on port ${testPort}`);

  // Wait for IPC Handshake to complete
  let readyAttempts = 0;
  while ((!daemon.ipc || !daemon.ipc.ready) && readyAttempts < 30) {
    await new Promise((r) => setTimeout(r, 50));
    readyAttempts += 1;
  }
  assert.strictEqual(daemon.ipc.ready, true, 'Daemon IPC must be ready and handshaked with Discord');
  console.log('✓ Daemon connected & handshaked with Mock Discord Server');

  const client = new AcourdClient({ port: testPort });

  // 3. Dispatch Claude Code UserPromptSubmit event
  const claudeEvent = translateClaudeEvent(
    'UserPromptSubmit',
    { prompt: 'Implement zero-bloat binary framing microkernel' },
    'C:/Projects/AcourdCore'
  );
  claudeEvent.forceImmediate = true;

  const res1 = await client.sendEvent(claudeEvent, false);
  assert.strictEqual(res1.ok, true);
  await new Promise((r) => setTimeout(r, 100));

  assert.strictEqual(mockServer.receivedActivities.length, 1);
  const act1 = mockServer.receivedActivities[0];
  assert.ok(act1.details.includes('🧠'));
  assert.ok(act1.details.includes('Implement zero-bloat'));
  assert.strictEqual(act1.state, 'AcourdCore • main');
  console.log('✓ Claude Code event traveled to Mock Discord: SET_ACTIVITY verified');

  // 4. Dispatch Google Antigravity 2.0 verification event
  const agEvent = translateAntigravityEvent('verify', {
    project: 'AcourdCore',
    branch: 'release/v1.0',
    summary: 'Deterministic Oracle (17/17 PASS)',
  });
  agEvent.forceImmediate = true;

  const res2 = await client.sendEvent(agEvent, false);
  assert.strictEqual(res2.ok, true);
  await new Promise((r) => setTimeout(r, 100));

  assert.strictEqual(mockServer.receivedActivities.length, 2);
  const act2 = mockServer.receivedActivities[1];
  assert.ok(act2.details.includes('🛡️'));
  assert.ok(act2.details.includes('17/17 PASS'));
  assert.strictEqual(act2.state, 'AcourdCore • release/v1.0');
  console.log('✓ Antigravity event traveled to Mock Discord: SET_ACTIVITY verified');

  // 5. Dispatch Clear Presence
  const clearRes = await client.clear();
  assert.strictEqual(clearRes.ok, true);
  await new Promise((r) => setTimeout(r, 100));

  assert.strictEqual(mockServer.receivedActivities.length, 3);
  assert.strictEqual(mockServer.receivedActivities[2], null);
  console.log('✓ Clear presence traveled to Mock Discord verified');

  // Teardown
  await daemon.stop();
  await mockServer.close();
  console.log('✓ Integration teardown complete');
}

if (process.argv[1] && process.argv[1].endsWith('integration.test.js')) {
  runIntegrationTests()
    .then(() => {
      console.log('All Integration tests passed!');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Test failed:', err);
      process.exit(1);
    });
}
