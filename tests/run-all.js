/**
 * Acourd RPC — Sovereign Test Suite Runner
 * Executes all physical unit and integration tests with deterministic exit code 0.
 */

import { runDiscordIpcTests } from './discord-ipc.test.js';
import { runStateEngineTests } from './state-engine.test.js';
import { runDaemonTests } from './daemon.test.js';
import { runAdaptersTests } from './adapters.test.js';
import { runIntegrationTests } from './integration.test.js';

async function main() {
  console.log('========================================================');
  console.log('    ACOURD RPC — DETERMINISTIC PHYSICAL TEST SUITE       ');
  console.log('========================================================\n');

  const startTime = Date.now();
  let totalSuites = 0;
  let passedSuites = 0;

  const suites = [
    { name: 'Discord IPC & Binary Framing', fn: runDiscordIpcTests },
    { name: 'State Engine, Rate Limiter & Privacy', fn: runStateEngineTests },
    { name: 'Micro-Daemon HTTP Server', fn: runDaemonTests },
    { name: 'Claude Code & Antigravity Adapters', fn: runAdaptersTests },
    { name: 'End-to-End Mock Integration', fn: runIntegrationTests },
  ];

  for (const suite of suites) {
    totalSuites += 1;
    try {
      await suite.fn();
      passedSuites += 1;
      console.log(`\n>>> [PASS] Suite: ${suite.name}`);
    } catch (err) {
      console.error(`\n>>> [FAIL] Suite: ${suite.name}`);
      console.error(err);
      process.exit(1);
    }
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log('\n========================================================');
  console.log(`✓ ALL TESTS PASSED: ${passedSuites}/${totalSuites} suites in green (${durationSec}s)`);
  console.log('========================================================\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
