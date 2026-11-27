/**
 * Vela RPC — Dynamic Model Detector (Zero Dependencies)
 * Resolves the real active model dynamically from event payload, local harness
 * config/session files (full-file multiline-aware TOML, JSON, YAML, session-correlated JSONL),
 * and environment variables. Never fabricates a hardcoded static model when none is detected.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { formatModelName } from './antigravity-telemetry.js';

const MAX_CONFIG_BYTES = 4 * 1024 * 1024;
const MAX_JSONL_BYTES = 4 * 1024 * 1024;

/**
 * Reads a config file strictly from byte 0 (never tail-seeks a config file so headers/context are never lost).
 * Returns null if the file exceeds MAX_CONFIG_BYTES.
 */
function readConfigFileFromStart(filePath, maxBytes = MAX_CONFIG_BYTES) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > maxBytes) return null;
    return fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return null;
  }
}

function readJsonlTailSafe(filePath, maxBytes = MAX_JSONL_BYTES) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return { text: null, truncated: false };
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return { text: null, truncated: false };
    if (stat.size <= maxBytes) {
      return { text: fs.readFileSync(filePath, 'utf8'), truncated: false };
    }
    const fd = fs.openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(maxBytes);
      const bytesRead = fs.readSync(fd, buf, 0, maxBytes, stat.size - maxBytes);
      return { text: buf.subarray(0, bytesRead).toString('utf8'), truncated: true };
    } finally {
      fs.closeSync(fd);
    }
  } catch (_) {
    return { text: null, truncated: false };
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

function decodeTomlBasicEscape(str, backslashIdx) {
  const next = str[backslashIdx + 1];
  if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(str.slice(backslashIdx + 2, backslashIdx + 6))) {
    return { ch: String.fromCharCode(parseInt(str.slice(backslashIdx + 2, backslashIdx + 6), 16)), advance: 6 };
  }
  if (next === 'U' && /^[0-9a-fA-F]{8}$/.test(str.slice(backslashIdx + 2, backslashIdx + 10))) {
    try {
      return { ch: String.fromCodePoint(parseInt(str.slice(backslashIdx + 2, backslashIdx + 10), 16)), advance: 10 };
    } catch (_) {}
  }
  const simple = { '"': '"', '\\': '\\', n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
  if (next && Object.prototype.hasOwnProperty.call(simple, next)) {
    return { ch: simple[next], advance: 2 };
  }
  return { ch: next || '', advance: 2 };
}

function decodeTomlValueString(rawVal) {
  const trimmed = rawVal.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    const inner = trimmed.slice(1, -1);
    let out = '';
    for (let i = 0; i < inner.length; ) {
      if (inner[i] === '\\') {
        const dec = decodeTomlBasicEscape(inner, i);
        out += dec.ch;
        i += dec.advance;
      } else {
        out += inner[i];
        i += 1;
      }
    }
    return out;
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseTomlSectionSegments(rawSection) {
  const segments = [];
  let cur = '';
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < rawSection.length; ) {
    const ch = rawSection[i];
    if (ch === '\\' && inDouble) {
      const dec = decodeTomlBasicEscape(rawSection, i);
      cur += dec.ch;
      i += dec.advance;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      i += 1;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      i += 1;
      continue;
    }
    if (ch === '.' && !inSingle && !inDouble) {
      const s = cur.trim();
      if (s) segments.push(s);
      cur = '';
      i += 1;
      continue;
    }
    cur += ch;
    i += 1;
  }
  const tail = cur.trim();
  if (tail) segments.push(tail);
  return segments;
}

function parseTomlSectionHeader(line) {
  if (!line.startsWith('[') || !line.endsWith(']')) return null;
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
  const segs = parseTomlSectionSegments(inner);
  return segs.length > 0 ? JSON.stringify(segs) : null;
}

/**
 * Character-level TOML/YAML sanitizer that strips multiline strings ("""...""", '''...'''),
 * comments outside strings, and nested array/inline-table interiors so lines inside ANY string
 * or array (e.g. `prompts = ["""\nmodel="CANARY"\n"""]` or `"prompt=name" = """..."""`)
 * can NEVER be mistaken for top-level TOML assignments or section headers.
 */
function stripTomlMultilineAndComments(raw) {
  let out = '';
  let i = 0;
  let state = 'NORMAL'; // NORMAL | SINGLE | DOUBLE | MULTI_SINGLE | MULTI_DOUBLE | COMMENT
  let braceDepth = 0; // tracks [...] on RHS and {...} inline tables
  let atLineStart = true;

  while (i < raw.length) {
    const ch = raw[i];
    const next3 = raw.slice(i, i + 3);

    if (state === 'COMMENT') {
      if (ch === '\n' || ch === '\r') {
        state = 'NORMAL';
        atLineStart = true;
        out += ch;
      }
      i += 1;
      continue;
    }

    if (state === 'MULTI_DOUBLE') {
      if (ch === '\\') { i += 2; continue; }
      if (next3 === '"""') {
        // TOML v1.0: up to 2 trailing quotes before closing """ (total run of 3..5 quotes closes multiline string)
        let qCount = 3;
        while (qCount < 5 && raw[i + qCount] === '"') qCount += 1;
        state = 'NORMAL';
        if (braceDepth === 0) out += '""';
        i += qCount;
        continue;
      }
      i += 1;
      continue;
    }

    if (state === 'MULTI_SINGLE') {
      if (next3 === "'''") {
        let qCount = 3;
        while (qCount < 5 && raw[i + qCount] === "'") qCount += 1;
        state = 'NORMAL';
        if (braceDepth === 0) out += "''";
        i += qCount;
        continue;
      }
      i += 1;
      continue;
    }

    if (state === 'DOUBLE') {
      if (ch === '\\') {
        if (braceDepth === 0) out += raw.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (ch === '"') {
        state = 'NORMAL';
        if (braceDepth === 0) out += ch;
        i += 1;
        continue;
      }
      if (ch === '\n' || ch === '\r') {
        state = 'NORMAL';
        atLineStart = true;
        out += ch;
        i += 1;
        continue;
      }
      if (braceDepth === 0) out += ch;
      i += 1;
      continue;
    }

    if (state === 'SINGLE') {
      if (ch === "'") {
        state = 'NORMAL';
        if (braceDepth === 0) out += ch;
        i += 1;
        continue;
      }
      if (ch === '\n' || ch === '\r') {
        state = 'NORMAL';
        atLineStart = true;
        out += ch;
        i += 1;
        continue;
      }
      if (braceDepth === 0) out += ch;
      i += 1;
      continue;
    }

    // NORMAL state
    if (ch === '#') {
      state = 'COMMENT';
      i += 1;
      continue;
    }
    if (next3 === '"""') {
      state = 'MULTI_DOUBLE';
      i += 3;
      continue;
    }
    if (next3 === "'''") {
      state = 'MULTI_SINGLE';
      i += 3;
      continue;
    }
    if (ch === '"') {
      state = 'DOUBLE';
      if (braceDepth === 0) out += ch;
      atLineStart = false;
      i += 1;
      continue;
    }
    if (ch === "'") {
      state = 'SINGLE';
      if (braceDepth === 0) out += ch;
      atLineStart = false;
      i += 1;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      atLineStart = true;
      if (braceDepth === 0) out += ch;
      i += 1;
      continue;
    }
    if (ch === ' ' || ch === '\t') {
      if (braceDepth === 0) out += ch;
      i += 1;
      continue;
    }
    if (ch === '[' && (!atLineStart || braceDepth > 0)) {
      braceDepth += 1;
      i += 1;
      continue;
    }
    if (ch === ']' && braceDepth > 0) {
      braceDepth -= 1;
      i += 1;
      continue;
    }
    if (ch === '{') {
      braceDepth += 1;
      i += 1;
      continue;
    }
    if (ch === '}' && braceDepth > 0) {
      braceDepth -= 1;
      i += 1;
      continue;
    }

    atLineStart = false;
    if (braceDepth === 0) out += ch;
    i += 1;
  }

  return out;
}

/**
 * Full-file, section-aware, character-level multiline-string-aware TOML/YAML model extractor.
 * Preserves exact segment boundaries via JSON array keys (so [profiles."a.b"] != [profiles.a.b]),
 * strips all multiline strings / nested arrays / inline tables / comments before parsing,
 * honors active `profile`, and NEVER reads inactive profiles.
 */
export function extractModelFromTomlOrYaml(raw, explicitProfile = null) {
  if (!raw || typeof raw !== 'string') return null;

  const ROOT_KEY = '[]';
  const sections = { [ROOT_KEY]: {} };
  let currentSection = ROOT_KEY;

  const cleaned = stripTomlMultilineAndComments(raw);
  const lines = cleaned.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const parsedHeader = parseTomlSectionHeader(line);
    if (parsedHeader !== null) {
      currentSection = parsedHeader;
      if (!sections[currentSection]) sections[currentSection] = {};
      continue;
    }

    const kvMatch = line.match(/^["']?([A-Za-z0-9_.-]+)["']?\s*[:=]\s*("(?:\\.|[^"\\])*"|'[^']*'|[A-Za-z0-9_./:-]+)\s*$/);
    if (kvMatch) {
      const key = kvMatch[1].trim();
      const val = decodeTomlValueString(kvMatch[2]);
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

  const rawProfile = explicitProfile ?? sections[ROOT_KEY].profile ?? sections[ROOT_KEY].active_profile ?? null;
  if (rawProfile !== null && rawProfile !== undefined && String(rawProfile).trim() !== '') {
    const normProfile = explicitProfile
      ? String(explicitProfile).trim().replace(/^["'](.*)["']$/, '$1')
      : String(rawProfile);
    const profModel =
      pickModel(sections[JSON.stringify(['profiles', normProfile])]) ||
      pickModel(sections[JSON.stringify(['profile', normProfile])]) ||
      pickModel(sections[JSON.stringify([normProfile])]);
    if (profModel) return profModel;
  }

  const rootModel = pickModel(sections[ROOT_KEY]);
  if (rootModel) return rootModel;

  return pickModel(sections[JSON.stringify(['default'])]) || pickModel(sections[JSON.stringify(['model'])]) || null;
}

/**
 * Strictly session-correlated JSONL model extractor.
 * Never guesses from a truncated mixed file when sessionId is omitted.
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
      for (const file of files) {
        const exactFileMatch = file.baseName === sid;
        const { text: content, truncated } = readJsonlTailSafe(file.full, MAX_JSONL_BYTES);
        if (!content) continue;

        let lines = content.split(/\r?\n/);
        if (truncated && lines.length > 0) lines = lines.slice(1);

        let lastMatchedModel = null;
        let sawForeignSession = false;
        let lastUnattributedModel = null;

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) continue;
          let obj;
          try { obj = JSON.parse(line); } catch (_) { continue; }
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
          } else if (exactFileMatch && !truncated && isUsableModel(lineModel)) {
            lastUnattributedModel = lineModel.trim();
          }
        }

        if (lastMatchedModel) return lastMatchedModel;
        if (exactFileMatch && !truncated && !sawForeignSession && lastUnattributedModel) {
          return lastUnattributedModel;
        }
      }
      return null;
    }

    // No sessionId provided: ONLY safe when there is a single non-truncated file with at most one session
    if (files.length === 1) {
      const { text: content, truncated } = readJsonlTailSafe(files[0].full, MAX_JSONL_BYTES);
      if (!content || truncated) return null;
      const seenSids = new Set();
      let lastModel = null;
      for (const rawLine of content.split(/\r?\n/)) {
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
      extractModelFromTomlOrYaml(readConfigFileFromStart(path.join(home, '.codex', 'config.toml')), explicitProfile) ||
      env.CODEX_MODEL ||
      env.OPENAI_MODEL ||
      null;
  } else if (id === 'opencode') {
    rawModel =
      extractModelFromJson(readConfigFileFromStart(path.join(home, '.config', 'opencode', 'opencode.json'))) ||
      extractModelFromJson(readConfigFileFromStart(path.join(home, '.opencode', 'config.json'))) ||
      env.OPENCODE_MODEL ||
      null;
  } else if (id === 'openchamber') {
    rawModel =
      extractModelFromJson(readConfigFileFromStart(path.join(home, '.openchamber', 'config.json'))) ||
      extractModelFromJson(readConfigFileFromStart(path.join(home, '.config', 'openchamber', 'config.json'))) ||
      env.OPENCHAMBER_MODEL ||
      null;
  } else if (id === 'hermes') {
    rawModel =
      extractModelFromTomlOrYaml(readConfigFileFromStart(path.join(home, '.hermes', 'config.yaml'))) ||
      env.HERMES_MODEL ||
      null;
  } else if (id === 'kimi-code' || id === 'kimi') {
    rawModel =
      extractModelFromTomlOrYaml(readConfigFileFromStart(path.join(home, '.kimi', 'config.toml'))) ||
      extractModelFromJson(readConfigFileFromStart(path.join(home, '.kimi', 'config.json'))) ||
      env.KIMI_MODEL ||
      null;
  } else if (id === 'deepseek') {
    rawModel =
      extractModelFromJson(readConfigFileFromStart(path.join(home, '.deepseek', 'config.json'))) ||
      extractModelFromJson(readConfigFileFromStart(path.join(home, '.config', 'deepseek', 'config.json'))) ||
      env.DEEPSEEK_MODEL ||
      null;
  } else if (id === 'kiro') {
    rawModel =
      extractModelFromJson(readConfigFileFromStart(path.join(home, '.kiro', 'settings', 'cli.json'))) ||
      extractModelFromJson(readConfigFileFromStart(path.join(home, '.kiro', 'config.json'))) ||
      env.KIRO_MODEL ||
      null;
  } else if (id === 'mistral-vibe') {
    rawModel =
      extractModelFromTomlOrYaml(readConfigFileFromStart(path.join(home, '.vibe', 'config.toml')), safePayload.profile || env.VIBE_PROFILE || null) ||
      env.VIBE_MODEL ||
      env.MISTRAL_MODEL ||
      null;
  } else if (id === 'factory-droid') {
    rawModel =
      extractModelFromJson(readConfigFileFromStart(path.join(home, '.factory', 'settings.json'))) ||
      env.DROID_MODEL ||
      env.FACTORY_MODEL ||
      null;
  } else if (id === 'amp') {
    rawModel =
      extractModelFromJson(readConfigFileFromStart(path.join(home, '.config', 'amp', 'settings.json'))) ||
      env.AMP_MODEL ||
      null;
  } else if (id === 'gemini-cli') {
    rawModel =
      extractModelFromJson(readConfigFileFromStart(path.join(home, '.gemini', 'settings.json'))) ||
      env.GEMINI_MODEL ||
      null;
  }

  return isUsableModel(rawModel) ? formatModelName(rawModel) : null;
}
