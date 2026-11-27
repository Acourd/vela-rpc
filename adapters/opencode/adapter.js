/**
 * Acourd RPC — OpenCode Adapter
 * Translates OpenCode CLI / v2 Desktop session events into minimalist Acourd payloads.
 */

import path from 'node:path';
import { COGNITIVE_STATES } from '../../core/constants.js';
import { HARNESS_IDS, HARNESSES } from '../../core/harnesses.js';
import { formatModelName } from '../../core/antigravity-telemetry.js';

export function translateOpenCodeEvent(eventType, payload = {}, cwd = process.cwd()) {
  const harness = HARNESSES[HARNESS_IDS.OPENCODE];
  const project = payload.project || path.basename(payload.cwd || cwd) || 'Workspace';
  const model = formatModelName(payload.model || harness.defaultModel);
  const type = String(eventType || payload.status || 'working').toLowerCase();

  let state = COGNITIVE_STATES.THINKING;
  if (type === 'idle' || type === 'asking' || type === 'end') state = COGNITIVE_STATES.IDLE;
  else if (type === 'tool' || type === 'build' || type === 'coding') state = COGNITIVE_STATES.TOOL_CALL;
  else if (type === 'compaction' || type === 'review') state = COGNITIVE_STATES.REVIEWING;

  return {
    source: harness.id,
    harness: harness.id,
    agentName: harness.displayName,
    state,
    model,
    project,
    branch: payload.branch || undefined,
    chatTitle: payload.chatTitle || payload.title || payload.task || undefined,
    details: payload.details || undefined,
    largeImage: harness.assetKey,
    largeText: harness.displayName,
    releaseLease: type === 'end',
  };
}
