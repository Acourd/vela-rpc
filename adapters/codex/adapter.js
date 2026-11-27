/**
 * Acourd RPC — OpenAI Codex Adapter
 * Translates Codex CLI, VS Code extension, and Codex Desktop session events
 * into minimalist Acourd Rich Presence payloads.
 */

import path from 'node:path';
import { COGNITIVE_STATES } from '../../core/constants.js';
import { HARNESS_IDS, HARNESSES } from '../../core/harnesses.js';
import { formatModelName } from '../../core/antigravity-telemetry.js';

export function translateCodexEvent(eventType, payload = {}, cwd = process.cwd()) {
  const harness = HARNESSES[HARNESS_IDS.CODEX];
  const project = payload.project || path.basename(payload.cwd || cwd) || 'Workspace';
  const model = formatModelName(payload.model || process.env.CODEX_MODEL || harness.defaultModel);
  const type = String(eventType || payload.type || 'working').toLowerCase();

  let state = COGNITIVE_STATES.THINKING;
  if (type === 'idle' || type === 'stop' || type === 'end') state = COGNITIVE_STATES.IDLE;
  else if (type === 'tool' || type === 'exec' || type === 'edit') state = COGNITIVE_STATES.TOOL_CALL;
  else if (type === 'verify' || type === 'test') state = COGNITIVE_STATES.VERIFYING;

  return {
    source: harness.id,
    harness: harness.id,
    agentName: harness.displayName,
    state,
    model,
    project,
    branch: payload.branch || undefined,
    chatTitle: payload.chatTitle || payload.sessionTitle || payload.task || undefined,
    details: payload.details || undefined,
    largeImage: harness.assetKey,
    largeText: harness.displayName,
    releaseLease: type === 'end',
  };
}
