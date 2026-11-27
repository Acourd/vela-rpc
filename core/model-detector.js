/**
 * Vela RPC — Dynamic Model Detector (Zero Dependencies)
 * Resolves the real active model dynamically from event payload, local harness
 * config/session files (section-aware TOML, JSON, YAML, session-correlated JSONL),
 * and environment variables. Never fabricates a hardcoded static model when none is detected.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { formatModelName } from './antigravity-telemetry.js';

function readTextSafe(filePath, maxBytes = 65536) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    if (stat.size <= maxBytes) {
      return fs.readFileSync(filePath, 'utf8');
    }
    const fd = fs.openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(maxBytes);
      const bytesRead = fs.readSync(fd, buf, 0, maxBytes, Math.max(0, stat.size - maxBytes));
      return buf.subarray(0, bytesRead).toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch (_) {
    return null;
  }
}

function isUsableModel(val) {
  if (typeof val !== 'string') return false;
  const trimmed = val.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  return lower !== 'null' && lower !== 'auto' && lower !== 'none';
}

function extractModelFromJson(raw) {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    const candidates = [
      data.active_model,
      data.activeModel,
      data.model,
      data.defaultModel,
      data.default_model,
      data['amp.model'],
      data.model?.name,
      data.model?.id,
      data.model?.default,
      data.agent?.model,
    ];
    for (const c of candidates) {
      if (isUsableModel(c)) return c.trim();
    }
  } catch (_) {}
  return null;
}

function normalizeTomlSection(rawSection) {
  const segments = [];
  let cur = '';
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let i = 0; i < rawSection.length; i += 1) {
    const ch = rawSection[i];
    if (escaped) {
      cur += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\' && inDouble) {
      escaped = true;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (ch === '.' && !inSingle && !inDouble) {
      const s = cur.trim();
      if (s) segments.push(s);
      cur = '';
      continue;
    }
    cur += ch;
  }
  const tail = cur.trim();
  if (tail) segments.push(tail);
  return segments.join('.');
}

function parseTomlSectionHeader(line) {
  if (!line.startsWith('[') || !line.endsWith(']')) return null;
  // Support [[array]] or [table], respecting quoted brackets like [profiles."inactive]name"]
  const isDouble = line.startsWith('[[') && line.endsWith(']]');
  const inner = isDouble ? line.slice(2, -2) : line.slice(1, -1);
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && inDouble) { escaped = true; continue; }
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if ((ch === '[' || ch === ']') && !inSingle && !inDouble) return null;
  }
  if (inSingle || inDouble) return null;
  return normalizeTomlSection(inner);
}

function stripTomlComment(line) {
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\' && inDouble) {
      escaped = true;
      continue;
    }
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === '#' && !inSingle && !inDouble) return line.slice(0, i);
  }
  return line;
}

/**
 * Section-aware TOML/YAML model extractor.
 * Honors top-level `profile = "<name>"` (checking `[profiles.<name>]` / `[profiles."<name>"]` first),
 * and NEVER reads models from inactive `[profiles.*]` sections.
 */
export function extractModelFromTomlOrYaml(raw, explicitProfile = null) {
  if (!raw || typeof raw !== 'string') return null;

  const sections = { '': {} };
  let currentSection = '';

  const lines = raw.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = stripTomlComment(rawLine).trim();
    if (!line) continue;

    const parsedHeader = parseTomlSectionHeader(line);
    if (parsedHeader !== null) {
      currentSection = parsedHeader;
      if (!sections[currentSection]) sections[currentSection] = {};
      continue;
    }

    const kvMatch = line.match(/^["']?([A-Za-z0-9_.-]+)["']?\s*[:=]\s*["']?([A-Za-z0-9_./:-]+)["']?\s*$/);
    if (kvMatch) {
      const key = kvMatch[1].trim();
      const val = kvMatch[2].trim();
      if (!sections[currentSection]) sections[currentSection] = {};
      sections[currentSection][key] = val;
    }
  }

  const pickModel = (obj) => {
    if (!obj) return null;
    for (const k of ['active_model', 'default_model', 'model']) {
      if (isUsableModel(obj[k])) return obj[k];
    }
    return null;
  };

  // 1. Active profile explicitly requested or declared at top level
  const activeProfile = explicitProfile || sections[''].profile || sections[''].active_profile || null;
  if (activeProfile) {
    const normProfile = String(activeProfile).trim().replace(/^["'](.*)["']$/, '$1');
    const profModel =
      pickModel(sections[`profiles.${normProfile}`]) ||
      pickModel(sections[`profile.${normProfile}`]) ||
      pickModel(sections[normProfile]);
    if (profModel) return profModel;
  }

  // 2. Top-level root section (never inactive [profiles.*])
  const rootModel = pickModel(sections['']);
  if (rootModel) return rootModel;

  // 3. Dedicated [default] or [model] section only
  return pickModel(sections.default) || pickModel(sections.model) || null;
}

/**
 * Strictly session-correlated JSONL model extractor.
 * Parses line-by-line JSON; never matches filenames by substring (`session-123` != `session-123-other`)
 * and in mixed JSONL files only extracts models from lines belonging to the exact requested `sessionId`.
 */
function extractModelFromJsonlDir(dirPath, sessionId = null) {
  try {
    if (!dirPath || !fs.existsSync(dirPath)) return null;
    const files = fs.readdirSync(dirPath)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => {
        const full = path.join(dirPath, f);
        return { name: f, baseName: f.replace(/\.jsonl$/i, ''), full, mtime: fs.statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length === 0) return null;

    if (sessionId) {
      const sid = String(sessionId).trim();
      const MAX_JSONL_BYTES = 4 * 1024 * 1024;
      for (const file of files) {
        const exactFileMatch = file.baseName === sid;
        let stat;
        try { stat = fs.statSync(file.full); } catch (_) { continue; }
        const wasTruncated = stat.size > MAX_JSONL_BYTES;
        const content = readTextSafe(file.full, MAX_JSONL_BYTES);
        if (!content) continue;

        let lines = content.split(/\r?\n/);
        if (wasTruncated && lines.length > 0) {
          lines = lines.slice(1); // discard partial leading line after tail seek
        }

        let lastMatchedModel = null;
        let sawForeignSession = false;
        let lastUnattributedModel = null;

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) continue;
          let obj;
          try {
            obj = JSON.parse(line);
          } catch (_) {
            continue;
          }
          if (!obj || typeof obj !== 'object') continue;

          const lineSid = obj.session_id ?? obj.sessionId ?? obj.id ?? null;
          const lineModel = typeof obj.model === 'string'
            ? obj.model
            : (typeof obj.message?.model === 'string' ? obj.message.model : null);

          if (lineSid !== null && String(lineSid).trim() !== '') {
            if (String(lineSid).trim() === sid) {
              if (isUsableModel(lineModel)) lastMatchedModel = lineModel.trim();
            } else {
              sawForeignSession = true;
            }
          } else if (exactFileMatch && !wasTruncated && isUsableModel(lineModel)) {
            lastUnattributedModel = lineModel.trim();
          }
        }

        if (lastMatchedModel) return lastMatchedModel;
        if (exactFileMatch && !wasTruncated && !sawForeignSession && lastUnattributedModel) {
          return lastUnattributedModel;
        }
      }
      // Explicit sessionId did not match any JSONL record -> never steal another session's model
      return null;
    }

    // No sessionId provided: only safe when there is a single unambiguous session file with at most one session
    if (files.length === 1) {
      const tail = readTextSafe(files[0].full, 32768);
      if (!tail) return null;
      const seenSids = new Set();
      let lastModel = null;
      for (const rawLine of tail.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        try {
          const obj = JSON.parse(line);
          if (!obj || typeof obj !== 'object') continue;
          const lineSid = obj.session_id ?? obj.sessionId ?? obj.id ?? null;
          if (lineSid) seenSids.add(String(lineSid));
          const lineModel = typeof obj.model === 'string' ? obj.model : obj.message?.model;
          if (isUsableModel(lineModel)) lastModel = lineModel.trim();
        } catch (_) {}
      }
      if (seenSids.size <= 1) return lastModel;
    }
  } catch (_) {}
  return null;
}

/**
 * Dynamically detects the active model for a given harness ID.
 * Priority: explicit payload.model -> session-correlated JSONL -> active profile/root config -> env vars -> null.
 */
export function detectDynamicModel(harnessId, payload = {}, options = {}) {
  const safePayload = (payload && typeof payload === 'object') ? payload : {};
  const env = options.env || process.env;
  const home = options.homeDir || os.homedir();
  const sessionId = safePayload.sessionId || safePayload.session_id || null;
  const explicitProfile = safePayload.profile || options.profile || env.CODEX_PROFILE || null;

  if (isUsableModel(safePayload.model)) {
    return formatModelName(safePayload.model.trim());
  }

  const id = String(harnessId || '').toLowerCase();
  let rawModel = null;

  if (id === 'codex') {
    rawModel =
      extractModelFromJsonlDir(path.join(home, '.codex', 'sessions'), sessionId) ||
      extractModelFromTomlOrYaml(readTextSafe(path.join(home, '.codex', 'config.toml')), explicitProfile) ||
      env.CODEX_MODEL ||
      env.OPENAI_MODEL ||
      null;
  } else if (id === 'opencode') {
    rawModel =
      extractModelFromJson(readTextSafe(path.join(home, '.config', 'opencode', 'opencode.json'))) ||
      extractModelFromJson(readTextSafe(path.join(home, '.opencode', 'config.json'))) ||
      env.OPENCODE_MODEL ||
      null;
  } else if (id === 'openchamber') {
    rawModel =
      extractModelFromJson(readTextSafe(path.join(home, '.openchamber', 'config.json'))) ||
      extractModelFromJson(readTextSafe(path.join(home, '.config', 'openchamber', 'config.json'))) ||
      env.OPENCHAMBER_MODEL ||
      null;
  } else if (id === 'hermes') {
    rawModel =
      extractModelFromTomlOrYaml(readTextSafe(path.join(home, '.hermes', 'config.yaml'))) ||
      env.HERMES_MODEL ||
      null;
  } else if (id === 'kimi-code' || id === 'kimi') {
    rawModel =
      extractModelFromTomlOrYaml(readTextSafe(path.join(home, '.kimi', 'config.toml'))) ||
      extractModelFromJson(readTextSafe(path.join(home, '.kimi', 'config.json'))) ||
      env.KIMI_MODEL ||
      null;
  } else if (id === 'deepseek') {
    rawModel =
      extractModelFromJson(readTextSafe(path.join(home, '.deepseek', 'config.json'))) ||
      extractModelFromJson(readTextSafe(path.join(home, '.config', 'deepseek', 'config.json'))) ||
      env.DEEPSEEK_MODEL ||
      null;
  } else if (id === 'kiro') {
    rawModel =
      extractModelFromJson(readTextSafe(path.join(home, '.kiro', 'settings', 'cli.json'))) ||
      extractModelFromJson(readTextSafe(path.join(home, '.kiro', 'config.json'))) ||
      env.KIRO_MODEL ||
      null;
  } else if (id === 'mistral-vibe') {
    rawModel =
      extractModelFromTomlOrYaml(readTextSafe(path.join(home, '.vibe', 'config.toml')), safePayload.profile || env.VIBE_PROFILE || null) ||
      env.VIBE_MODEL ||
      env.MISTRAL_MODEL ||
      null;
  } else if (id === 'factory-droid') {
    rawModel =
      extractModelFromJson(readTextSafe(path.join(home, '.factory', 'settings.json'))) ||
      env.DROID_MODEL ||
      env.FACTORY_MODEL ||
      null;
  } else if (id === 'amp') {
    rawModel =
      extractModelFromJson(readTextSafe(path.join(home, '.config', 'amp', 'settings.json'))) ||
      env.AMP_MODEL ||
      null;
  } else if (id === 'gemini-cli') {
    rawModel =
      extractModelFromJson(readTextSafe(path.join(home, '.gemini', 'settings.json'))) ||
      env.GEMINI_MODEL ||
      null;
  }

  return isUsableModel(rawModel) ? formatModelName(rawModel) : null;
}
