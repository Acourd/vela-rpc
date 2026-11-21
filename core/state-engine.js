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

/**
 * Strips sensitive local paths, tokens, credentials, and secret environment files.
 */
export function sanitizePrivacy(text, options = {}) {
  if (typeof text !== 'string') return '';
  let sanitized = text;

  // 1. Obfuscate absolute home paths on Windows/Unix (handling single or double backslashes)
  // e.g. C:\Users\<Username>\..., C:\\Users\\<Username>\\..., or /home/<username>/... or /Users/<username>/...
  sanitized = sanitized.replace(
    /(?:[a-zA-Z]:[/\\]+Users[/\\]+[^/\\\s]+|[/\\]+home[/\\]+[^/\\\s]+|[/\\]+Users[/\\]+[^/\\\s]+)/gi,
    '~'
  );

  // 2. Sensitive configuration files (.env, keys)
  sanitized = sanitized.replace(/\.env(?:\.[\w.-]+)?/gi, '[REDACTED_ENV]');
  sanitized = sanitized.replace(/(?:id_rsa|id_ed25519|id_ecdsa|\.pem|\.key)\b/gi, '[REDACTED_KEY]');

  // 3. API keys and Bearer tokens (GitHub tokens, OpenAI, Anthropic, generic Bearer)
  sanitized = sanitized.replace(/(?:ghp_[A-Za-z0-9]{36}|gho_[A-Za-z0-9]{36}|ghu_[A-Za-z0-9]{36}|ghs_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{82})/g, '[REDACTED_TOKEN]');
  sanitized = sanitized.replace(/(?:sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,})/g, '[REDACTED_TOKEN]');

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

    if (event.project !== undefined) this.currentContext.project = event.project;
    if (event.branch !== undefined) this.currentContext.branch = event.branch;
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

    let stateText = event.stateText !== undefined ? event.stateText : `${project}${branch}`;

    // Apply privacy sanitization and 128-byte truncation
    detailsText = truncateUtf8(sanitizePrivacy(detailsText, { stealthMode: this.stealthMode }));
    stateText = truncateUtf8(sanitizePrivacy(stateText, { stealthMode: this.stealthMode }));

    const largeImageKey = event.largeImage || 'acourd_logo';
    const rawLargeText = event.largeText || `${this.agentName} • ${meta.label}`;
    const largeText = truncateUtf8(rawLargeText);
    const smallImageKey = meta.icon || 'idle';
    const rawSmallText = meta.description || meta.label;
    const smallText = truncateUtf8(rawSmallText);

    const activity = {
      timestamps: {
        start: this.sessionStartTime,
      },
      assets: {},
    };

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

    if (event.buttons && Array.isArray(event.buttons)) {
      const validButtons = event.buttons
        .filter((btn) => btn && typeof btn.url === 'string' && /^https?:\/\//i.test(btn.url))
        .slice(0, DISCORD_LIMITS.MAX_BUTTONS)
        .map((btn) => ({
          label: truncateUtf8(btn.label || 'Link', DISCORD_LIMITS.MAX_BUTTON_LABEL_BYTES),
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
   * Cancels any pending debounced activity and clears active presence.
   */
  clear() {
    this._cancelTimer();
    this.pendingActivity = null;
    this.activeActivity = null;
    this.currentState = COGNITIVE_STATES.IDLE;
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
