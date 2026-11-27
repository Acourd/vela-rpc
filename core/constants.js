/**
 * Acourd RPC — Constants & Protocols
 * Zero-Bloat Universal Discord Rich Presence Microkernel
 */

export const OPCODES = Object.freeze({
  HANDSHAKE: 0,
  FRAME: 1,
  CLOSE: 2,
  PING: 3,
  PONG: 4,
});

export const RPC_COMMANDS = Object.freeze({
  DISPATCH: 'DISPATCH',
  SET_ACTIVITY: 'SET_ACTIVITY',
});

export const RPC_EVENTS = Object.freeze({
  READY: 'READY',
  ERROR: 'ERROR',
});

export const KNOWN_CLIENT_IDS = Object.freeze({
  ANTIGRAVITY: '1440730997460172810',
  CLAUDE_CODE: '1472915568930848829',
});

export const DEFAULT_CLIENT_ID = process.env.DISCORD_CLIENT_ID || KNOWN_CLIENT_IDS.ANTIGRAVITY;

export const DAEMON_CONFIG = Object.freeze({
  DEFAULT_PORT: 19452,
  DEFAULT_HOST: '127.0.0.1',
  PID_FILE_NAME: 'acourd.pid',
  SOCKET_CONNECT_TIMEOUT_MS: 3000,
  MAX_PAYLOAD_SIZE_BYTES: 1024 * 1024, // 1MB safety limit
});

export const DISCORD_LIMITS = Object.freeze({
  RATE_LIMIT_DEBOUNCE_MS: 15000, // Discord 15s rate limit threshold
  MIN_FIELD_BYTES: 2,            // Minimum required length for string fields in Discord RPC
  MAX_FIELD_BYTES: 128,          // Hard limit for details, state, large_text, small_text
  MAX_BUTTON_LABEL_BYTES: 32,
  MAX_BUTTONS: 2,
});

export const COGNITIVE_STATES = Object.freeze({
  IDLE: 'idle',
  THINKING: 'thinking',
  TOOL_CALL: 'tool_call',
  SWARM: 'swarm',
  VERIFYING: 'verifying',
  REVIEWING: 'reviewing',
});

export const STATE_METADATA = Object.freeze({
  [COGNITIVE_STATES.IDLE]: {
    label: 'Standing by',
    icon: 'idle',
    emoji: '☕',
    description: 'Awaiting instruction',
  },
  [COGNITIVE_STATES.THINKING]: {
    label: 'Reasoning & Planning',
    icon: 'thinking',
    emoji: '🧠',
    description: 'Deep cognitive synthesis',
  },
  [COGNITIVE_STATES.TOOL_CALL]: {
    label: 'Executing Tools',
    icon: 'tool_call',
    emoji: '🛠️',
    description: 'Modifying files & running commands',
  },
  [COGNITIVE_STATES.SWARM]: {
    label: 'Agent Swarm Coordination',
    icon: 'swarm',
    emoji: '⚡',
    description: 'Orchestrating multi-agent topology',
  },
  [COGNITIVE_STATES.VERIFYING]: {
    label: 'Deterministic Verification',
    icon: 'verifying',
    emoji: '🛡️',
    description: 'Running test suites (Exit Code 0)',
  },
  [COGNITIVE_STATES.REVIEWING]: {
    label: 'Auditing Architecture',
    icon: 'reviewing',
    emoji: '🔍',
    description: 'Zero-trust diff & policy review',
  },
});
