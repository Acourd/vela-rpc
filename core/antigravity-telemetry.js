/**
 * Acourd RPC — Autonomous Antigravity Telemetry Reader (v2 — Exact Protobuf + View-Time)
 * Zero-dependency read-only reader for Antigravity 2.0 local metadata:
 * 1. Active viewed conversation from annotations/*.pbtxt (`last_user_view_time`) + conversation_summaries.db
 * 2. Exact per-conversation active AI model from conversations/<uuid>.db (`gen_metadata` protobuf)
 *    matching Antigravity's official field layout (1->21 displayName, 3->28 planner model_name, 1->19 response_model)
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { COGNITIVE_STATES } from './constants.js';

const ANTIGRAVITY_DIR = path.join(os.homedir(), '.gemini', 'antigravity');
const DEFAULT_DB_PATH = path.join(ANTIGRAVITY_DIR, 'conversation_summaries.db');
const DEFAULT_ANNOTATIONS_DIR = path.join(ANTIGRAVITY_DIR, 'annotations');
const DEFAULT_CONVERSATIONS_DIR = path.join(ANTIGRAVITY_DIR, 'conversations');
const DEFAULT_STATE_PATH = path.join(ANTIGRAVITY_DIR, 'antigravity_state.pbtxt');

const EFFORT_LEVELS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
const WORD_LABELS = Object.freeze({
  gpt: 'GPT',
  oss: 'OSS',
  ai: 'AI',
  deepseek: 'DeepSeek',
  kimi: 'Kimi',
  opencode: 'OpenCode',
});

/**
 * Minimal zero-dependency protobuf wire decoder (varint + length-delimited).
 */
export function decodeProtoFields(buf) {
  const fields = new Map();
  if (!buf || buf.length === 0) return fields;
  const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  let pos = 0;

  const readVarint = () => {
    let val = 0n;
    let shift = 0n;
    while (pos < bytes.length) {
      const b = bytes[pos++];
      val |= BigInt(b & 0x7f) << shift;
      if ((b & 0x80) === 0) return Number(val);
      shift += 7n;
      if (shift > 63n) break;
    }
    return null;
  };

  while (pos < bytes.length) {
    const tag = readVarint();
    if (tag === null) break;
    const fn = tag >>> 3;
    const wt = tag & 7;
    let val;

    if (wt === 0) {
      val = readVarint();
      if (val === null) break;
    } else if (wt === 2) {
      const len = readVarint();
      if (len === null || pos + len > bytes.length) break;
      val = bytes.subarray(pos, pos + len);
      pos += len;
    } else if (wt === 1) {
      if (pos + 8 > bytes.length) break;
      val = bytes.subarray(pos, pos + 8);
      pos += 8;
    } else if (wt === 5) {
      if (pos + 4 > bytes.length) break;
      val = bytes.subarray(pos, pos + 4);
      pos += 4;
    } else {
      break;
    }

    if (!fields.has(fn)) fields.set(fn, []);
    fields.get(fn).push(val);
  }
  return fields;
}

function getProtoBytes(fields, fn) {
  const arr = fields.get(fn);
  if (!arr || arr.length === 0) return null;
  const last = arr[arr.length - 1];
  return Buffer.isBuffer(last) ? last : null;
}

function getProtoStr(fields, fn) {
  const b = getProtoBytes(fields, fn);
  return b ? b.toString('utf8').trim() : '';
}

/**
 * Formats a model slug into a clean human-readable label:
 * e.g. "gemini-3.8-flash-medium" -> "Gemini 3.8 Flash"
 *      "gemini-4-neon-medium" -> "Gemini 4 Neon"
 *      "claude-opus-4-6" -> "Claude Opus 4.6"
 */
export function formatModelName(rawModel) {
  if (!rawModel || typeof rawModel !== 'string') return null;
  const trimmed = rawModel.trim();
  if (!trimmed) return null;

  // If it's already a clean human display name with spaces (e.g. "Gemini 4 Neon (Medium)")
  if (trimmed.includes(' ') && !trimmed.startsWith('MODEL_')) {
    return trimmed.replace(/\s*\((?:Minimal|Low|Medium|High|Xhigh|Max)\)\s*$/i, '').trim() || null;
  }

  if (/^MODEL_PLACEHOLDER_/i.test(trimmed)) {
    return null;
  }

  const cleaned = trimmed.replace(/^MODEL_/i, '').replace(/_/g, '-');
  const parts = cleaned.split('-').filter(Boolean);
  if (parts.length > 1 && EFFORT_LEVELS.has(parts[parts.length - 1].toLowerCase())) {
    parts.pop();
  }

  const words = [];
  for (const p of parts) {
    const low = p.toLowerCase();
    if (/^\d+$/.test(p) && words.length > 0 && /\d$/.test(words[words.length - 1])) {
      words[words.length - 1] += `.${p}`;
    } else if (WORD_LABELS[low]) {
      words.push(WORD_LABELS[low]);
    } else if (/^\d/.test(p)) {
      words.push(p.toUpperCase());
    } else {
      words.push(p.charAt(0).toUpperCase() + p.slice(1).toLowerCase());
    }
  }

  return words.join(' ').replace('GPT OSS', 'GPT-OSS') || trimmed;
}

/**
 * Extracts exact active model from a conversation's SQLite `gen_metadata` table.
 */
export async function readConversationModel(conversationId, conversationsDir = DEFAULT_CONVERSATIONS_DIR) {
  if (!conversationId) return null;
  const dbPath = path.join(conversationsDir, `${conversationId}.db`);
  if (!fs.existsSync(dbPath)) return null;

  let db = null;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    db = new DatabaseSync(dbPath, { readOnly: true });
    const row = db.prepare('SELECT data FROM gen_metadata ORDER BY idx DESC LIMIT 1').get();
    if (!row || !row.data) return null;

    const gen = decodeProtoFields(row.data);
    const chatBuf = getProtoBytes(gen, 1);
    const plannerBuf = getProtoBytes(gen, 3);

    if (chatBuf) {
      const chat = decodeProtoFields(chatBuf);
      const displayName = getProtoStr(chat, 21); // model_display_name
      if (displayName) return formatModelName(displayName);
    }

    if (plannerBuf) {
      const planner = decodeProtoFields(plannerBuf);
      const modelSlug = getProtoStr(planner, 28); // planner_config.model_name
      if (modelSlug) return formatModelName(modelSlug);
    }

    if (chatBuf) {
      const chat = decodeProtoFields(chatBuf);
      const responseModel = getProtoStr(chat, 19); // response_model
      if (responseModel) return formatModelName(responseModel);
    }

    return null;
  } catch (_) {
    return null;
  } finally {
    if (db) {
      try { db.close(); } catch (_) {}
    }
  }
}

/**
 * Finds the most recently viewed conversation from annotations/*.pbtxt (`last_user_view_time`).
 */
export function readMostRecentlyViewedConversation(annotationsDir = DEFAULT_ANNOTATIONS_DIR) {
  try {
    if (!fs.existsSync(annotationsDir)) return null;
    const files = fs.readdirSync(annotationsDir);
    let best = null;

    for (const file of files) {
      if (!file.endsWith('.pbtxt')) continue;
      const id = file.slice(0, -6);
      if (!/^[0-9a-f-]{36}$/i.test(id)) continue;

      const fullPath = path.join(annotationsDir, file);
      let stat;
      try {
        stat = fs.statSync(fullPath);
      } catch (_) {
        continue;
      }

      // Fast pre-filter using file mtime; only parse recent candidates
      if (best && stat.mtimeMs + 5000 < best.mtimeMs) continue;

      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        const secMatch = content.match(/last_user_view_time:\s*\{\s*seconds:\s*(\d+)/);
        const titleMatch = content.match(/title:\s*"((?:[^"\\]|\\.)*)"/);
        const viewSec = secMatch ? Number(secMatch[1]) : Math.floor(stat.mtimeMs / 1000);
        const title = titleMatch ? titleMatch[1].replace(/\\"/g, '"').trim() : null;

        if (!best || viewSec > best.viewSec || (viewSec === best.viewSec && stat.mtimeMs > best.mtimeMs)) {
          best = { conversationId: id, title, viewSec, mtimeMs: stat.mtimeMs };
        }
      } catch (_) {}
    }

    return best;
  } catch (_) {
    return null;
  }
}

/**
 * Parses file:/// URI into a clean local directory path and basename.
 */
export function parseWorkspaceUri(uriStr) {
  if (!uriStr || typeof uriStr !== 'string') return { dir: null, name: null };
  try {
    let cleaned = uriStr.trim();
    if (cleaned.startsWith('[')) {
      const arr = JSON.parse(cleaned);
      cleaned = Array.isArray(arr) && arr.length > 0 ? arr[0] : '';
    }
    if (!cleaned.startsWith('file:///')) return { dir: null, name: null };
    let localPath = decodeURIComponent(cleaned.replace(/^file:\/\/\//, ''));
    if (process.platform === 'win32') {
      localPath = localPath.replace(/\//g, '\\');
    }
    const name = path.basename(localPath) || null;
    return { dir: localPath, name };
  } catch (_) {
    return { dir: null, name: null };
  }
}

/**
 * Fallback: reads global selected model from antigravity_state.pbtxt.
 */
export function readSelectedModel(statePath = DEFAULT_STATE_PATH) {
  try {
    if (!fs.existsSync(statePath)) return null;
    const content = fs.readFileSync(statePath, 'utf8');
    const match = content.match(/last_selected_agent_model:\s*([A-Za-z0-9_.-]+)/);
    if (match && match[1]) {
      return formatModelName(match[1]);
    }
  } catch (_) {}
  return null;
}

/**
 * Detects Git branch from a directory safely.
 */
export function detectGitBranch(dir) {
  if (!dir || !fs.existsSync(dir)) return null;
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
      timeout: 800,
    }).trim();
    return (branch && branch !== 'HEAD') ? branch : null;
  } catch (_) {
    return null;
  }
}

/**
 * Reads exact live Antigravity telemetry:
 * - Active chat: prefers actively RUNNING chat, otherwise most recently viewed chat (`annotations/*.pbtxt`)
 * - Active model: reads exact per-chat model from `conversations/<id>.db` `gen_metadata` protobuf!
 */
export async function readAntigravityTelemetry(options = {}) {
  const dbPath = options.dbPath || DEFAULT_DB_PATH;
  const annotationsDir = options.annotationsDir || DEFAULT_ANNOTATIONS_DIR;
  const conversationsDir = options.conversationsDir || DEFAULT_CONVERSATIONS_DIR;
  const statePath = options.statePath || DEFAULT_STATE_PATH;

  const fallbackModel = readSelectedModel(statePath);
  const viewed = readMostRecentlyViewedConversation(annotationsDir);

  let row = null;
  if (fs.existsSync(dbPath)) {
    let db = null;
    try {
      const { DatabaseSync } = await import('node:sqlite');
      db = new DatabaseSync(dbPath, { readOnly: true });

      // 1. Check if any root conversation is actively RUNNING right now
      const runningRow = db.prepare(`
        SELECT conversation_id, title, step_count, last_modified_time,
               workspace_uris, status, not_fully_idle
        FROM conversation_summaries
        WHERE nesting_depth = 0 AND killed = 0
          AND (status LIKE '%RUNNING%' OR not_fully_idle = 1)
        ORDER BY last_modified_time DESC
        LIMIT 1
      `).get();

      if (runningRow) {
        row = runningRow;
      } else if (viewed && viewed.conversationId) {
        // 2. Otherwise use the exact conversation the user is currently viewing!
        row = db.prepare(`
          SELECT conversation_id, title, step_count, last_modified_time,
                 workspace_uris, status, not_fully_idle
          FROM conversation_summaries
          WHERE conversation_id = ?
          LIMIT 1
        `).get(viewed.conversationId);
      }

      if (!row) {
        // 3. Final fallback: most recently modified root conversation
        row = db.prepare(`
          SELECT conversation_id, title, step_count, last_modified_time,
                 workspace_uris, status, not_fully_idle
          FROM conversation_summaries
          WHERE nesting_depth = 0 AND killed = 0
          ORDER BY last_modified_time DESC
          LIMIT 1
        `).get();
      }
    } catch (_) {
    } finally {
      if (db) {
        try { db.close(); } catch (_) {}
      }
    }
  }

  const conversationId = row?.conversation_id || viewed?.conversationId || null;
  const exactModel = await readConversationModel(conversationId, conversationsDir);
  const model = exactModel || fallbackModel;

  const { dir, name } = parseWorkspaceUri(row?.workspace_uris || '');
  const branch = dir ? detectGitBranch(dir) : null;
  const isRunning = String(row?.status || '').includes('RUNNING') || Boolean(row?.not_fully_idle);
  const modifiedMs = Date.parse(row?.last_modified_time || '');
  const recentlyActive = !Number.isNaN(modifiedMs) && (Date.now() - modifiedMs) < 90_000;
  const isWorking = isRunning || recentlyActive;

  const chatTitle = (row?.title || viewed?.title || '').trim() || null;

  return {
    conversationId,
    chatTitle,
    project: name || 'Workspace',
    branch,
    model,
    state: isWorking ? COGNITIVE_STATES.THINKING : COGNITIVE_STATES.IDLE,
    stepCount: Number(row?.step_count) || 0,
    isWorking,
  };
}
