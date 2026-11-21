/**
 * Acourd RPC — Discord IPC Unit & Physical Mock Tests
 * Verifies 8-byte LE binary framing, chunk defragmentation, Handshake, and SET_ACTIVITY.
 */

import assert from 'node:assert';
import { DiscordIPC } from '../core/discord-ipc.js';
import { MockDiscordServer } from './mock-discord-ipc.js';
import { OPCODES } from '../core/constants.js';

export async function runDiscordIpcTests() {
  console.log('\n--- Running Discord IPC Physical Tests ---');
  const mockServer = new MockDiscordServer();
  const pipePath = await mockServer.start();
  console.log(`✓ Mock Discord Server listening on: ${pipePath}`);

  const client = new DiscordIPC({
    clientId: '123456789012345678',
    customPath: pipePath,
  });

  // Test 1: Connect and complete Handshake
  let connectedFired = false;
  let readyFired = false;

  client.on('connect', () => { connectedFired = true; });
  client.on('ready', () => { readyFired = true; });

  await client.connect();

  // Wait briefly for READY dispatch frame
  await new Promise((r) => setTimeout(r, 100));

  assert.strictEqual(connectedFired, true, 'Client should emit connect event');
  assert.strictEqual(readyFired, true, 'Client should emit ready event upon receiving DISPATCH READY');
  assert.strictEqual(mockServer.receivedHandshakes.length, 1, 'Server should receive 1 handshake');
  assert.strictEqual(mockServer.receivedHandshakes[0].v, 1, 'Handshake protocol version must be 1');
  assert.strictEqual(mockServer.receivedHandshakes[0].client_id, '123456789012345678', 'Client ID must match');
  console.log('✓ Handshake & DISPATCH READY verified');

  // Test 2: Send SET_ACTIVITY frame
  const testActivity = {
    details: '🧠 Reasoning about AST microkernel',
    state: 'acourd-rpc • main',
    assets: {
      large_image: 'acourd_logo',
      large_text: 'Acourd RPC',
      small_image: 'thinking',
      small_text: 'Reasoning',
    },
  };

  client.setActivity(testActivity);
  await new Promise((r) => setTimeout(r, 100));

  assert.strictEqual(mockServer.receivedActivities.length, 1, 'Server should receive 1 SET_ACTIVITY');
  assert.strictEqual(mockServer.receivedActivities[0].details, testActivity.details, 'Activity details must match');
  assert.strictEqual(mockServer.receivedActivities[0].state, testActivity.state, 'Activity state must match');
  console.log('✓ SET_ACTIVITY binary transmission verified');

  // Test 3: Clear activity
  client.clearActivity();
  await new Promise((r) => setTimeout(r, 100));
  assert.strictEqual(mockServer.receivedActivities.length, 2, 'Server should receive 2 activities');
  assert.strictEqual(mockServer.receivedActivities[1], null, 'Second activity should be null (cleared)');
  console.log('✓ clearActivity verified');

  // Test 4: Fragmented chunk accumulator test
  // Inject a split frame across multiple chunks directly into client's socket
  const dummyPayload = { test: 'chunked_data' };
  const dummyBytes = Buffer.from(JSON.stringify(dummyPayload), 'utf8');
  const header = Buffer.alloc(8);
  header.writeUInt32LE(OPCODES.FRAME, 0);
  header.writeUInt32LE(dummyBytes.length, 4);
  const fullFrame = Buffer.concat([header, dummyBytes]);

  let receivedFragmentedFrame = false;
  client.on('frame', (f) => {
    if (f.payload?.test === 'chunked_data') {
      receivedFragmentedFrame = true;
    }
  });

  // Send chunk 1: 3 bytes of header
  client.socket.emit('data', fullFrame.subarray(0, 3));
  // Send chunk 2: remaining 5 bytes of header + partial payload
  client.socket.emit('data', fullFrame.subarray(3, 10));
  // Send chunk 3: remainder of payload
  client.socket.emit('data', fullFrame.subarray(10));

  assert.strictEqual(receivedFragmentedFrame, true, 'Accumulator must defragment split frame');
  console.log('✓ Binary frame chunk defragmentation verified');

  // Teardown
  client.disconnect();
  await mockServer.close();
  console.log('✓ Clean disconnection verified');

  // Test 5: Connection failure rejection without unhandled EventEmitter crash
  const failingClient = new DiscordIPC({
    clientId: '123456789012345678',
    customPath: process.platform === 'win32' ? '\\\\.\\pipe\\non-existent-pipe-test-xyz' : '/tmp/non-existent-socket-test-xyz.sock',
  });

  let caughtError = null;
  try {
    // Calling connect without registering an 'error' event listener
    // Should reject the promise and NOT crash with unhandled EventEmitter error
    await failingClient.connect();
  } catch (err) {
    caughtError = err;
  }
  assert.ok(caughtError !== null, 'Connection to non-existent pipe must reject');
  console.log('✓ Graceful connection failure without unhandled error verified');
}

if (process.argv[1] && process.argv[1].endsWith('discord-ipc.test.js')) {
  runDiscordIpcTests()
    .then(() => {
      console.log('All Discord IPC tests passed!');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Test failed:', err);
      process.exit(1);
    });
}
