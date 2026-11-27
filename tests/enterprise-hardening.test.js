/**
 * Vela RPC — Enterprise Hardening & Regression Test Suite
 * Verifies:
 * 1. All-field privacy redaction (Bearer, JWT, API keys, URL creds) + UTF-8 128-byte boundaries
 * 2. Null/malformed input safety in resolveHarness()
 * 3. Session-keyed multi-session arbitration (idle never displaces active; close promotes or clears)
 * 4. Dynamic model detection from live config/session files with zero static fabrication
 * 5. Binary PNG magic-byte integrity across assets/ and assets/styles/
 */

import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StateEngine, sanitizePrivacy, truncateUtf8 } from '../core/state-engine.js';
import { resolveHarness, HARNESSES } from '../core/harnesses.js';
import { detectDynamicModel } from '../core/model-detector.js';
import { translateClaudeEvent } from '../adapters/claude-code/hook.js';
import { translateCodexEvent } from '../adapters/codex/adapter.js';
import { readHermesTelemetry } from '../adapters/hermes/adapter.js';
import { readSelectedModel, formatModelName } from '../core/antigravity-telemetry.js';
import { readClaudeSessionModel } from '../adapters/claude-code/hook.js';
import { AcourdDaemon } from '../core/daemon.js';
import { AcourdClient } from '../adapters/generic-client.js';
import { MockDiscordServer } from './mock-discord-ipc.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

export async function runEnterpriseHardeningTests() {
  console.log('\n--- Running Enterprise Hardening & Regression Tests ---');

  // 1. All-field privacy redaction (Bearer, JWT, API keys, URL creds)
  const fakeBearer = 'Bearer tok_live_9876543210abcdef';
  const fakeJwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
  const engine = new StateEngine({ debounceMs: 10 });
  const act = engine.buildActivityPayload({
    state: 'thinking',
    chatTitle: `Fix auth ${fakeBearer}`,
    model: `Model ${fakeJwt}`,
    largeText: `Header ${fakeBearer}`,
    buttons: [
      { label: `Open ${fakeBearer}`, url: 'https://github.com/Acourd/vela-rpc' },
      { label: 'Leaked Creds URL', url: 'https://user:pass@example.com/secret' },
      { label: 'Multi-Colon Creds URL', url: 'https://user:pass:extra@host.tld/x' },
    ],
  });

  // Quoted JSON secrets (including spaces and short values) and short Bearer tokens must be redacted
  const jsonSanitized = sanitizePrivacy('Payload {"api_key": "top_secret_json_999", "token":"abc_secret_777", "password":"prefix space_tail_7", "password":"xy"} Authorization: Bearer abc');
  assert.ok(!jsonSanitized.includes('top_secret_json_999'), 'Quoted JSON api_key must be redacted');
  assert.ok(!jsonSanitized.includes('abc_secret_777'), 'Quoted JSON token must be redacted');
  assert.ok(!jsonSanitized.includes('space_tail_7'), 'Quoted JSON value with spaces must be fully redacted');
  assert.ok(!jsonSanitized.includes('"xy"'), 'Short quoted JSON secret must be redacted');
  // Short-payload JWT (e30) & Unicode-escaped JSON keys ("pass\u0077ord") must be redacted
  const shortJwtAndEscaped = sanitizePrivacy('JWT eyJhbGciOiJIUzI1NiJ9.e30.abc123def456 {"pass\\u0077ord":"prefix space_tail_7"}');
  assert.ok(!shortJwtAndEscaped.includes('e30.abc123def456'), 'Short-payload JWT must be redacted');
  assert.ok(!shortJwtAndEscaped.includes('space_tail_7'), 'Unicode-escaped JSON password key must be redacted');

  const serialized = JSON.stringify(act);
  assert.ok(!serialized.includes('tok_live_9876543210abcdef'), 'Bearer token must never reach Discord');
  assert.ok(!serialized.includes('SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'), 'JWT must never reach Discord');
  assert.ok(!serialized.includes('user:pass@'), 'URL credentials must never reach Discord');
  assert.strictEqual(act.buttons.length, 1, 'Button URL with credentials must be stripped');

  // UTF-8 4-byte emoji truncation at 127-129 boundary without U+FFFD
  const trunc = truncateUtf8('a'.repeat(126) + '🔥🚀', 128);
  assert.ok(Buffer.byteLength(trunc, 'utf8') <= 128);
  assert.ok(!trunc.includes('\uFFFD'), 'Truncation must never emit U+FFFD');
  console.log('✓ All-field privacy redaction (Bearer/JWT/URL creds) & UTF-8 boundary verified');

  // 2. Null/malformed input safety in resolveHarness()
  assert.strictEqual(resolveHarness(null).id, 'antigravity-2');
  assert.strictEqual(resolveHarness(undefined).id, 'antigravity-2');
  assert.strictEqual(resolveHarness(42).id, 'antigravity-2');
  assert.strictEqual(resolveHarness('').id, 'antigravity-2');
  assert.strictEqual(Object.keys(HARNESSES).length, 14);
  console.log('✓ Null-safe resolveHarness() & 14-harness registry verified');

  // 3. Dynamic model detection (session-correlated JSONL, profile-aware TOML, zero static fabrication)
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-model-test-'));
  try {
    fs.mkdirSync(path.join(tmpHome, '.codex', 'sessions'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpHome, '.codex', 'config.toml'),
      'profile = "work"\n\n[profiles."legacy"]\nmodel = "old-legacy-model"\n\n[profiles."work"]\nmodel = "gpt-5.4-codex"\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(tmpHome, '.codex', 'sessions', 'session-123-other.jsonl'),
      '{"session_id":"session-123-other","model":"o4-mini"}\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(tmpHome, '.codex', 'sessions', 'mixed.jsonl'),
      '{"session_id":"session-123","model":"gpt-5"}\n{"session_id":"session-456","model":"wrong-other-model"}\n',
      'utf8'
    );

    fs.mkdirSync(path.join(tmpHome, '.config', 'opencode'), { recursive: true });
    fs.writeFileSync(path.join(tmpHome, '.config', 'opencode', 'opencode.json'), JSON.stringify({ model: 'claude-sonnet-4-6' }), 'utf8');

    fs.mkdirSync(path.join(tmpHome, '.vibe'), { recursive: true });
    fs.writeFileSync(path.join(tmpHome, '.vibe', 'config.toml'), '[profiles.inactive]\nactive_model = "wrong-model"\n', 'utf8');

    // Exact session correlation: session-123 gets GPT 5 from mixed.jsonl (never wrong-other-model, never session-123-other.jsonl)
    assert.strictEqual(detectDynamicModel('codex', { sessionId: 'session-123' }, { homeDir: tmpHome, env: {} }), 'GPT 5');
    // Unknown session falls back to quoted active profile [profiles."work"] (never [profiles."legacy"])
    assert.strictEqual(detectDynamicModel('codex', { sessionId: 'sess-unknown' }, { homeDir: tmpHome, env: {} }), 'GPT 5.4 Codex');
    assert.strictEqual(detectDynamicModel('opencode', {}, { homeDir: tmpHome, env: {} }), 'Claude Sonnet 4.6');
    // Inactive TOML profile with bracket inside quotes [profiles."inactive]name"] MUST NOT leak as root
    fs.writeFileSync(path.join(tmpHome, '.vibe', 'config.toml'), '[profiles."inactive]name"]\nactive_model = "wrong-bracket-model"\n', 'utf8');
    assert.strictEqual(detectDynamicModel('mistral-vibe', {}, { homeDir: tmpHome, env: {} }), null);
    // Antigravity MODEL_PLACEHOLDER_UNKNOWN must return null (never 'Gemini AI')
    assert.strictEqual(formatModelName('MODEL_PLACEHOLDER_UNKNOWN'), null);
    // Claude broken JSONL / foreign session must return null
    const brokenTranscript = path.join(tmpHome, 'broken.jsonl');
    fs.writeFileSync(brokenTranscript, '{"model":"broken-line"\n{"session_id":"other-sess","model":"claude-opus-5-5"}\n', 'utf8');
    assert.strictEqual(readClaudeSessionModel({ session_id: 'target-sess', transcript_path: brokenTranscript }), null);
    // Adapter explicit null model preserved (not undefined) when unconfigured
    assert.strictEqual(translateCodexEvent('working', { session_id: 'cx-null' }, tmpHome, { homeDir: path.join(tmpHome, 'empty'), env: {} }).model, null);
    // Zero static fabrication across ALL harnesses (including Claude & Antigravity):
    assert.strictEqual(detectDynamicModel('deepseek', {}, { homeDir: tmpHome, env: {} }), null);
    assert.strictEqual(detectDynamicModel('kimi-code', {}, { homeDir: tmpHome, env: {} }), null);
    assert.strictEqual(readSelectedModel(path.join(tmpHome, 'missing_state.pbtxt')), null);
    const claudeNoModel = translateClaudeEvent('UserPromptSubmit', { session_id: 'no-model-sess' }, tmpHome);
    if (!process.env.ANTHROPIC_MODEL) {
      assert.strictEqual(claudeNoModel.model, null, 'Claude adapter must not fabricate static Claude model');
    }
    // Hermes readHermesTelemetry returns null model when unconfigured (no static 'Hermes 4')
    const hermesEmpty = await readHermesTelemetry({ hermesDir: path.join(tmpHome, '.hermes-empty') });
    assert.strictEqual(hermesEmpty.model, null, 'readHermesTelemetry must not fabricate Hermes 4');
    // Adapter preserves sessionId
    assert.strictEqual(translateCodexEvent('working', { session_id: 'cx-1' }).sessionId, 'cx-1');
    // Switching harness OR transitioning anonymous -> identified session clears stale model & title
    const switchEngine = new StateEngine({ debounceMs: 10, config: { preset: 'autonomous' } });
    switchEngine.processEvent({ harness: 'codex', state: 'thinking', chatTitle: 'Anon Chat', model: 'GPT 5', forceImmediate: true });
    const anonToId = switchEngine.processEvent({ harness: 'codex', sessionId: 'codex-1', state: 'thinking', forceImmediate: true });
    assert.ok(!JSON.stringify(anonToId.activity).includes('GPT 5'), 'Anonymous model must not bleed into newly identified session');
    assert.ok(!JSON.stringify(anonToId.activity).includes('Anon Chat'), 'Anonymous title must not bleed into newly identified session');
    const sw = switchEngine.processEvent({ harness: 'deepseek', state: 'thinking', chatTitle: 'T2', forceImmediate: true });
    assert.ok(!JSON.stringify(sw.activity).includes('GPT 5'), 'Previous harness model must not bleed into new harness');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
  console.log('✓ Dynamic model detection (session-correlated JSONL, profile-aware TOML, no cross-harness bleed) verified');

  // 4. Session-keyed multi-session arbitration (idle never displaces active; close promotes or clears)
  const mockServer = new MockDiscordServer();
  const pipePath = await mockServer.start();
  const daemon = new AcourdDaemon({
    port: 19459,
    customIpcPath: pipePath,
    debounceMs: 10,
    pidFile: false,
  });
  await daemon.start();
  for (let i = 0; i < 30 && (!daemon.ipc || !daemon.ipc.ready); i += 1) {
    await new Promise((r) => setTimeout(r, 40));
  }
  const client = new AcourdClient({ port: 19459 });

  // Session 1 active via real translateClaudeEvent (with session_id)
  const claudeS1 = translateClaudeEvent('UserPromptSubmit', {
    session_id: 's1',
    session_name: 'Active Mission S1',
    model: 'claude-opus-5-5',
  }, ROOT_DIR);
  await client.sendEvent(claudeS1, false);

  // Session 2 idle via real translateClaudeEvent MUST NOT displace Session 1
  const claudeS2Idle = translateClaudeEvent('Stop', {
    session_id: 's2',
    session_name: 'Idle Background S2',
    model: 'claude-sonnet-4-6',
  }, ROOT_DIR);
  const idleRes = await client.sendEvent(claudeS2Idle, false);
  assert.strictEqual(idleRes.deferred, true, 'Idle Claude session s2 must not displace active Claude session s1');

  // Closing non-owner session s2 via SessionEnd MUST NOT clear Session 1
  const claudeS2End = translateClaudeEvent('SessionEnd', {
    session_id: 's2',
    session_name: 'Idle Background S2',
  }, ROOT_DIR);
  const closeS2 = await client.sendEvent(claudeS2End, false);
  assert.strictEqual(closeS2.keptActiveSession, 'claude-code:s1');

  // Closing last active session s1 via SessionEnd MUST clear Discord presence (null)
  const claudeS1End = translateClaudeEvent('SessionEnd', {
    session_id: 's1',
    session_name: 'Active Mission S1',
  }, ROOT_DIR);
  const closeS1 = await client.sendEvent(claudeS1End, false);
  assert.strictEqual(closeS1.cleared, true);
  await new Promise((r) => setTimeout(r, 80));
  assert.strictEqual(mockServer.receivedActivities[mockServer.receivedActivities.length - 1], null);

  await daemon.stop();
  await mockServer.close();
  console.log('✓ Session-keyed multi-session arbitration & clean teardown verified');

  // 5. Binary PNG magic-byte integrity across assets/ and assets/styles/
  const checkPngDir = (dirPath, require512) => {
    const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.png'));
    assert.ok(files.length > 0);
    for (const f of files) {
      const buf = fs.readFileSync(path.join(dirPath, f));
      assert.strictEqual(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `Not a valid PNG: ${f}`);
      if (require512) {
        assert.strictEqual(buf.readUInt32BE(16), 512, `${f} width != 512`);
        assert.strictEqual(buf.readUInt32BE(20), 512, `${f} height != 512`);
      }
    }
    return files.length;
  };
  const rawCount = checkPngDir(path.join(ROOT_DIR, 'assets'), false);
  const styleCount = checkPngDir(path.join(ROOT_DIR, 'assets', 'styles'), true);
  console.log(`✓ Binary PNG magic-byte integrity verified (${rawCount} raw + ${styleCount} 512x512 style PNGs)`);
}

if (process.argv[1] && process.argv[1].endsWith('enterprise-hardening.test.js')) {
  runEnterpriseHardeningTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Enterprise Hardening test failed:', err);
      process.exit(1);
    });
}
