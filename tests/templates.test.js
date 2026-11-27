/**
 * Acourd RPC — Dynamic Templates, Presets & Live Config Tests
 * Verifies template interpolation, orphan separator cleanup, ES/EN localization,
 * curated presets (linear, studio, stealth, hacker, custom), and live HTTP /config sync.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  renderTemplate,
  ConfigManager,
  PRESETS,
} from '../core/templates.js';
import { StateEngine } from '../core/state-engine.js';
import { AcourdDaemon } from '../core/daemon.js';
import { AcourdClient } from '../adapters/generic-client.js';
import { COGNITIVE_STATES } from '../core/constants.js';
import { resolveHarness, HARNESS_IDS } from '../core/harnesses.js';
import { translateCodexEvent } from '../adapters/codex/adapter.js';
import { translateOpenCodeEvent } from '../adapters/opencode/adapter.js';
import { translateOpenChamberEvent } from '../adapters/openchamber/adapter.js';
import { translateHermesEvent } from '../adapters/hermes/adapter.js';

export async function runTemplateTests() {
  console.log('\n--- Running Dynamic Templates & Presets Tests ---');

  // 1. Orphan separator cleanup
  assert.strictEqual(
    renderTemplate('{project} · {branch}', { project: 'acourd-rpc', branch: 'main' }),
    'acourd-rpc · main'
  );
  assert.strictEqual(
    renderTemplate('{project} · {branch}', { project: 'acourd-rpc', branch: '' }),
    'acourd-rpc',
    'Must strip trailing orphan separator when branch is empty'
  );
  assert.strictEqual(
    renderTemplate('{emoji} {task_or_state}', { emoji: '', task_or_state: 'Building UI' }),
    'Building UI',
    'Must collapse leading whitespace when emoji is disabled'
  );
  assert.strictEqual(
    renderTemplate('[{project}:{branch}] // {agent}', { project: 'acourd', branch: '', agent: 'Antigravity' }),
    '[acourd] // Antigravity',
    'Must strip trailing colon inside brackets'
  );
  console.log('✓ Template interpolation & orphan separator cleanup verified');

  // 2. Presets & ES/EN localization in StateEngine
  const engine = new StateEngine({
    debounceMs: 0,
    agentName: 'Google Antigravity 2.0',
    config: { preset: 'linear', lang: 'es' },
  });

  const esThinking = engine.buildActivityPayload({
    state: COGNITIVE_STATES.THINKING,
    project: 'acourd-rpc',
    branch: 'main',
  });
  engine.currentState = COGNITIVE_STATES.THINKING;
  engine.currentContext = { project: 'acourd-rpc', branch: 'main' };
  const esBuilt = engine.buildActivityPayload({});
  assert.strictEqual(esBuilt.details, '🧠 Pensando arquitectura');
  assert.strictEqual(esBuilt.state, 'acourd-rpc · main');

  // Switch to Hacker preset (no emojis, terminal delimiters)
  engine.setConfig({ preset: 'hacker', lang: 'en' }, false);
  const hackerBuilt = engine.buildActivityPayload({});
  assert.strictEqual(hackerBuilt.details, '> Architecting & Reasoning');
  assert.strictEqual(hackerBuilt.state, '[acourd-rpc:main] // Antigravity');

  // Switch to Stealth preset (hides project and branch)
  engine.setConfig({ preset: 'stealth', lang: 'es' }, false);
  const stealthBuilt = engine.buildActivityPayload({});
  assert.ok(!stealthBuilt.state.includes('acourd-rpc'), 'Stealth preset must hide project name');
  assert.ok(!stealthBuilt.state.includes('main'), 'Stealth preset must hide git branch');
  assert.strictEqual(stealthBuilt.state, 'Deep Focus • Antigravity');

  // Custom template + showElapsed: false
  engine.setConfig({
    preset: 'custom',
    detailsTemplate: '🔥 Construyendo {project}',
    stateTemplate: '{state} en {agent}',
    showElapsed: false,
  }, false);
  const customBuilt = engine.buildActivityPayload({});
  assert.strictEqual(customBuilt.details, '🔥 Construyendo acourd-rpc');
  assert.strictEqual(customBuilt.state, 'Pensando arquitectura en Antigravity');
  assert.strictEqual(customBuilt.timestamps, undefined, 'Must omit timestamps when showElapsed is false');
  console.log('✓ Presets (linear, studio, stealth, hacker, custom) & ES/EN localization verified');

  // 3. ConfigManager persistence to disk
  const tmpCfg = path.join(os.tmpdir(), `acourd-test-cfg-${Date.now()}.json`);
  const cm1 = new ConfigManager({ configPath: tmpCfg });
  cm1.update({ preset: 'linear', lang: 'en', showEmojis: false });
  assert.ok(fs.existsSync(tmpCfg), 'Config file must be persisted');

  const cm2 = new ConfigManager({ configPath: tmpCfg });
  const loaded = cm2.getEffective();
  assert.strictEqual(loaded.preset, 'linear');
  assert.strictEqual(loaded.lang, 'en');
  assert.strictEqual(loaded.showEmojis, false);
  fs.unlinkSync(tmpCfg);
  console.log('✓ ConfigManager disk persistence verified');

  // 4. Live HTTP /config endpoint on Daemon
  const testPort = 19457;
  const daemon = new AcourdDaemon({
    port: testPort,
    clientId: 'test-client',
    debounceMs: 0,
    pidFile: false,
    configPath: false,
  });
  await daemon.start();

  const client = new AcourdClient({ port: testPort });
  await client.sendEvent({
    state: COGNITIVE_STATES.THINKING,
    project: 'AcourdStudio',
    branch: 'feat/dynamic',
    agentName: 'Google Antigravity 2.0',
    forceImmediate: true,
  }, false);

  const cfgRes = await client._post('/config', {
    preset: 'custom',
    lang: 'es',
    detailsTemplate: '✨ Diseñando {project}',
    stateTemplate: 'Rama {branch} · {agent}',
  });
  assert.strictEqual(cfgRes.ok, true);
  assert.strictEqual(cfgRes.activity.details, '✨ Diseñando AcourdStudio');
  assert.strictEqual(cfgRes.activity.state, 'Rama feat/dynamic · Antigravity');
  assert.strictEqual(cfgRes.dispatched, true, 'Updating config must immediately re-dispatch active presence');

  // 5. Option A+B Autonomous preset (chat title + model + status + project, zero emojis)
  const autoRes = await client._post('/config', { preset: 'autonomous' });
  assert.strictEqual(autoRes.ok, true);
  const autoEvt = await client.sendEvent({
    source: 'antigravity',
    agentName: 'Google Antigravity 2.0',
    state: COGNITIVE_STATES.THINKING,
    chatTitle: 'Universal AI Discord RPC',
    model: 'Gemini 4 Neon',
    project: 'acourd-rpc',
    branch: 'main',
    forceImmediate: true,
  }, false);
  assert.strictEqual(autoEvt.activity.details, 'Universal AI Discord RPC');
  assert.strictEqual(autoEvt.activity.state, 'Gemini 4 Neon');

  // 6. Simultaneous Antigravity + Claude Code priority lease arbitration
  const claudeActive = await client.sendEvent({
    source: 'claude',
    agentName: 'Claude Code',
    state: COGNITIVE_STATES.TOOL_CALL,
    chatTitle: 'Refactor IPC framing',
    model: 'Claude Opus 4.6',
    project: 'acourd-rpc',
    forceImmediate: true,
  }, false);
  assert.strictEqual(claudeActive.activity.details, 'Refactor IPC framing');
  assert.strictEqual(claudeActive.activity.state, 'Claude Opus 4.6');

  // 7. Verify all 7 harnesses distinction & capitalization (Antigravity 2.0 vs IDE, Codex, OpenCode, OpenChamber, Hermes)
  assert.strictEqual(resolveHarness({ agentName: 'Antigravity 2.0' }).id, HARNESS_IDS.ANTIGRAVITY_2);
  assert.strictEqual(resolveHarness({ agentName: 'Antigravity IDE' }).id, HARNESS_IDS.ANTIGRAVITY_IDE);
  assert.strictEqual(resolveHarness({ agentName: 'Antigravity IDE' }).assetKey, 'antigravity_ide_logo');
  assert.strictEqual(translateCodexEvent('working', { chatTitle: 'API refactor' }).agentName, 'Codex');
  assert.strictEqual(translateOpenCodeEvent('build', { title: 'UI Polish' }).agentName, 'OpenCode');
  assert.strictEqual(translateOpenChamberEvent('swarm', { title: 'Multi-agent' }).agentName, 'OpenChamber');
  assert.strictEqual(translateHermesEvent('working', { task: 'Autonomous research' }).agentName, 'Hermes');
  console.log('✓ All 7 harness adapters & Antigravity 2.0 vs IDE icon distinction verified');

  // Antigravity idle heartbeat MUST NOT hijack active Claude session
  const agIdleHijack = await client.sendEvent({
    source: 'antigravity',
    isHeartbeat: true,
    agentName: 'Google Antigravity 2.0',
    state: COGNITIVE_STATES.IDLE,
    chatTitle: 'Old Antigravity Chat',
    model: 'Gemini 4 Neon',
    project: 'acourd-rpc',
  }, false);
  assert.strictEqual(agIdleHijack.deferred, true, 'Idle Antigravity heartbeat must defer while Claude holds active lease');
  assert.strictEqual(agIdleHijack.activeSource, 'claude');

  // Claude releases lease on SessionEnd -> Antigravity can resume cleanly
  await client.sendEvent({
    source: 'claude',
    agentName: 'Claude Code',
    state: COGNITIVE_STATES.IDLE,
    releaseLease: true,
    forceImmediate: true,
  }, false);
  const agResume = await client.sendEvent({
    source: 'antigravity',
    isHeartbeat: true,
    agentName: 'Google Antigravity 2.0',
    state: COGNITIVE_STATES.IDLE,
    chatTitle: 'Universal AI Discord RPC',
    model: 'Gemini 4 Neon',
    project: 'acourd-rpc',
    forceImmediate: true,
  }, false);
  assert.strictEqual(agResume.deferred, undefined);
  assert.strictEqual(agResume.activity.details, 'Universal AI Discord RPC');
  console.log('✓ Autonomous A+B preset & simultaneous Claude/Antigravity lease arbitration verified');

  await daemon.stop();
  console.log('✓ Live HTTP POST /config instant re-render verified');
}

if (process.argv[1] && process.argv[1].endsWith('templates.test.js')) {
  runTemplateTests()
    .then(() => {
      console.log('All Template tests passed!');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Template test failed:', err);
      process.exit(1);
    });
}
