/**
 * Acourd RPC — State Engine & Rate Limiter
 * Cognitive state normalization, 15-second Discord cooldown debounce,
 * 128-byte UTF-8 truncation, and path/secret privacy sanitizer.
 */

import { EventEmitter } from 'node:events';
import {
  COGNITIVE_STATES,
  STATE_METADATA,
  DISCORD_LIMITS,
} from './constants.js';
import {
  LOCALIZED_STATES,
  renderTemplate,
  resolveEffectiveConfig,
} from './templates.js';

/**
 * Safely truncates a string to at most maxBytes without splitting multi-byte UTF-8 code points
 * or surrogate pairs.
 */
export function truncateUtf8(str, maxBytes = DISCORD_LIMITS.MAX_FIELD_BYTES) {
  if (typeof str !== 'string' || maxBytes <= 0) return '';
  const buf = Buffer.from(str, 'utf8');
  if (buf.length <= maxBytes) return str;

  let accumulated = '';
  let accumulatedBytes = 0;

  for (const char of str) {
    const charBytes = Buffer.byteLength(char, 'utf8');
    if (accumulatedBytes + charBytes > maxBytes) {
      break;
    }
    accumulated += char;
    accumulatedBytes += charBytes;
  }

  return accumulated;
}

const SECRET_KEY_PATTERN = /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key|secret[_-]?key|secret|token|password|passwd|authorization)$/i;

function decodeUnicodeEscapes(str) {
  return str.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

const MAX_JSON_REDACT_DEPTH = 12;

function redactTextPrimitives(input) {
  let sanitized = input;
  // 1. Obfuscate absolute home paths on Windows/Unix
  sanitized = sanitized.replace(
    /(?:[a-zA-Z]:[/\\]+Users[/\\]+[^/\\\s]+|[/\\]+home[/\\]+[^/\\\s]+|[/\\]+Users[/\\]+[^/\\\s]+)/gi,
    '~'
  );
  // 2. Sensitive configuration files (.env, keys)
  sanitized = sanitized.replace(/\.env(?:\.[\w.-]+)?/gi, '[REDACTED_ENV]');
  sanitized = sanitized.replace(/(?:id_rsa|id_ed25519|id_ecdsa|\.pem|\.key)\b/gi, '[REDACTED_KEY]');
  // 3. API keys, Bearer tokens, URL credentials, and KV secret assignments
  sanitized = sanitized.replace(/(?:ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|ghu_[A-Za-z0-9]{20,}|ghs_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, '[REDACTED_TOKEN]');
  sanitized = sanitized.replace(/(?:sk-ant-[A-Za-z0-9_-]{12,}|sk-[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{30,}|xox[baprs]-[0-9A-Za-z-]{10,}|AKIA[0-9A-Z]{16})/g, '[REDACTED_TOKEN]');
  sanitized = sanitized.replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED_TOKEN]');
  sanitized = sanitized.replace(
    /(["']?)([A-Za-z0-9_\\-]+)\1(\s*[:=]\s*)("(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|"(?:\\[\s\S]|[^"\\])*|'(?:\\[\s\S]|[^'\\])*|[^\s"'`,}\]]+)/g,
    (full, q, rawKey, sep, rawVal) => {
      const decodedKey = decodeUnicodeEscapes(rawKey);
      if (SECRET_KEY_PATTERN.test(decodedKey)) {
        if (rawVal.startsWith('"')) return `${decodedKey}="[REDACTED_TOKEN]"`;
        if (rawVal.startsWith("'")) return `${decodedKey}='[REDACTED_TOKEN]'`;
        return `${decodedKey}=[REDACTED_TOKEN]`;
      }
      return full;
    }
  );
  sanitized = sanitized.replace(
    /((?:h\s*t\s*t\s*p(?:\s*s)?|w\s*s(?:\s*s)?)\s*:\s*\/\s*\/)(?:[^/\s]*(?:[\t\r\n]+[^/\s]*)*|[^/]*:[^/]*)@(?=(?:[^/?#\s@]|[\t\r\n])+(?:[/?#\s]|$))/gi,
    '$1[REDACTED]@'
  );
  return sanitized;
}

function redactJsonValue(val, depth = 0) {
  if (depth >= MAX_JSON_REDACT_DEPTH) return '[REDACTED_TOKEN]';
  if (typeof val === 'string') {
    let s = redactEmbeddedJson(val, depth + 1);
    s = redactStructuralJwts(s);
    s = redactTextPrimitives(s);
    return s;
  }
  if (Array.isArray(val)) return val.map((item) => redactJsonValue(item, depth + 1));
  if (val && typeof val === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(val)) {
      if (SECRET_KEY_PATTERN.test(k)) {
        out[k] = '[REDACTED_TOKEN]';
      } else {
        out[k] = redactJsonValue(v, depth + 1);
      }
    }
    return out;
  }
  return val;
}

/**
 * Redacts embedded valid JSON objects/arrays AND JSON-encoded string wrappers (including root
 * arrays, double-serialized JSON like `"{\"password\":\"...\"}"`, and deeply nested structures).
 * Fail-closed: if nesting exceeds MAX_JSON_REDACT_DEPTH, redacts instead of passing raw content.
 */
function redactEmbeddedJson(text, depth = 0) {
  if (typeof text !== 'string') return '';
  if (depth >= MAX_JSON_REDACT_DEPTH) return '[REDACTED_TOKEN]';
  if (!text.includes('{') && !text.includes('[') && !text.includes('"')) return text;

  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '{' || text[i] === '[') {
      const openCh = text[i];
      const closeCh = openCh === '{' ? '}' : ']';
      let depthContainer = 0;
      let inStr = false;
      let escaped = false;
      let end = -1;
      for (let j = i; j < text.length; j += 1) {
        const ch = text[j];
        if (escaped) { escaped = false; continue; }
        if (ch === '\\' && inStr) { escaped = true; continue; }
        if (ch === '"') { inStr = !inStr; continue; }
        if (!inStr) {
          if (ch === openCh) depthContainer += 1;
          else if (ch === closeCh) {
            depthContainer -= 1;
            if (depthContainer === 0) { end = j; break; }
          }
        }
      }
      if (end !== -1) {
        const candidate = text.slice(i, end + 1);
        try {
          const parsed = JSON.parse(candidate);
          out += JSON.stringify(redactJsonValue(parsed, depth + 1));
          i = end + 1;
          continue;
        } catch (_) {}
      }
      // Run fail-closed combined `{` and `[` depth check when container is unclosed OR invalid JSON
      let peak = 0;
      let cur = 0;
      let s = false;
      let esc = false;
      for (let j = i; j < text.length; j += 1) {
        const ch = text[j];
        if (esc) { esc = false; continue; }
        if (ch === '\\' && s) { esc = true; continue; }
        if (ch === '"') { s = !s; continue; }
        if (!s) {
          if (ch === '{' || ch === '[') {
            cur += 1;
            if (cur > peak) peak = cur;
            if (depth + peak >= MAX_JSON_REDACT_DEPTH) {
              return `${out}[REDACTED_TOKEN]`;
            }
          } else if ((ch === '}' || ch === ']') && cur > 0) {
            cur -= 1;
          }
        }
      }
    } else if (text[i] === '"') {
      // Check for a JSON-encoded string wrapper (e.g. root double-serialized JSON `"{\"password\":\"...\"}"`)
      let escaped = false;
      let end = -1;
      for (let j = i + 1; j < text.length; j += 1) {
        const ch = text[j];
        if (escaped) { escaped = false; continue; }
        if (ch === '\\') { escaped = true; continue; }
        if (ch === '"') { end = j; break; }
      }
      if (end !== -1) {
        const candidate = text.slice(i, end + 1);
        if (candidate.includes('{') || candidate.includes('[') || candidate.includes('\\"') || candidate.includes('\\u')) {
          try {
            const unwrapped = JSON.parse(candidate);
            if (typeof unwrapped === 'string' && unwrapped !== candidate) {
              const redactedInner = redactTextPrimitives(
                redactStructuralJwts(redactEmbeddedJson(unwrapped, depth + 1))
              );
              if (redactedInner !== unwrapped) {
                out += JSON.stringify(redactedInner);
                i = end + 1;
                continue;
              }
            }
          } catch (_) {}
        }
      }
    }
    out += text[i];
    i += 1;
  }
  return out;
}

/**
 * Structurally detects and redacts ANY RFC 7515/7516/7519 JWT/JWS (including alg=none with empty signature)
 * and 5-segment JWE tokens (including empty-plaintext JWE and headers with whitespace).
 */
function redactStructuralJwts(text) {
  const isJoseHeader = (seg) => {
    try {
      const padded = seg.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (seg.length % 4)) % 4);
      const decoded = Buffer.from(padded, 'base64').toString('utf8');
      const headerObj = JSON.parse(decoded);
      if (headerObj && typeof headerObj === 'object' && !Array.isArray(headerObj)) {
        return ('alg' in headerObj || 'typ' in headerObj || 'enc' in headerObj);
      }
    } catch (_) {}
    return false;
  };

  // 1. 5-segment JWE (header.encrypted_key.iv.ciphertext.tag — ciphertext or encrypted_key may be empty)
  let out = text.replace(
    /(?<![A-Za-z0-9_-])([A-Za-z0-9_-]{4,})\.([A-Za-z0-9_-]*)\.([A-Za-z0-9_-]*)\.([A-Za-z0-9_-]*)\.([A-Za-z0-9_-]*)(?![A-Za-z0-9_-])/g,
    (full, h) => (isJoseHeader(h) ? '[REDACTED_TOKEN]' : full)
  );

  // 2. 3-segment JWS/JWT (including alg=none with empty payload/signature AND signed JWS with empty payload)
  out = out.replace(
    /(?<![A-Za-z0-9_-])([A-Za-z0-9_-]{4,})\.([A-Za-z0-9_-]*)\.([A-Za-z0-9_-]*)(?![A-Za-z0-9_-])/g,
    (full, h) => (isJoseHeader(h) ? '[REDACTED_TOKEN]' : full)
  );

  return out;
}

/**
 * Strips sensitive local paths, tokens, credentials, and secret environment files.
 */
export function sanitizePrivacy(text, options = {}) {
  if (typeof text !== 'string') return '';
  let sanitized = text;

  // 0. Structural redaction for embedded JSON objects/wrappers (RFC 8259) & RFC 7515/7516/7519 JWT/JWE
  sanitized = redactEmbeddedJson(sanitized);
  sanitized = redactStructuralJwts(sanitized);

  // 1-3. Paths, sensitive filenames, API keys, Bearer tokens, KV pairs, URL credentials
  sanitized = redactTextPrimitives(sanitized);

  // 4. Project stealth mode
  if (options.stealthMode) {
    sanitized = sanitized.replace(/(?:repo|project|workspace):\s*[^•|\n]+/i, 'Workspace: [Private]');
  }

  return sanitized;
}

export class StateEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.debounceMs = options.debounceMs ?? DISCORD_LIMITS.RATE_LIMIT_DEBOUNCE_MS;
    this.stealthMode = Boolean(options.stealthMode);
    this.config = resolveEffectiveConfig({
      ...(options.config || {}),
      ...(options.stealthMode !== undefined ? { stealthMode: Boolean(options.stealthMode) } : {}),
    });
    this.agentName = options.agentName || 'AI Agent';
    this.sessionStartTime = Math.floor(Date.now() / 1000);

    this.currentState = COGNITIVE_STATES.IDLE;
    this.lastSentTime = 0;
    this.pendingActivity = null;
    this.debounceTimer = null;
    this.activeActivity = null;
    this.lastDispatchedKey = null;
    this.lastEvent = {};
    this.currentHarnessKey = null;
    this.currentSessionKey = null;
    this.currentContext = {
      project: 'Workspace',
      branch: 'main',
      tool: null,
      details: null,
      task: null,
      chatTitle: null,
      model: null,
      stepCount: 0,
    };
  }

  /**
   * Dynamically updates template/preset configuration and re-renders active presence.
   */
  setConfig(newConfig = {}, forceDispatch = true) {
    this.config = resolveEffectiveConfig(newConfig);
    this.stealthMode = Boolean(this.config.stealthMode);
    if (this.activeActivity && forceDispatch) {
      const rebuilt = this.buildActivityPayload(this.lastEvent);
      return this.queueActivity(rebuilt, true);
    }
    return { queued: false, sent: false };
  }

  /**
   * Updates state based on an incoming event from an adapter.
   */
  processEvent(event = {}) {
    const rawState = event.state || event.cognitiveState || COGNITIVE_STATES.IDLE;
    const normalizedState = Object.values(COGNITIVE_STATES).includes(rawState)
      ? rawState
      : COGNITIVE_STATES.IDLE;

    this.currentState = normalizedState;
    this.lastEvent = { ...event };

    const incomingHarnessKey = String(event.harness || event.source || event.agentName || '').toLowerCase() || null;
    const incomingSessionKey = event.sessionId || event.session_id || null;
    const hasPriorContext = this.currentHarnessKey !== null || this.currentSessionKey !== null;
    const switchedHarness = Boolean(
      incomingHarnessKey && this.currentHarnessKey && incomingHarnessKey !== this.currentHarnessKey
    );
    const switchedSession = Boolean(
      hasPriorContext && incomingSessionKey !== this.currentSessionKey
    );

    if (switchedHarness || switchedSession) {
      // Never bleed previous harness/session model or chat title into a new harness/session (including anonymous -> identified)
      this.currentContext.model = null;
      this.currentContext.chatTitle = null;
      this.currentContext.task = null;
      this.currentContext.tool = null;
    }
    if (incomingHarnessKey) this.currentHarnessKey = incomingHarnessKey;
    this.currentSessionKey = incomingSessionKey;

    if (event.project !== undefined) this.currentContext.project = event.project != null ? String(event.project) : 'Workspace';
    if (event.branch !== undefined) this.currentContext.branch = event.branch != null ? String(event.branch) : '';
    if (event.tool !== undefined) this.currentContext.tool = event.tool != null ? String(event.tool) : null;
    if (event.details !== undefined) this.currentContext.details = event.details != null ? String(event.details) : null;
    if (event.task !== undefined) this.currentContext.task = event.task != null ? String(event.task) : null;
    if (event.chatTitle !== undefined) this.currentContext.chatTitle = event.chatTitle != null ? String(event.chatTitle) : null;
    if (event.model !== undefined) this.currentContext.model = event.model != null ? String(event.model) : null;
    if (event.stepCount !== undefined) this.currentContext.stepCount = Number(event.stepCount) || 0;
    if (event.agentName !== undefined && event.agentName !== null && String(event.agentName).trim() !== '') {
      this.agentName = String(event.agentName);
    }
    if (event.resetTimer) this.sessionStartTime = Math.floor(Date.now() / 1000);

    const activity = this.buildActivityPayload(event);
    return this.queueActivity(activity, event.forceImmediate);
  }

  /**
   * Assembles a validated, sanitized, truncated Discord Rich Presence activity object.
   */
  buildActivityPayload(event = {}) {
    const cfg = this.config;
    const langTable = LOCALIZED_STATES[cfg.lang] || LOCALIZED_STATES.en;
    const localized = langTable[this.currentState] || langTable[COGNITIVE_STATES.IDLE];
    const meta = STATE_METADATA[this.currentState] || STATE_METADATA[COGNITIVE_STATES.IDLE];

    const effectiveStealth = Boolean(this.stealthMode || cfg.stealthMode);
    const project = effectiveStealth ? 'Private Workspace' : String(this.currentContext.project || 'Workspace');
    const branch = effectiveStealth ? '' : String(this.currentContext.branch || '');
    const safeAgentName = String(this.agentName || 'AI Agent');
    const shortAgent = safeAgentName.replace(/^Google\s+/i, '').replace(/\s+2\.0$/i, '').trim() || 'AI';
    const chatTitle = effectiveStealth ? '' : String(event.chatTitle ?? this.currentContext.chatTitle ?? '');
    const model = event.model !== undefined
      ? (event.model != null ? String(event.model) : '')
      : String(this.currentContext.model || '');
    const conciseStatus = this.currentState === COGNITIVE_STATES.IDLE
      ? (cfg.lang === 'es' ? 'Idle' : 'Idle')
      : (cfg.lang === 'es' ? 'Working' : 'Working');
    const steps = this.currentContext.stepCount > 0 ? `${this.currentContext.stepCount} steps` : '';

    let rawTask = event.task != null
      ? String(event.task)
      : (event.details != null ? String(event.details) : '');
    if (!rawTask && this.currentState === COGNITIVE_STATES.TOOL_CALL && this.currentContext.tool) {
      rawTask = cfg.lang === 'es'
        ? `Ejecutando ${this.currentContext.tool}`
        : `Executing: ${this.currentContext.tool}`;
    }

    // Sanitize all interpolated inputs BEFORE template whitespace normalization (prevents tab->space bypasses)
    const cleanField = (val) => sanitizePrivacy(val, { stealthMode: effectiveStealth });
    const safeProject = cleanField(project);
    const safeBranch = cleanField(branch);
    const safeChatTitle = cleanField(chatTitle);
    const safeModel = cleanField(model);
    const safeTask = cleanField(rawTask);
    const safeAgent = cleanField(shortAgent);
    const safeTool = cleanField(this.currentContext.tool != null ? String(this.currentContext.tool) : '');

    const templateVars = {
      project: safeProject,
      branch: safeBranch,
      chat: safeChatTitle,
      chat_or_task: safeChatTitle || safeTask || localized.label,
      model: safeModel,
      status: conciseStatus,
      steps,
      task: safeTask,
      state: localized.label,
      task_or_state: safeTask || localized.label,
      emoji: cfg.showEmojis ? localized.emoji : '',
      agent: safeAgent,
      tool: safeTool,
    };

    let detailsText = renderTemplate(cfg.detailsTemplate, templateVars);
    let stateText = event.stateText !== undefined
      ? (event.stateText != null ? String(event.stateText) : '')
      : renderTemplate(cfg.stateTemplate, templateVars);

    // Apply privacy sanitization and 128-byte truncation
    detailsText = truncateUtf8(sanitizePrivacy(detailsText, { stealthMode: effectiveStealth }));
    stateText = truncateUtf8(sanitizePrivacy(stateText, { stealthMode: effectiveStealth }));

    let defaultLargeImage = 'antigravity_logo';
    if (safeAgentName.toLowerCase().includes('claude')) {
      defaultLargeImage = 'claude-code';
    }
    const largeImageKey = event.largeImage != null ? String(event.largeImage) : defaultLargeImage;
    const rawLargeText = event.largeText != null ? String(event.largeText) : `${safeAgentName} • ${localized.label}`;
    const largeText = truncateUtf8(sanitizePrivacy(rawLargeText, { stealthMode: effectiveStealth }));
    const smallImageKey = meta.icon || 'idle';
    const rawSmallText = localized.description || meta.description || localized.label;
    const smallText = truncateUtf8(sanitizePrivacy(rawSmallText, { stealthMode: effectiveStealth }));

    const activity = {
      assets: {},
    };

    if (cfg.showElapsed) {
      activity.timestamps = {
        start: this.sessionStartTime,
      };
    }

    // Discord RPC requires string fields to be at least 2 characters if present
    if (detailsText && detailsText.length >= DISCORD_LIMITS.MIN_FIELD_BYTES) {
      activity.details = detailsText;
    }
    if (stateText && stateText.length >= DISCORD_LIMITS.MIN_FIELD_BYTES) {
      activity.state = stateText;
    }

    if (largeImageKey) {
      activity.assets.large_image = largeImageKey;
      if (largeText && largeText.length >= DISCORD_LIMITS.MIN_FIELD_BYTES) {
        activity.assets.large_text = largeText;
      }
    }

    if (smallImageKey) {
      activity.assets.small_image = smallImageKey;
      if (smallText && smallText.length >= DISCORD_LIMITS.MIN_FIELD_BYTES) {
        activity.assets.small_text = smallText;
      }
    }

    const sourceButtons = (event.buttons && Array.isArray(event.buttons) && event.buttons.length > 0)
      ? event.buttons
      : cfg.customButtons;

    if (sourceButtons && Array.isArray(sourceButtons) && sourceButtons.length > 0) {
      const validButtons = sourceButtons
        .filter((btn) => {
          if (!btn || typeof btn.url !== 'string') return false;
          try {
            const parsed = new URL(btn.url);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
            if (parsed.username || parsed.password) return false;
            if (/@/.test(parsed.host)) return false;
            return true;
          } catch (_) {
            return false;
          }
        })
        .slice(0, DISCORD_LIMITS.MAX_BUTTONS)
        .map((btn) => ({
          label: truncateUtf8(sanitizePrivacy(btn.label || 'Link', { stealthMode: effectiveStealth }), DISCORD_LIMITS.MAX_BUTTON_LABEL_BYTES),
          url: btn.url,
        }));

      if (validButtons.length > 0) {
        activity.buttons = validButtons;
      }
    }

    return activity;
  }

  /**
   * Queues activity respecting the 15-second Discord rate limit cooldown.
   */
  queueActivity(activity, forceImmediate = false) {
    const now = Date.now();
    const timeSinceLast = now - this.lastSentTime;

    if (forceImmediate || timeSinceLast >= this.debounceMs) {
      this._cancelTimer();
      return this._dispatchActivity(activity);
    }

    // Cooldown is active: buffer pending activity
    this.pendingActivity = activity;
    if (!this.debounceTimer) {
      const waitRemainingMs = this.debounceMs - timeSinceLast;
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        if (this.pendingActivity) {
          const toSend = this.pendingActivity;
          this.pendingActivity = null;
          this._dispatchActivity(toSend);
        }
      }, waitRemainingMs);
    }

    return { queued: true, waitMs: this.debounceMs - timeSinceLast };
  }

  _dispatchActivity(activity) {
    const sig = JSON.stringify({
      d: activity.details || '',
      s: activity.state || '',
      li: activity.assets?.large_image || '',
      si: activity.assets?.small_image || '',
      t: activity.timestamps?.start || 0,
    });
    if (sig === this.lastDispatchedKey && this.activeActivity) {
      return { queued: false, sent: false, deduplicated: true, activity: this.activeActivity };
    }
    this.lastDispatchedKey = sig;
    this.lastSentTime = Date.now();
    this.activeActivity = activity;
    this.emit('activity', activity);
    return { queued: false, sent: true, activity };
  }

  _cancelTimer() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  /**
   * Cancels any pending debounced activity and clears active presence + stale session context.
   */
  clear() {
    this._cancelTimer();
    this.pendingActivity = null;
    this.activeActivity = null;
    this.lastDispatchedKey = null;
    this.currentState = COGNITIVE_STATES.IDLE;
    this.lastEvent = {};
    this.currentHarnessKey = null;
    this.currentSessionKey = null;
    this.currentContext = {
      project: 'Workspace',
      branch: 'main',
      tool: null,
      details: null,
      task: null,
      chatTitle: null,
      model: null,
      stepCount: 0,
    };
  }

  /**
   * Cleans up timers.
   */
  destroy() {
    this._cancelTimer();
    this.pendingActivity = null;
    this.activeActivity = null;
  }
}
