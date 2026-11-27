/**
 * Vela RPC — Dynamic Model Detector (Zero Dependencies)
 * Resolves the real active model dynamically from event payload, local harness
 * config/session files (TOML, JSON, YAML, JSONL), and environment variables.
 * Never fabricates a hardcoded static model when none is detected.
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
      if (typeof c === 'string' && c.trim() && c.trim().toLowerCase() !== 'auto') {
        return c.trim();
      }
    }
  } catch (_) {}
  return null;
}

function extractModelFromTomlOrYaml(raw) {
  if (!raw) return null;
  const patterns = [
    /^\s*active_model\s*[:=]\s*["']?([A-Za-z0-9_./:-]+)["']?\s*$/m,
    /^\s*default_model\s*[:=]\s*["']?([A-Za-z0-9_./:-]+)["']?\s*$/m,
    /^\s*model\s*[:=]\s*["']?([A-Za-z0-9_./:-]+)["']?\s*$/m,
  ];
  for (const re of patterns) {
    const m = raw.match(re);
    if (m && m[1] && m[1].toLowerCase() !== 'null' && m[1].toLowerCase() !== 'auto') {
      return m[1].trim();
    }
  }
  return null;
}

function extractLatestModelFromJsonlDir(dirPath) {
  try {
    if (!dirPath || !fs.existsSync(dirPath)) return null;
    const files = fs.readdirSync(dirPath)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => {
        const full = path.join(dirPath, f);
        return { full, mtime: fs.statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length === 0) return null;
    const tail = readTextSafe(files[0].full, 32768);
    if (!tail) return null;
    const matches = [...tail.matchAll(/"model"\s*:\s*"([A-Za-z0-9_./:-]+)"/g)];
    if (matches.length > 0) {
      return matches[matches.length - 1][1];
    }
  } catch (_) {}
  return null;
}

/**
 * Dynamically detects the active model for a given harness ID.
 * Priority: explicit payload.model -> live local session/config files -> env vars -> null (never fakes).
 */
export function detectDynamicModel(harnessId, payload = {}, options = {}) {
  const safePayload = (payload && typeof payload === 'object') ? payload : {};
  const env = options.env || process.env;
  const home = options.homeDir || os.homedir();

  if (typeof safePayload.model === 'string' && safePayload.model.trim()) {
    return formatModelName(safePayload.model.trim());
  }

  const id = String(harnessId || '').toLowerCase();
  let rawModel = null;

  if (id === 'codex') {
    rawModel =
      extractLatestModelFromJsonlDir(path.join(home, '.codex', 'sessions')) ||
      extractModelFromTomlOrYaml(readTextSafe(path.join(home, '.codex', 'config.toml'))) ||
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
      extractModelFromTomlOrYaml(readTextSafe(path.join(home, '.vibe', 'config.toml'))) ||
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

  return rawModel ? formatModelName(rawModel) : null;
}
