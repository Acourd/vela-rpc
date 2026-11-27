/**
 * Vela RPC — Idempotent Harness Auto-Detector & Setup Installer
 * Supports both interactive human terminals and zero-hang AI-agent execution (`--yes` / non-TTY).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { HARNESS_IDS, HARNESSES } from './harnesses.js';
import { ConfigManager } from './templates.js';
import { AcourdDaemon } from './daemon.js';
import { generateClaudeHookConfig } from '../adapters/claude-code/config-helper.js';
import { generateHermesHookManifest } from '../adapters/hermes/adapter.js';

const ICON_STYLE_ALIASES = {
  classic: 'classic',
  dark: 'classic',
  official: 'classic',
  'official-dark': 'classic',
  light: 'light',
  porcelain: 'light',
  'porcelain-light': 'light',
  titanium: 'titanium',
  oled: 'titanium',
  'titanium-oled': 'titanium',
};

export function normalizeIconStyle(raw) {
  if (!raw) return null;
  const key = String(raw).trim().toLowerCase();
  return ICON_STYLE_ALIASES[key] || null;
}

export function parseSetupArgs(args = []) {
  const opts = {
    yes: false,
    dryRun: false,
    noStart: false,
    uninstall: false,
    iconStyle: null,
    iconStyleProvided: false,
    preset: 'autonomous',
    lang: null,
  };

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--yes' || a === '-y') opts.yes = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--no-start') opts.noStart = true;
    else if (a === '--uninstall') opts.uninstall = true;
    else if ((a === '--icon-style' || a === '--style' || a === '--theme') && args[i + 1]) {
      const norm = normalizeIconStyle(args[i + 1]);
      if (norm) {
        opts.iconStyle = norm;
        opts.iconStyleProvided = true;
      }
      i += 1;
    } else if (a === '--preset' && args[i + 1]) {
      opts.preset = args[i + 1];
      i += 1;
    } else if (a === '--lang' && args[i + 1]) {
      if (args[i + 1] === 'en' || args[i + 1] === 'es') opts.lang = args[i + 1];
      i += 1;
    }
  }

  return opts;
}

/**
 * Detects AI coding harnesses present on the user's machine cleanly (read-only checks).
 */
export function detectInstalledHarnesses(homeDir = os.homedir()) {
  const checks = [
    { id: HARNESS_IDS.ANTIGRAVITY_2, paths: [path.join(homeDir, '.gemini', 'antigravity')] },
    { id: HARNESS_IDS.ANTIGRAVITY_IDE, paths: [path.join(homeDir, '.antigravity'), path.join(homeDir, '.gemini', 'antigravity')] },
    { id: HARNESS_IDS.CLAUDE_CODE, paths: [path.join(homeDir, '.claude')] },
    { id: HARNESS_IDS.CODEX, paths: [path.join(homeDir, '.codex')] },
    { id: HARNESS_IDS.OPENCODE, paths: [path.join(homeDir, '.config', 'opencode'), path.join(homeDir, '.opencode')] },
    { id: HARNESS_IDS.OPENCHAMBER, paths: [path.join(homeDir, '.openchamber')] },
    { id: HARNESS_IDS.HERMES, paths: [path.join(homeDir, '.hermes')] },
    { id: HARNESS_IDS.KIMI_CODE, paths: [path.join(homeDir, '.kimi')] },
    { id: HARNESS_IDS.DEEPSEEK, paths: [path.join(homeDir, '.deepseek'), path.join(homeDir, '.config', 'deepseek')] },
    { id: HARNESS_IDS.KIRO, paths: [path.join(homeDir, '.kiro')] },
    { id: HARNESS_IDS.MISTRAL_VIBE, paths: [path.join(homeDir, '.vibe')] },
    { id: HARNESS_IDS.FACTORY_DROID, paths: [path.join(homeDir, '.factory')] },
    { id: HARNESS_IDS.AMP, paths: [path.join(homeDir, '.config', 'amp')] },
  ];

  const found = [];
  for (const entry of checks) {
    if (entry.paths.some((p) => fs.existsSync(p))) {
      found.push(HARNESSES[entry.id]);
    }
  }
  return found;
}

function isVelaCommand(cmd) {
  const norm = String(cmd || '').replace(/\\/g, '/').toLowerCase();
  return (
    norm.includes('adapters/claude-code/hook.js') ||
    norm.includes('bin/acourd.js') ||
    norm.includes('vela-rpc') ||
    norm.includes('acourd-rpc')
  );
}

function isVelaHookGroup(group) {
  if (!group || typeof group !== 'object') return false;
  if (isVelaCommand(group.command)) return true;
  if (Array.isArray(group.hooks)) {
    return group.hooks.some((h) => h && isVelaCommand(h.command));
  }
  return false;
}

/**
 * Safely merges Vela RPC hooks into ~/.claude/settings.json without overwriting user hooks.
 * Fails closed if existing settings.json contains invalid JSON.
 */
export function installClaudeHooks(homeDir = os.homedir(), dryRun = false) {
  const claudeDir = path.join(homeDir, '.claude');
  const settingsPath = path.join(claudeDir, 'settings.json');
  if (!fs.existsSync(claudeDir)) {
    return { installed: false, skipped: 'claude_dir_missing', path: settingsPath };
  }

  let current = {};
  if (fs.existsSync(settingsPath)) {
    const raw = fs.readFileSync(settingsPath, 'utf8').trim();
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return { installed: false, error: 'Existing ~/.claude/settings.json is not a JSON object', path: settingsPath };
        }
        current = parsed;
      } catch (err) {
        return { installed: false, error: `Invalid JSON in ~/.claude/settings.json (${err.message})`, path: settingsPath };
      }
    }
  }

  const generated = generateClaudeHookConfig();
  const nextHooks = (current.hooks && typeof current.hooks === 'object' && !Array.isArray(current.hooks))
    ? { ...current.hooks }
    : {};

  for (const [eventName, newGroups] of Object.entries(generated.hooks)) {
    const existingList = Array.isArray(nextHooks[eventName]) ? nextHooks[eventName] : [];
    const preserved = existingList.filter((grp) => !isVelaHookGroup(grp));
    nextHooks[eventName] = [...preserved, ...newGroups];
  }

  const updated = { ...current, hooks: nextHooks };
  if (!dryRun) {
    fs.writeFileSync(settingsPath, JSON.stringify(updated, null, 2) + '\n', 'utf8');
  }

  return { installed: true, path: settingsPath, events: Object.keys(generated.hooks) };
}

/**
 * Installs drop-in Hermes Gateway Hook manifest (~/.hermes/hooks/vela-rpc/HOOK.yaml) if ~/.hermes exists.
 */
export function installHermesHook(homeDir = os.homedir(), dryRun = false) {
  const hermesDir = path.join(homeDir, '.hermes');
  const hookDir = path.join(hermesDir, 'hooks', 'vela-rpc');
  const hookFile = path.join(hookDir, 'HOOK.yaml');
  if (!fs.existsSync(hermesDir)) {
    return { installed: false, skipped: 'hermes_dir_missing', path: hookFile };
  }

  const manifest = generateHermesHookManifest();
  const yaml = [
    `name: ${manifest.name}`,
    `version: "${manifest.version}"`,
    `description: "${manifest.description}"`,
    `endpoint: "${manifest.endpoint}"`,
    'events:',
    ...manifest.events.map((ev) => `  - ${ev}`),
    '',
  ].join('\n');

  if (!dryRun) {
    fs.mkdirSync(hookDir, { recursive: true });
    fs.writeFileSync(hookFile, yaml, 'utf8');
  }
  return { installed: true, path: hookFile };
}

/**
 * Cleanly removes Vela RPC hooks without disturbing unrelated user configuration.
 */
export function uninstallHooks(homeDir = os.homedir(), dryRun = false) {
  const removed = [];
  const settingsPath = path.join(homeDir, '.claude', 'settings.json');
  if (fs.existsSync(settingsPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      if (parsed && typeof parsed === 'object' && parsed.hooks && typeof parsed.hooks === 'object') {
        let changed = false;
        const nextHooks = {};
        for (const [ev, list] of Object.entries(parsed.hooks)) {
          if (!Array.isArray(list)) {
            nextHooks[ev] = list;
            continue;
          }
          const kept = list.filter((grp) => !isVelaHookGroup(grp));
          if (kept.length !== list.length) changed = true;
          if (kept.length > 0) nextHooks[ev] = kept;
        }
        if (changed) {
          if (Object.keys(nextHooks).length > 0) parsed.hooks = nextHooks;
          else delete parsed.hooks;
          if (!dryRun) {
            fs.writeFileSync(settingsPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
          }
          removed.push(settingsPath);
        }
      }
    } catch (_) {}
  }

  for (const legacyName of ['vela-rpc', 'acourd-rpc']) {
    const hFile = path.join(homeDir, '.hermes', 'hooks', legacyName, 'HOOK.yaml');
    if (fs.existsSync(hFile)) {
      if (!dryRun) {
        fs.rmSync(path.dirname(hFile), { recursive: true, force: true });
      }
      removed.push(hFile);
    }
  }

  return { removed };
}

function askQuestion(rl, promptText) {
  return new Promise((resolve) => {
    rl.question(promptText, (answer) => resolve(answer.trim()));
  });
}

async function promptIconStyleInteractive() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log('\nChoose your Discord icon pack:');
    console.log('  1) Official Dark    (classic — native brand colors on slate)');
    console.log('  2) Porcelain Light  (light   — soft daylight card & crisp contrast)');
    console.log('  3) Titanium OLED    (titanium — brushed monochrome silver on pure black)');
    const answer = await askQuestion(rl, '\nSelect [1-3] (Enter for Official Dark): ');
    if (answer === '2' || answer.toLowerCase() === 'light') return 'light';
    if (answer === '3' || answer.toLowerCase() === 'titanium') return 'titanium';
    return 'classic';
  } finally {
    rl.close();
  }
}

export async function runSetupWizard(rawArgs = [], options = {}) {
  const opts = parseSetupArgs(rawArgs);
  const homeDir = options.homeDir || os.homedir();
  const isTty = Boolean(process.stdin.isTTY && process.stdout.isTTY);

  if (opts.uninstall) {
    const res = uninstallHooks(homeDir, opts.dryRun);
    console.log(opts.dryRun ? '[dry-run] Uninstall preview:' : '✓ Vela RPC hooks removed cleanly.');
    if (res.removed.length > 0) {
      for (const p of res.removed) console.log(`  - ${p}`);
    } else {
      console.log('  (no installed hooks found)');
    }
    return { action: 'uninstall', ...res };
  }

  let iconStyle = opts.iconStyle || 'classic';
  if (!opts.iconStyleProvided && !opts.yes && isTty && options.allowPrompt !== false) {
    iconStyle = await promptIconStyleInteractive();
  }

  const detected = detectInstalledHarnesses(homeDir);
  const configPath = path.join(homeDir, '.acourd', 'config.json');
  const cm = new ConfigManager({ configPath });
  const configPatch = {
    preset: opts.preset || 'autonomous',
    iconStyle,
    ...(opts.lang ? { lang: opts.lang } : {}),
  };

  const effectiveConfig = opts.dryRun ? configPatch : cm.update(configPatch);
  const claudeResult = installClaudeHooks(homeDir, opts.dryRun);
  const hermesResult = installHermesHook(homeDir, opts.dryRun);

  let daemonResult = null;
  if (!opts.noStart && !opts.dryRun) {
    daemonResult = await AcourdDaemon.ensureRunning();
  }

  console.log('\n========================================================');
  console.log('  Vela RPC — Setup Complete');
  console.log('========================================================');
  console.log(`Icon style:         ${iconStyle}`);
  console.log(`Preset:             ${effectiveConfig.preset || 'autonomous'}`);
  console.log(`Detected harnesses: ${detected.length > 0 ? detected.map((h) => h.displayName).join(', ') : 'none auto-detected yet'}`);
  if (claudeResult.installed) {
    console.log(`Claude Code hooks:  ✓ wired into ${claudeResult.path}`);
  } else if (claudeResult.error) {
    console.log(`Claude Code hooks:  ⚠ skipped (${claudeResult.error})`);
  }
  if (hermesResult.installed) {
    console.log(`Hermes hook:        ✓ written to ${hermesResult.path}`);
  }
  if (daemonResult) {
    console.log(`Background daemon:  ✓ ${daemonResult.spawned ? 'started' : 'already running'} on 127.0.0.1:19452`);
  }
  console.log('\nSwitch icon styles anytime without restarting:');
  console.log('  node bin/acourd.js config --icon-style <classic|light|titanium>');
  console.log('Check live Discord status:');
  console.log('  node bin/acourd.js status\n');

  return {
    action: 'install',
    iconStyle,
    detected: detected.map((h) => h.id),
    claudeResult,
    hermesResult,
    daemonResult,
  };
}
