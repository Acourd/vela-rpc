#!/usr/bin/env node
/**
 * Acourd RPC — Sovereign CLI Entrypoint
 * Zero-Bloat Universal Discord Rich Presence for AI Coding Agents
 */

import { AcourdDaemon } from '../core/daemon.js';
import { AcourdClient } from '../adapters/generic-client.js';
import { COGNITIVE_STATES, STATE_METADATA } from '../core/constants.js';

function printCard(activity = {}) {
  const details = activity.details || 'Standing by';
  const state = activity.state || 'Universal AI RPC';
  const smallText = activity.assets?.small_text || 'Active';
  const largeText = activity.assets?.large_text || 'Acourd RPC';
  const emoji = activity.assets?.small_image ? (STATE_METADATA[activity.assets.small_image]?.emoji || '🤖') : '🤖';

  console.log(`
┌────────────────────────────────────────────────────────┐
│  ${emoji}  DISCORD RICH PRESENCE PREVIEW                      │
├────────────────────────────────────────────────────────┤
│  Application:  ${largeText.padEnd(38)}│
│  State:        ${details.padEnd(38)}│
│  Context:      ${state.padEnd(38)}│
│  Badge:        ${`[ ${smallText} ]`.padEnd(38)}│
│  Elapsed:      00:14:22 elapsed                        │
└────────────────────────────────────────────────────────┘
`);
}

function printAllPreviews() {
  console.log('\n================ ACOURD RPC: VISUAL PRESENCE SHOWCASE ================\n');

  for (const [key, meta] of Object.entries(STATE_METADATA)) {
    console.log(`[STATE: ${key.toUpperCase()}]`);
    printCard({
      details: `${meta.emoji} ${meta.label}`,
      state: 'acourd-rpc • main',
      assets: {
        large_text: 'Google Antigravity 2.0 • Autonomous Engine',
        small_image: key,
        small_text: meta.description,
      },
    });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'status';

  const client = new AcourdClient();

  switch (command) {
    case 'daemon': {
      console.log('⚡ Starting Acourd RPC HTTP Daemon...');
      const daemon = new AcourdDaemon();
      await daemon.start();
      console.log(`✓ Daemon listening on 127.0.0.1:${daemon.port} (PID: ${process.pid})`);

      const shutdown = async () => {
        console.log('\nStopping daemon gracefully...');
        await daemon.stop();
        process.exit(0);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
      break;
    }

    case 'start': {
      console.log('Spawning Acourd RPC daemon in background...');
      const result = await AcourdDaemon.ensureRunning();
      if (result.spawned) {
        console.log(`✓ Acourd RPC daemon started in background (PID: ${result.pid || 'active'}).`);
      } else {
        console.log('✓ Acourd RPC daemon is already running.');
      }
      break;
    }

    case 'stop': {
      console.log('Stopping Acourd RPC daemon...');
      const status = await client.getStatus();
      if (!status.ok) {
        console.log('Daemon is not running.');
        return;
      }
      try {
        await client._post('/stop', {});
        console.log('✓ Daemon shutdown signal sent.');
      } catch (e) {
        console.log(`Failed to stop daemon: ${e.message}`);
      }
      break;
    }

    case 'status': {
      const status = await client.getStatus();
      if (!status.ok) {
        console.log('❌ Acourd RPC daemon is NOT running.');
        console.log('Run `acourd start` to launch the background micro-daemon.');
        return;
      }

      console.log('================ ACOURD RPC STATUS ================');
      console.log(`Service:         ${status.service}`);
      console.log(`PID:             ${status.pid}`);
      console.log(`Uptime:          ${status.uptimeSeconds}s`);
      console.log(`Discord IPC:     ${status.ipc?.connected ? '✓ CONNECTED' : '✗ DISCONNECTED'}`);
      console.log(`Pipe Path:       ${status.ipc?.pipePath || 'N/A'}`);
      console.log(`Cognitive State: ${status.state}`);

      if (status.activity) {
        console.log('\nActive Activity:');
        printCard(status.activity);
      } else {
        console.log('\nActivity:        (idle / no presence active)');
      }
      break;
    }

    case 'preview': {
      printAllPreviews();
      break;
    }

    case 'set': {
      let state = COGNITIVE_STATES.IDLE;
      let details = 'Manual update';
      let project = 'Acourd Project';

      for (let i = 1; i < args.length; i += 1) {
        if (args[i] === '--state' && args[i + 1]) state = args[i + 1];
        if (args[i] === '--details' && args[i + 1]) details = args[i + 1];
        if (args[i] === '--project' && args[i + 1]) project = args[i + 1];
      }

      const res = await client.sendEvent({
        state,
        details,
        project,
        forceImmediate: true,
      });

      console.log('Activity sent:', res);
      break;
    }

    case 'clear': {
      const res = await client.clear();
      console.log('Activity cleared:', res);
      break;
    }

    default:
      console.log(`
Acourd RPC — Zero-Bloat Universal Discord Rich Presence
Usage: acourd <command> [options]

Commands:
  status             Show daemon health, IPC status, and active card preview
  start              Launch daemon silently in background
  stop               Stop running background daemon
  daemon             Run daemon in foreground
  preview            Render visual high-fidelity presence cards for all states
  set [options]      Manually dispatch an activity event
                     Options: --state <state> --details <text> --project <name>
  clear              Clear presence from Discord
`);
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
