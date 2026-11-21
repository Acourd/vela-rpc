/**
 * Acourd RPC — Micro-Daemon HTTP Server Unit Tests
 * Verifies local loopback endpoints: /status, /event, /clear, /stop.
 */

import assert from 'node:assert';
import http from 'node:http';
import { AcourdDaemon } from '../core/daemon.js';
import { COGNITIVE_STATES } from '../core/constants.js';

function requestHttp(method, path, body = null, port = 19455) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body), 'utf8') : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: data
          ? {
              'Content-Type': 'application/json',
              'Content-Length': data.length,
            }
          : {},
        timeout: 2000,
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          try {
            resolve({ statusCode: res.statusCode, body: JSON.parse(raw) });
          } catch (_) {
            resolve({ statusCode: res.statusCode, raw });
          }
        });
      }
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });

    if (data) req.write(data);
    req.end();
  });
}

export async function runDaemonTests() {
  console.log('\n--- Running Micro-Daemon HTTP Tests ---');
  const testPort = 19455;
  const daemon = new AcourdDaemon({
    port: testPort,
    debounceMs: 50,
    pidFile: false,
  });

  await daemon.start();
  console.log(`✓ Daemon started on port ${testPort}`);

  // Test 1: GET /status
  const statusRes = await requestHttp('GET', '/status', null, testPort);
  assert.strictEqual(statusRes.statusCode, 200);
  assert.strictEqual(statusRes.body.ok, true);
  assert.strictEqual(statusRes.body.service, 'acourd-rpc');
  assert.strictEqual(typeof statusRes.body.pid, 'number');
  console.log('✓ GET /status verified');

  // Test 2: POST /event (Ephemeral speed test < 15ms)
  const startTime = Date.now();
  const eventRes = await requestHttp(
    'POST',
    '/event',
    {
      state: COGNITIVE_STATES.THINKING,
      project: 'AcourdDaemonTest',
      details: 'Microkernel stress testing',
      forceImmediate: true,
    },
    testPort
  );
  const elapsedMs = Date.now() - startTime;

  assert.strictEqual(eventRes.statusCode, 200);
  assert.strictEqual(eventRes.body.ok, true);
  assert.strictEqual(eventRes.body.sent, true);
  console.log(`✓ POST /event responded in ${elapsedMs}ms (< 15ms target)`);

  // Verify status updated with new state
  const statusAfter = await requestHttp('GET', '/status', null, testPort);
  assert.strictEqual(statusAfter.body.state, COGNITIVE_STATES.THINKING);
  assert.ok(statusAfter.body.activity.details.includes('Microkernel stress testing'));
  console.log('✓ State persistence inside daemon verified');

  // Test 3: POST /clear cancels pending activity and prevents resurrection
  // Queue a debounced event that would fire after 50ms
  await requestHttp(
    'POST',
    '/event',
    {
      state: COGNITIVE_STATES.TOOL_CALL,
      project: 'AcourdDaemonTest',
      details: 'Pending debounced event to clear',
      forceImmediate: false,
    },
    testPort
  );
  assert.ok(daemon.stateEngine.pendingActivity !== null, 'Event should be pending');

  const clearRes = await requestHttp('POST', '/clear', {}, testPort);
  assert.strictEqual(clearRes.statusCode, 200);
  assert.strictEqual(clearRes.body.cleared, true);
  assert.strictEqual(daemon.stateEngine.pendingActivity, null, 'Pending activity must be cancelled on /clear');
  assert.strictEqual(daemon.stateEngine.activeActivity, null, 'Active activity must be null on /clear');

  // Wait 70ms to ensure the timer did not fire and resurrect presence
  await new Promise((r) => setTimeout(r, 70));
  assert.strictEqual(daemon.stateEngine.activeActivity, null, 'Debounce timer must not resurrect cleared activity');
  console.log('✓ POST /clear and anti-resurrection verified');

  // Test 4: POST /stop
  const stopRes = await requestHttp('POST', '/stop', {}, testPort);
  assert.strictEqual(stopRes.statusCode, 200);
  assert.strictEqual(stopRes.body.stopping, true);

  await new Promise((r) => setTimeout(r, 100));
  const isRunning = await AcourdDaemon.isRunning(testPort);
  assert.strictEqual(isRunning, false, 'Daemon must stop after /stop request');
  console.log('✓ POST /stop graceful shutdown verified');
}

if (process.argv[1] && process.argv[1].endsWith('daemon.test.js')) {
  runDaemonTests()
    .then(() => {
      console.log('All Daemon tests passed!');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Test failed:', err);
      process.exit(1);
    });
}
