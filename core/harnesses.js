/**
 * Acourd RPC — Unified AI Harness Registry
 * Canonical definitions, capitalized branding, icon asset keys, and Discord Client ID routing
 * for Antigravity 2.0, Antigravity IDE, Claude Code, Codex, OpenCode, OpenChamber, and Hermes.
 */

export const HARNESS_IDS = Object.freeze({
  ANTIGRAVITY_2: 'antigravity-2',
  ANTIGRAVITY_IDE: 'antigravity-ide',
  CLAUDE_CODE: 'claude-code',
  CODEX: 'codex',
  OPENCODE: 'opencode',
  OPENCHAMBER: 'openchamber',
  HERMES: 'hermes',
  KIMI_CODE: 'kimi-code',
  DEEPSEEK: 'deepseek',
  KIRO: 'kiro',
  MISTRAL_VIBE: 'mistral-vibe',
  FACTORY_DROID: 'factory-droid',
  AMP: 'amp',
});

export const HARNESSES = Object.freeze({
  [HARNESS_IDS.ANTIGRAVITY_2]: {
    id: HARNESS_IDS.ANTIGRAVITY_2,
    displayName: 'Antigravity 2.0',
    defaultClientId: '1440730997460172810',
    assetKey: 'antigravity_2_logo',
    assetFile: 'assets/antigravity_logo.png',
    defaultModel: 'Gemini 4 Argon',
    category: 'Agent Manager (Desktop)',
  },
  [HARNESS_IDS.ANTIGRAVITY_IDE]: {
    id: HARNESS_IDS.ANTIGRAVITY_IDE,
    displayName: 'Antigravity IDE',
    defaultClientId: '1440730997460172810',
    assetKey: 'antigravity_ide_logo',
    assetFile: 'assets/antigravity_ide_logo.png',
    defaultModel: 'Gemini 4 Neon',
    category: 'Code Editor (VS Code Fork)',
  },
  [HARNESS_IDS.CLAUDE_CODE]: {
    id: HARNESS_IDS.CLAUDE_CODE,
    displayName: 'Claude Code',
    defaultClientId: '1472915568930848829',
    assetKey: 'claude-code',
    assetFile: 'assets/claude_logo.png',
    defaultModel: 'Claude Fable 5.2',
    category: 'CLI & IDE Agent (Anthropic)',
  },
  [HARNESS_IDS.CODEX]: {
    id: HARNESS_IDS.CODEX,
    displayName: 'Codex',
    defaultClientId: '1440730997460172810',
    assetKey: 'codex_logo',
    assetFile: 'assets/codex_logo.png',
    defaultModel: 'GPT-6.2 Sol',
    category: 'CLI & Desktop Agent (OpenAI)',
  },
  [HARNESS_IDS.OPENCODE]: {
    id: HARNESS_IDS.OPENCODE,
    displayName: 'OpenCode',
    defaultClientId: '1440730997460172810',
    assetKey: 'opencode_logo',
    assetFile: 'assets/opencode_logo.png',
    defaultModel: 'Claude Sonnet 5.5',
    category: 'Open-Source Terminal Agent',
  },
  [HARNESS_IDS.OPENCHAMBER]: {
    id: HARNESS_IDS.OPENCHAMBER,
    displayName: 'OpenChamber',
    defaultClientId: '1440730997460172810',
    assetKey: 'openchamber_logo',
    assetFile: 'assets/openchamber_logo.png',
    defaultModel: 'Claude Opus 5.5',
    category: 'Agentic Development Workspace',
  },
  [HARNESS_IDS.HERMES]: {
    id: HARNESS_IDS.HERMES,
    displayName: 'Hermes',
    defaultClientId: '1440730997460172810',
    assetKey: 'hermes_logo',
    assetFile: 'assets/hermes_logo.png',
    defaultModel: 'Hermes 4.3',
    category: 'Nous Research Agent Framework',
  },
  [HARNESS_IDS.KIMI_CODE]: {
    id: HARNESS_IDS.KIMI_CODE,
    displayName: 'Kimi Code',
    defaultClientId: '1440730997460172810',
    assetKey: 'kimi_logo',
    assetFile: 'assets/kimi_logo.png',
    defaultModel: 'Kimi K3.1 Pro',
    category: 'Moonshot AI Terminal Agent',
  },
  [HARNESS_IDS.DEEPSEEK]: {
    id: HARNESS_IDS.DEEPSEEK,
    displayName: 'DeepSeek',
    defaultClientId: '1440730997460172810',
    assetKey: 'deepseek_logo',
    assetFile: 'assets/deepseek_logo.png',
    defaultModel: 'DeepSeek V4 Pro',
    category: 'DeepSeek Coding Harness & CLI',
  },
  [HARNESS_IDS.KIRO]: {
    id: HARNESS_IDS.KIRO,
    displayName: 'Kiro',
    defaultClientId: '1440730997460172810',
    assetKey: 'kiro_logo',
    assetFile: 'assets/kiro_logo.png',
    defaultModel: 'Claude Sonnet 5.5',
    category: 'AWS Spec-Driven Agentic IDE',
  },
  [HARNESS_IDS.MISTRAL_VIBE]: {
    id: HARNESS_IDS.MISTRAL_VIBE,
    displayName: 'Mistral Vibe',
    defaultClientId: '1440730997460172810',
    assetKey: 'mistral_logo',
    assetFile: 'assets/mistral_logo.png',
    defaultModel: 'Devstral 2',
    category: 'Mistral AI Terminal Coding Agent',
  },
  [HARNESS_IDS.FACTORY_DROID]: {
    id: HARNESS_IDS.FACTORY_DROID,
    displayName: 'Factory Droid',
    defaultClientId: '1440730997460172810',
    assetKey: 'droid_logo',
    assetFile: 'assets/droid_logo.png',
    defaultModel: 'GPT-6 Astra',
    category: 'Factory AI Autonomous Droids',
  },
  [HARNESS_IDS.AMP]: {
    id: HARNESS_IDS.AMP,
    displayName: 'Amp',
    defaultClientId: '1440730997460172810',
    assetKey: 'amp_logo',
    assetFile: 'assets/amp_logo.png',
    defaultModel: 'Claude Opus 5.5',
    category: 'Sourcegraph Agentic Coding Tool',
  },
});

/**
 * Resolves a harness definition from an event payload (`source`, `harness`, or `agentName`).
 */
export function resolveHarness(payload = {}) {
  const safe = (payload && typeof payload === 'object') ? payload : {};
  const raw = String(safe.harness || safe.source || safe.agentName || '').toLowerCase();

  if (raw.includes('openchamber')) return HARNESSES[HARNESS_IDS.OPENCHAMBER];
  if (raw.includes('opencode')) return HARNESSES[HARNESS_IDS.OPENCODE];
  if (raw.includes('codex')) return HARNESSES[HARNESS_IDS.CODEX];
  if (raw.includes('hermes')) return HARNESSES[HARNESS_IDS.HERMES];
  if (raw.includes('kimi')) return HARNESSES[HARNESS_IDS.KIMI_CODE];
  if (raw.includes('deepseek')) return HARNESSES[HARNESS_IDS.DEEPSEEK];
  if (raw.includes('kiro')) return HARNESSES[HARNESS_IDS.KIRO];
  if (raw.includes('mistral') || raw.includes('vibe')) return HARNESSES[HARNESS_IDS.MISTRAL_VIBE];
  if (raw.includes('droid') || raw.includes('factory')) return HARNESSES[HARNESS_IDS.FACTORY_DROID];
  if (raw.includes('amp') || raw.includes('sourcegraph')) return HARNESSES[HARNESS_IDS.AMP];
  if (raw.includes('claude')) return HARNESSES[HARNESS_IDS.CLAUDE_CODE];
  if (raw.includes('antigravity') && raw.includes('ide')) return HARNESSES[HARNESS_IDS.ANTIGRAVITY_IDE];
  return HARNESSES[HARNESS_IDS.ANTIGRAVITY_2];
}
