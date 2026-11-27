/**
 * Acourd RPC — Hermes Agent Adapter (Nous Research)
 * Autonomous SQLite (`~/.hermes/state.db`) + `config.yaml` telemetry reader,
 * privacy-first event translator (zero prompt leaks), and drop-in HOOK.yaml generator.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { COGNITIVE_STATES } from '../../core/constants.js';
import { HARNESS_IDS, HARNESSES } from '../../core/harnesses.js';
import { formatModelName, detectGitBranch } from '../../core/antigravity-telemetry.js';
import { detectDynamicModel } from '../../core/model-detector.js';

const HERMES_DIR = path.join(os.homedir(), '.hermes');

/**
 * Extracts configured default model from ~/.hermes/config.yaml without external YAML deps.
 */
export function parseHermesConfigModel(yamlText) {
  if (!yamlText || typeof yamlText !== 'string') return null;
  // Match either top-level `model: ...` or nested `default: ...` under `model:`
  const direct = yamlText.match(/^\s*model:\s*["']?([A-Za-z0-9_./:-]+)["']?\s*$/m);
  if (direct && direct[1] && direct[1] !== 'null') return direct[1].trim();

  const nested = yamlText.match(/^\s*default_model:\s*["']?([A-Za-z0-9_./:-]+)["']?\s*$/m);
  if (nested && nested[1]) return nested[1].trim();
  return null;
}

/**
 * Reads active session title & model from ~/.hermes/state.db (read-only) and config.yaml.
 */
export async function readHermesTelemetry(options = {}) {
  const hermesDir = options.hermesDir || HERMES_DIR;
  const dbPath = path.join(hermesDir, 'state.db');
  const configPath = path.join(hermesDir, 'config.yaml');
  const harness = HARNESSES[HARNESS_IDS.HERMES];

  let configModel = null;
  try {
    if (fs.existsSync(configPath)) {
      configModel = parseHermesConfigModel(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (_) {}

  const detectedFallbackModel = configModel || process.env.HERMES_MODEL || null;
  const fallback = {
    sessionId: null,
    chatTitle: null,
    model: detectedFallbackModel ? formatModelName(detectedFallbackModel) : null,
    state: COGNITIVE_STATES.IDLE,
    isWorking: false,
  };

  if (!fs.existsSync(dbPath)) return fallback;

  let db = null;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    db = new DatabaseSync(dbPath, { readOnly: true });

    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'"
    ).get();
    if (!tableExists) return fallback;

    const cols = db.prepare('PRAGMA table_info(sessions)').all().map((c) => c.name);
    const titleCol = cols.includes('title') ? 'title' : (cols.includes('name') ? 'name' : 'NULL AS title');
    const modelCol = cols.includes('model') ? 'model' : 'NULL AS model';
    const timeCol = cols.includes('updated_at') ? 'updated_at' : (cols.includes('created_at') ? 'created_at' : 'rowid');

    const row = db.prepare(`
      SELECT id, ${titleCol}, ${modelCol}, ${timeCol} AS ts
      FROM sessions
      ORDER BY ${timeCol} DESC
      LIMIT 1
    `).get();

    if (!row) return fallback;

    const tsMs = typeof row.ts === 'number'
      ? (row.ts < 1e12 ? row.ts * 1000 : row.ts)
      : Date.parse(String(row.ts || ''));
    const isWorking = !Number.isNaN(tsMs) && (Date.now() - tsMs) < 90_000;

    const resolvedDbModel = row.model || configModel || process.env.HERMES_MODEL || null;
    return {
      sessionId: row.id ? String(row.id) : null,
      chatTitle: (row.title || '').trim() || null,
      model: resolvedDbModel ? formatModelName(resolvedDbModel) : null,
      state: isWorking ? COGNITIVE_STATES.THINKING : COGNITIVE_STATES.IDLE,
      isWorking,
    };
  } catch (_) {
    return fallback;
  } finally {
    if (db) {
      try { db.close(); } catch (_) {}
    }
  }
}

/**
 * Translates Hermes lifecycle events (`session:start`, `pre_tool_call`, `post_tool_call`, `session:end`)
 * into minimalist, privacy-first Acourd Rich Presence payloads. Never exposes prompt text.
 */
export function translateHermesEvent(eventType, payload = {}, cwd = process.cwd(), options = {}) {
  const safePayload = (payload && typeof payload === 'object') ? payload : {};
  const harness = HARNESSES[HARNESS_IDS.HERMES];
  const effectiveCwd = safePayload.cwd || cwd || process.cwd();
  const project = safePayload.project || path.basename(effectiveCwd) || 'Workspace';
  const branch = safePayload.branch || detectGitBranch(effectiveCwd) || undefined;
  const model = detectDynamicModel(harness.id, safePayload, options) || null;
  const type = String(eventType || safePayload.event || safePayload.status || 'working').toLowerCase();

  let state = COGNITIVE_STATES.THINKING;
  if (type === 'idle' || type === 'session:end' || type === 'end' || type === 'stop') {
    state = COGNITIVE_STATES.IDLE;
  } else if (type === 'pre_tool_call' || type === 'tool' || type === 'exec') {
    state = COGNITIVE_STATES.TOOL_CALL;
  } else if (type === 'swarm' || type === 'delegate') {
    state = COGNITIVE_STATES.SWARM;
  }

  const sessionTitle = (payload.chatTitle || payload.sessionTitle || payload.title || '').trim() || undefined;

  return {
    source: harness.id,
    harness: harness.id,
    sessionId: payload.sessionId || payload.session_id || undefined,
    agentName: harness.displayName,
    state,
    model,
    project,
    ...(branch ? { branch } : {}),
    ...(sessionTitle ? { chatTitle: sessionTitle } : {}),
    // Strict privacy: never include user prompt text
    details: sessionTitle || project,
    largeImage: harness.assetKey,
    largeText: harness.displayName,
    resetTimer: type === 'session:start',
    releaseLease: type === 'session:end' || type === 'end',
    forceImmediate: type === 'session:start' || type === 'session:end' || type === 'end',
  };
}

/**
 * Generates drop-in Hermes Gateway Hook manifest (`HOOK.yaml`) for ~/.hermes/hooks/acourd-rpc/.
 */
export function generateHermesHookManifest(daemonUrl = 'http://127.0.0.1:19452/event') {
  return {
    name: 'acourd-rpc',
    version: '1.0.0',
    description: 'Minimalist Discord Rich Presence bridge for Nous Research Hermes Agent',
    events: ['session:start', 'pre_tool_call', 'post_tool_call', 'session:end'],
    endpoint: daemonUrl,
  };
}
