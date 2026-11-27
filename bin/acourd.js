#!/usr/bin/env node
/**
 * Acourd RPC — Sovereign CLI Entrypoint
 * Zero-Bloat Universal Discord Rich Presence for AI Coding Agents
 */

import { AcourdDaemon } from '../core/daemon.js';
import { AcourdClient } from '../adapters/generic-client.js';
import { COGNITIVE_STATES, STATE_METADATA } from '../core/constants.js';
import { ConfigManager, PRESETS } from '../core/templates.js';

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

    case 'preset': {
      const presetName = args[1];
      if (!presetName || !PRESETS[presetName]) {
        console.log('\nAvailable Acourd Presets:');
        for (const p of Object.values(PRESETS)) {
          console.log(`  • ${p.id.padEnd(10)} — ${p.description}`);
          console.log(`                 Details: "${p.detailsTemplate}" | State: "${p.stateTemplate}"`);
        }
        console.log('\nUsage: acourd preset <linear|studio|stealth|hacker|custom>');
        return;
      }

      try {
        const res = await client._post('/config', { preset: presetName });
        console.log(`✓ Preset switched to "${presetName}" (live on Discord).`);
        if (res.activity) printCard(res.activity);
      } catch (_) {
        const cm = new ConfigManager();
        cm.update({ preset: presetName });
        console.log(`✓ Preset saved to "${presetName}" (~/.acourd/config.json).`);
      }
      break;
    }

    case 'config': {
      const patch = {};
      let hasChanges = false;
      for (let i = 1; i < args.length; i += 1) {
        if (args[i] === '--preset' && args[i + 1]) { patch.preset = args[i + 1]; hasChanges = true; i += 1; }
        else if (args[i] === '--lang' && args[i + 1]) { patch.lang = args[i + 1]; hasChanges = true; i += 1; }
        else if (args[i] === '--details' && args[i + 1]) { patch.detailsTemplate = args[i + 1]; hasChanges = true; i += 1; }
        else if (args[i] === '--state' && args[i + 1]) { patch.stateTemplate = args[i + 1]; hasChanges = true; i += 1; }
        else if (args[i] === '--emojis' && args[i + 1]) { patch.showEmojis = args[i + 1] !== 'off' && args[i + 1] !== 'false'; hasChanges = true; i += 1; }
        else if (args[i] === '--elapsed' && args[i + 1]) { patch.showElapsed = args[i + 1] !== 'off' && args[i + 1] !== 'false'; hasChanges = true; i += 1; }
        else if (args[i] === '--stealth' && args[i + 1]) { patch.stealthMode = args[i + 1] === 'on' || args[i + 1] === 'true'; hasChanges = true; i += 1; }
        else if (args[i] === '--antigravity-id' && args[i + 1]) { patch.clientIds = { ...(patch.clientIds || {}), antigravity: args[i + 1] }; hasChanges = true; i += 1; }
        else if (args[i] === '--claude-id' && args[i + 1]) { patch.clientIds = { ...(patch.clientIds || {}), claude: args[i + 1] }; hasChanges = true; i += 1; }
        else if (args[i] === '--hermes-id' && args[i + 1]) { patch.clientIds = { ...(patch.clientIds || {}), hermes: args[i + 1] }; hasChanges = true; i += 1; }
        else if (args[i] === '--icon-style' && args[i + 1]) { patch.iconStyle = args[i + 1]; hasChanges = true; i += 1; }
        else if (args[i] === '--reset') { patch.reset = true; hasChanges = true; }
      }

      if (!hasChanges) {
        const cm = new ConfigManager();
        console.log('\nCurrent Acourd Configuration (~/.acourd/config.json):');
        console.log(JSON.stringify(cm.getEffective(), null, 2));
        console.log('\nVariables: {emoji} {task_or_state} {task} {state} {project} {branch} {agent} {tool}');
        return;
      }

      try {
        const res = await client._post('/config', patch);
        console.log('✓ Configuration updated & synced live with Discord:');
        console.log(JSON.stringify(res.config, null, 2));
        if (res.activity) printCard(res.activity);
      } catch (_) {
        const cm = new ConfigManager();
        const eff = cm.update(patch);
        console.log('✓ Configuration saved to ~/.acourd/config.json:');
        console.log(JSON.stringify(eff, null, 2));
      }
      break;
    }

    case 'hook': {
      const { runClaudeHook } = await import('../adapters/claude-code/hook.js');
      await runClaudeHook(args.slice(1));
      break;
    }

    case 'setup':
    case 'install': {
      const { runSetupWizard } = await import('../core/installer.js');
      await runSetupWizard(args.slice(1));
      break;
    }

    case 'uninstall': {
      const { runSetupWizard } = await import('../core/installer.js');
      await runSetupWizard(['--uninstall', ...args.slice(1)]);
      break;
    }

    default:
      console.log(`
Acourd RPC — Zero-Bloat Universal Discord Rich Presence
Usage: acourd <command> [options]

Commands:
  setup [options]    Detect installed harnesses, configure hooks, choose icon pack & start daemon
                     Options: --yes --icon-style <classic|light|titanium> --preset <id> --dry-run
  uninstall          Remove Vela RPC hooks cleanly without touching other tools
  status             Show daemon health, IPC status, and active card preview
  start              Launch daemon silently in background
  stop               Stop running background daemon
  daemon             Run daemon in foreground
  preset <name>      Switch visual copy preset (autonomous, linear, studio, stealth, hacker, custom)
  config [options]   View or customize dynamic presence templates and icon packs
                     Options: --icon-style <classic|light|titanium> --lang <es|en>
                              --details "<tpl>" --state "<tpl>" --emojis <on|off> --elapsed <on|off> --reset
  preview            Render visual high-fidelity presence cards for all states
  set [options]      Manually dispatch an activity event
                     Options: --state <state> --details <text> --project <name>
  clear              Clear presence from Discord
  hook [event]       Claude Code hook receiver
`);
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
