#!/usr/bin/env node
/**
 * Acourd RPC — Sovereign CLI Entrypoint
 * Zero-Bloat Universal Discord Rich Presence for AI Coding Agents
 */

import { AcourdDaemon } from '../core/daemon.js';
import { AcourdClient } from '../adapters/generic-client.js';
import { COGNITIVE_STATES, STATE_METADATA } from '../core/constants.js';

function getCharWidth(codePoint) {
  if (!codePoint) return 0;
  if (codePoint >= 0xFE00 && codePoint <= 0xFE0F) return 0; // variation selectors
  if (codePoint >= 0x200B && codePoint <= 0x200D) return 0; // zero-width
  // Wide characters & emojis
  if (
    (codePoint >= 0x1F000 && codePoint <= 0x1FAFF) ||
    (codePoint >= 0x2600 && codePoint <= 0x27BF) ||
    (codePoint >= 0x2B50 && codePoint <= 0x2B55) ||
    (codePoint >= 0x231A && codePoint <= 0x231B) ||
    (codePoint >= 0x23E9 && codePoint <= 0x23F3) ||
    (codePoint >= 0x25AA && codePoint <= 0x25AB) ||
    (codePoint >= 0x25FB && codePoint <= 0x25FE) ||
    (codePoint >= 0x4E00 && codePoint <= 0x9FFF) ||
    (codePoint >= 0x3000 && codePoint <= 0x303F) ||
    (codePoint >= 0xFF01 && codePoint <= 0xFF60)
  ) {
    return 2;
  }
  return 1;
}

function fitString(str, targetWidth) {
  const clean = (str || '').replace(/\x1B\[[0-9;]*m/g, '');
  let width = 0;
  let result = '';

  for (const char of clean) {
    const cp = char.codePointAt(0);
    const charWidth = getCharWidth(cp);
    if (width + charWidth > targetWidth - 1 && clean.length > result.length + 1) {
      return result + '…' + ' '.repeat(Math.max(0, targetWidth - width - 1));
    }
    if (width + charWidth > targetWidth) {
      break;
    }
    result += char;
    width += charWidth;
  }

  const padding = Math.max(0, targetWidth - width);
  return result + ' '.repeat(padding);
}

function printCard(activity = {}) {
  const details = activity.details || 'Standing by';
  const state = activity.state || 'Universal AI RPC';
  const smallText = activity.assets?.small_text || 'Active';
  const largeText = activity.assets?.large_text || 'Acourd RPC';
  const emoji = activity.assets?.small_image ? (STATE_METADATA[activity.assets.small_image]?.emoji || '🤖') : '🤖';

  const w = 52;
  console.log(`
┌────────────────────────────────────────────────────────┐
│  ${fitString(`${emoji}  DISCORD RICH PRESENCE PREVIEW`, w)} │
├────────────────────────────────────────────────────────┤
│  ${fitString(`Application:  ${largeText}`, w)} │
│  ${fitString(`State:        ${details}`, w)} │
│  ${fitString(`Context:      ${state}`, w)} │
│  ${fitString(`Badge:        [ ${smallText} ]`, w)} │
│  ${fitString('Elapsed:      00:14:22 elapsed', w)} │
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

  let customPort = null;
  let customClientId = null;

  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--port' && args[i + 1]) customPort = parseInt(args[i + 1], 10);
    if (args[i] === '--client-id' && args[i + 1]) customClientId = args[i + 1];
  }

  const client = new AcourdClient(customPort ? { port: customPort } : {});

  switch (command) {
    case 'daemon': {
      console.log('⚡ Starting Acourd RPC HTTP Daemon...');
      const daemon = new AcourdDaemon({
        ...(customPort ? { port: customPort } : {}),
        ...(customClientId ? { clientId: customClientId } : {}),
      });

      daemon.on('stop', () => {
        process.exit(0);
      });

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
      const result = await AcourdDaemon.ensureRunning(customPort ? { port: customPort } : {});
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
