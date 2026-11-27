/**
 * Acourd RPC — OpenAI Codex Adapter
 * Translates Codex CLI, VS Code extension, and Codex Desktop session events
 * into minimalist Acourd Rich Presence payloads.
 */

import path from 'node:path';
import { COGNITIVE_STATES } from '../../core/constants.js';
import { HARNESS_IDS, HARNESSES } from '../../core/harnesses.js';
import { formatModelName } from '../../core/antigravity-telemetry.js';
import { detectDynamicModel } from '../../core/model-detector.js';

export function translateCodexEvent(eventType, payload = {}, cwd = process.cwd(), options = {}) {
  const safePayload = (payload && typeof payload === 'object') ? payload : {};
  const harness = HARNESSES[HARNESS_IDS.CODEX];
  const project = safePayload.project || path.basename(safePayload.cwd || cwd) || 'Workspace';
  const model = detectDynamicModel(harness.id, safePayload, options) || null;
  const type = String(eventType || safePayload.type || 'working').toLowerCase();

  let state = COGNITIVE_STATES.THINKING;
  if (type === 'idle' || type === 'stop' || type === 'end') state = COGNITIVE_STATES.IDLE;
  else if (type === 'tool' || type === 'exec' || type === 'edit') state = COGNITIVE_STATES.TOOL_CALL;
  else if (type === 'verify' || type === 'test') state = COGNITIVE_STATES.VERIFYING;

  return {
    source: harness.id,
    harness: harness.id,
    sessionId: safePayload.sessionId || safePayload.session_id || undefined,
    agentName: harness.displayName,
    state,
    model,
    project,
    branch: safePayload.branch || undefined,
    chatTitle: safePayload.chatTitle || safePayload.sessionTitle || safePayload.task || undefined,
    details: safePayload.details || undefined,
    largeImage: harness.assetKey,
    largeText: harness.displayName,
    releaseLease: type === 'end',
  };
}
