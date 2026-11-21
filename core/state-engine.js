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

/**
 * Safely truncates a string to at most maxBytes without splitting multi-byte UTF-8 code points.
 */
export function truncateUtf8(str, maxBytes = DISCORD_LIMITS.MAX_FIELD_BYTES) {
  if (typeof str !== 'string') return '';
  const buf = Buffer.from(str, 'utf8');
  if (buf.length <= maxBytes) return str;

  let truncated = buf.subarray(0, maxBytes).toString('utf8');
  while (Buffer.byteLength(truncated, 'utf8') > maxBytes || truncated.endsWith('\uFFFD')) {
    truncated = truncated.slice(0, -1);
  }
  return truncated;
}

/**
 * Strips sensitive local paths, tokens, credentials, and secret environment files.
 */
export function sanitizePrivacy(text, options = {}) {
  if (typeof text !== 'string') return '';
  let sanitized = text;

  // 1. Obfuscate absolute home paths on Windows/Unix
  // e.g. C:\Users\<Username>\... or /home/<username>/...
  sanitized = sanitized.replace(
    /(?:[a-zA-Z]:[/\\]Users[/\\][^/\\\s]+|[/\\]home[/\\][^/\\\s]+|[/\\]Users[/\\][^/\\\s]+)/gi,
    '~'
  );

  // 2. Sensitive files (.env, keys)
  sanitized = sanitized.replace(/\.env(?:\.[\w.-]+)?/gi, '[REDACTED_ENV]');
  sanitized = sanitized.replace(/(?:id_rsa|id_ed25519|id_ecdsa|\.pem|\.key)\b/gi, '[REDACTED_KEY]');

  // 3. API keys and Bearer tokens
  sanitized = sanitized.replace(/(?:ghp_[A-Za-z0-9]{36}|sk-[A-Za-z0-9]{32,}|gho_[A-Za-z0-9]{36})/g, '[REDACTED_TOKEN]');

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
    this.agentName = options.agentName || 'AI Agent';
    this.sessionStartTime = Math.floor(Date.now() / 1000);

    this.currentState = COGNITIVE_STATES.IDLE;
    this.lastSentTime = 0;
    this.pendingActivity = null;
    this.debounceTimer = null;
    this.activeActivity = null;
    this.currentContext = {
      project: 'Workspace',
      branch: 'main',
      tool: null,
      details: null,
    };
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

    if (event.project) this.currentContext.project = event.project;
    if (event.branch) this.currentContext.branch = event.branch;
    if (event.tool !== undefined) this.currentContext.tool = event.tool;
    if (event.details !== undefined) this.currentContext.details = event.details;
    if (event.agentName) this.agentName = event.agentName;
    if (event.resetTimer) this.sessionStartTime = Math.floor(Date.now() / 1000);

    const activity = this.buildActivityPayload(event);
    return this.queueActivity(activity, event.forceImmediate);
  }

  /**
   * Assembles a validated, sanitized, truncated Discord Rich Presence activity object.
   */
  buildActivityPayload(event = {}) {
    const meta = STATE_METADATA[this.currentState] || STATE_METADATA[COGNITIVE_STATES.IDLE];
    const project = this.currentContext.project || 'Project';
    const branch = this.currentContext.branch ? ` • ${this.currentContext.branch}` : '';

    let detailsText = '';
    if (event.details) {
      detailsText = `${meta.emoji} ${event.details}`;
    } else if (this.currentState === COGNITIVE_STATES.TOOL_CALL && this.currentContext.tool) {
      detailsText = `${meta.emoji} Executing: ${this.currentContext.tool}`;
    } else {
      detailsText = `${meta.emoji} ${meta.label}`;
    }

    let stateText = event.stateText || `${project}${branch}`;

    // Apply privacy sanitization and 128-byte truncation
    detailsText = truncateUtf8(sanitizePrivacy(detailsText, { stealthMode: this.stealthMode }));
    stateText = truncateUtf8(sanitizePrivacy(stateText, { stealthMode: this.stealthMode }));

    const largeImageKey = event.largeImage || 'acourd_logo';
    const largeText = truncateUtf8(event.largeText || `${this.agentName} • ${meta.label}`);
    const smallImageKey = meta.icon || 'idle';
    const smallText = truncateUtf8(meta.description || meta.label);

    const activity = {
      details: detailsText,
      state: stateText,
      timestamps: {
        start: this.sessionStartTime,
      },
      assets: {
        large_image: largeImageKey,
        large_text: largeText,
        small_image: smallImageKey,
        small_text: smallText,
      },
    };

    if (event.buttons && Array.isArray(event.buttons)) {
      activity.buttons = event.buttons.slice(0, DISCORD_LIMITS.MAX_BUTTONS).map((btn) => ({
        label: truncateUtf8(btn.label, DISCORD_LIMITS.MAX_BUTTON_LABEL_BYTES),
        url: btn.url,
      }));
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
   * Cleans up timers.
   */
  destroy() {
    this._cancelTimer();
    this.pendingActivity = null;
    this.activeActivity = null;
  }
}
