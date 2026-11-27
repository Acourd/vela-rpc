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
  // Short-payload JWT (e30), whitespace-header JWT, backslash Unicode escape, and tab URL creds
  const wsJwtHeader = Buffer.from('{ "alg": "HS256", "typ": "JWT" }').toString('base64url');
  const wsJwt = `${wsJwtHeader}.e30.sig_ws_123456`;
  const shortJwtAndEscaped = sanitizePrivacy(
    `JWT eyJhbGciOiJIUzI1NiJ9.e30.abc123def456 ${wsJwt} {"pass\\u0077ord":"BACKSLASH_CANARY\\u005c"} https://user\t:tabpass@host.tld/x`
  );
  assert.ok(!shortJwtAndEscaped.includes('e30.abc123def456'), 'Short-payload JWT must be redacted');
  assert.ok(!shortJwtAndEscaped.includes('sig_ws_123456'), 'Whitespace-header JWT must be redacted');
  assert.ok(!shortJwtAndEscaped.includes('BACKSLASH_CANARY'), 'Unicode backslash escape in JSON password must be redacted');
  // alg=none unsigned JWT, 5-segment JWE, JWT followed by trailing dot `.`, and double-serialized JSON
  const noneJwt = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from('{"sub":"canary_none"}').toString('base64url')}.`;
  const jweHeader = Buffer.from('{"alg":"dir","enc":"A256GCM"}').toString('base64url');
  const jweToken = `${jweHeader}..iv123456.ciphertext_canary.tag123456`;
  const signedJwtWithPeriod = `eyJhbGciOiJIUzI1NiJ9.e30.sig_period_999.`;
  const doubleSerializedJson = JSON.stringify({ outer: JSON.stringify({ password: 'nested_canary_777' }) });
  const rootDoubleSerialized = JSON.stringify(JSON.stringify({ password: 'ROOT_DOUBLE_CANARY_55' }));
  const deepNestedJson = JSON.stringify({ a: JSON.stringify({ b: JSON.stringify({ c: JSON.stringify({ password: 'DEEP_NESTED_CANARY_88' }) }) }) });
  const joseSanitized = sanitizePrivacy(`Tokens: ${noneJwt} and ${jweToken} and ${signedJwtWithPeriod} ${doubleSerializedJson} ${rootDoubleSerialized} ${deepNestedJson}`);
  assert.ok(!joseSanitized.includes('canary_none') && !joseSanitized.includes(noneJwt), 'Unsigned alg=none JWT must be redacted');
  assert.ok(!joseSanitized.includes('ciphertext_canary') && !joseSanitized.includes(jweToken), '5-segment JWE must be redacted');
  assert.ok(!joseSanitized.includes('sig_period_999'), 'JWT followed by sentence period must be redacted');
  assert.ok(!joseSanitized.includes('nested_canary_777'), 'Double-serialized JSON password must be redacted');
  assert.ok(!joseSanitized.includes('ROOT_DOUBLE_CANARY_55'), 'Root double-serialized JSON string must be redacted');
  let extremeDepth = JSON.stringify({ password: 'EXTREME_DEPTH_CANARY_15' });
  for (let d = 0; d < 14; d += 1) {
    extremeDepth = JSON.stringify({ wrap: extremeDepth });
  }
  const extremeSanitized = sanitizePrivacy(extremeDepth);
  assert.ok(!extremeSanitized.includes('EXTREME_DEPTH_CANARY_15'), 'Exceeding recursion depth must fail-closed and redact');

  // Bracket array depth >= 12 fail-closed + empty-ciphertext JWE + CR/LF inside URL scheme & userinfo
  const arrayDepthSanitized = sanitizePrivacy('['.repeat(12) + '"ARRAY_DEPTH_CANARY"' + ']'.repeat(12));
  assert.ok(!arrayDepthSanitized.includes('ARRAY_DEPTH_CANARY'), 'Root nested array at MAX_JSON_REDACT_DEPTH must fail-closed and redact');

  const emptyPlaintextJwe = `${Buffer.from('{"alg":"dir","enc":"A256GCM"}').toString('base64url')}..iv123456..tag123456`;
  assert.strictEqual(sanitizePrivacy(emptyPlaintextJwe), '[REDACTED_TOKEN]', 'Empty-plaintext 5-segment JWE must be redacted');

  const crlfUrlSanitized = sanitizePrivacy('https://audituser:\nURL_CANARY@host.test/x ht\ntps://u:\rP_CANARY@host.test/x');
  assert.ok(!crlfUrlSanitized.includes('URL_CANARY'), 'HTTPS URL credential with LF must be redacted');
  assert.ok(!crlfUrlSanitized.includes('P_CANARY'), 'HTTPS URL credential with LF in scheme and CR in password must be redacted');

  // Mixed depth 12 with incompatible outer closing bracket + 8,501 spaces, AND unclosed quoted password
  const mixedIncompatible = sanitizePrivacy('[{"x":'.repeat(6) + ' '.repeat(8501) + '"MIXED_DEPTH_CANARY"]');
  assert.ok(!mixedIncompatible.includes('MIXED_DEPTH_CANARY'), 'Mixed depth 12 with incompatible closing bracket must fail-closed');

  const unclosedPwd = sanitizePrivacy('{"password":"CLOUD_CANARY_UNCLOSED');
  assert.ok(!unclosedPwd.includes('CLOUD_CANARY_UNCLOSED'), 'Unclosed quoted JSON secret value must be redacted');

  const schemeTabAndMultiAt = sanitizePrivacy('https\t://alice:URL_CANARY@host.test/x https://alice:PREFIX@PASSWORD_SUFFIX_CANARY@host.test/x https://u s:P_SPACE@host.test/x');
  assert.ok(!schemeTabAndMultiAt.includes('URL_CANARY'), 'URL scheme with tab before colon must be redacted');
  assert.ok(!schemeTabAndMultiAt.includes('PASSWORD_SUFFIX_CANARY'), 'URL password containing @ must be redacted up to last @');
  assert.ok(!schemeTabAndMultiAt.includes('P_SPACE'), 'URL userinfo with space must be redacted');
  // Unicode host, underscore host, and signed JWS with empty payload
  const unicodeAndEmptyJws = sanitizePrivacy(
    `https://alice:UNICODE_HOST_CANARY@mañana.test/x https://alice:UNDERSCORE_HOST_CANARY@my_host.test/x ${jweHeader}..empty_payload_sig_999`
  );
  assert.ok(!unicodeAndEmptyJws.includes('UNICODE_HOST_CANARY'), 'Unicode host URL credential must be redacted');
  assert.ok(!unicodeAndEmptyJws.includes('UNDERSCORE_HOST_CANARY'), 'Underscore host URL credential must be redacted');
  assert.ok(!unicodeAndEmptyJws.includes('empty_payload_sig_999'), 'Signed JWS with empty payload must be redacted');

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
    // Nested multiline TOML arrays + Unicode escaped segment "a\u002eb" MUST NOT confuse profile names or emit array strings
    const largePadding = '# ' + 'x'.repeat(72000) + '\n';
    fs.writeFileSync(
      path.join(tmpHome, '.vibe', 'config.toml'),
      'profile = "au002eb"\nprompts = [\n  [\'x\'],\n  \'model=CLOUD_CANARY_NESTED_ARRAY\'\n]\n"prompt=name" = """\nmodel = "CANARY_QKEY"\n"""\n[profiles."a\\u002eb"]\nactive_model = "wrong-unicode-profile"\n[profiles."inactive]name"]\n' + largePadding + 'active_model = "wrong-bracket-model"\n',
      'utf8'
    );
    assert.strictEqual(detectDynamicModel('mistral-vibe', {}, { homeDir: tmpHome, env: {} }), null);
    // Escaped TOML profile value `profile = "a\u002eb"` selects `[profiles."a\u002eb"]`
    fs.writeFileSync(
      path.join(tmpHome, '.vibe', 'config.toml'),
      'profile = "a\\u002eb"\n[profiles."a\\u002eb"]\nactive_model = "devstral-2"\n',
      'utf8'
    );
    assert.strictEqual(detectDynamicModel('mistral-vibe', {}, { homeDir: tmpHome, env: {} }), 'Devstral 2');

    // TOML multiline basic string ending with 4 quotes inside nested array MUST NOT swallow subsequent `model="gpt-5"`
    fs.writeFileSync(
      path.join(tmpHome, '.codex', 'config.toml'),
      'prompts = [[\n"""\nmodel="CANARY_STRING"\n""""]]\nmodel="gpt-5"\n',
      'utf8'
    );
    assert.strictEqual(detectDynamicModel('codex', {}, { homeDir: tmpHome, env: {} }), 'GPT 5');

    // TOML array-of-tables [[profiles.inactive]] MUST NOT fall back to root when no profile is active
    fs.writeFileSync(
      path.join(tmpHome, '.codex', 'config.toml'),
      '[[profiles.inactive]]\nmodel="CANARY_INACTIVE_TABLE"\n',
      'utf8'
    );
    assert.strictEqual(detectDynamicModel('codex', {}, { homeDir: tmpHome, env: {} }), null);
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

  // POST /event with JSON `null` MUST return 400 and never crash daemon
  const nullRes = await fetch('http://127.0.0.1:19459/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'null',
  });
  assert.strictEqual(nullRes.status, 400, 'POST /event with JSON null must return 400');

  // Closing last active session s1 via SessionEnd MUST clear Discord presence AND reset context so new anon event doesn't resurrect old title
  const claudeS1End = translateClaudeEvent('SessionEnd', {
    session_id: 's1',
    session_name: 'Active Mission S1',
  }, ROOT_DIR);
  const closeS1 = await client.sendEvent(claudeS1End, false);
  assert.strictEqual(closeS1.cleared, true);
  await new Promise((r) => setTimeout(r, 80));
  assert.strictEqual(mockServer.receivedActivities[mockServer.receivedActivities.length - 1], null);

  // New anonymous event after clear MUST NOT resurrect 'Active Mission S1'
  const freshAnon = await client.sendEvent({ state: 'thinking', forceImmediate: true }, false);
  assert.ok(!JSON.stringify(freshAnon.activity || {}).includes('Active Mission S1'), 'Closed title must never resurrect after clear()');

  // A active -> POST /clear -> B active -> release B MUST clear (never resurrect A!)
  await client.sendEvent({ source: 'claude', sessionId: 'sess-A', state: 'thinking', chatTitle: 'Session A Title', forceImmediate: true }, false);
  await client.clear();
  await client.sendEvent({ source: 'codex', sessionId: 'sess-B', state: 'thinking', chatTitle: 'Session B Title', forceImmediate: true }, false);
  const relB = await client.sendEvent({ source: 'codex', sessionId: 'sess-B', state: 'idle', releaseLease: true, forceImmediate: true }, false);
  assert.strictEqual(relB.cleared, true, 'Releasing B after /clear must clear Discord instead of resurrecting A');
  await new Promise((r) => setTimeout(r, 80));
  assert.strictEqual(mockServer.receivedActivities[mockServer.receivedActivities.length - 1], null);

  // Non-string scalar fields like `{"agentName":17}` MUST NOT crash daemon or poison /status
  const numAgentRes = await fetch('http://127.0.0.1:19459/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentName: 17, state: 'thinking', forceImmediate: true }),
  });
  assert.strictEqual(numAgentRes.status, 200, 'Numeric agentName must coerce cleanly instead of crashing daemon');
  const statusAfterRes = await fetch('http://127.0.0.1:19459/status');
  assert.strictEqual(statusAfterRes.status, 200, 'Daemon /status must stay responsive after numeric fields');

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
