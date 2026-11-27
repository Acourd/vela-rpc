/**
 * Acourd RPC — DeepSeek Coding Harness Adapter
 * Privacy-first event translator for `deepseek-harness` / DeepSeek CLI sessions. Never exposes prompt text.
 */

import path from 'node:path';
import { COGNITIVE_STATES } from '../../core/constants.js';
import { HARNESS_IDS, HARNESSES } from '../../core/harnesses.js';
import { formatModelName, detectGitBranch } from '../../core/antigravity-telemetry.js';
import { detectDynamicModel } from '../../core/model-detector.js';

export function translateDeepSeekEvent(eventType, payload = {}, cwd = process.cwd(), options = {}) {
  const safePayload = (payload && typeof payload === 'object') ? payload : {};
  const harness = HARNESSES[HARNESS_IDS.DEEPSEEK];
  const effectiveCwd = safePayload.cwd || cwd || process.cwd();
  const project = safePayload.project || path.basename(effectiveCwd) || 'Workspace';
  const branch = safePayload.branch || detectGitBranch(effectiveCwd) || undefined;
  const model = detectDynamicModel(harness.id, safePayload, options) || null;
  const type = String(eventType || safePayload.status || 'working').toLowerCase();

  let state = COGNITIVE_STATES.THINKING;
  if (type === 'idle' || type === 'end' || type === 'stop') state = COGNITIVE_STATES.IDLE;
  else if (type === 'tool' || type === 'exec' || type === 'edit') state = COGNITIVE_STATES.TOOL_CALL;
  else if (type === 'verify' || type === 'test') state = COGNITIVE_STATES.VERIFYING;

  const sessionTitle = (payload.chatTitle || payload.sessionTitle || payload.title || '').trim() || undefined;

  return {
    source: harness.id,
    harness: harness.id,
    sessionId: payload.sessionId || payload.session_id || undefined,
    agentName: harness.displayName,
    state,
    model,
    project,
    ...(branch ? { branch } : {}),
    ...(sessionTitle ? { chatTitle: sessionTitle } : {}),
    details: sessionTitle || project,
    largeImage: harness.assetKey,
    largeText: harness.displayName,
    resetTimer: type === 'start' || type === 'session:start',
    releaseLease: type === 'end' || type === 'session:end',
    forceImmediate: type === 'start' || type === 'end' || type === 'session:end',
  };
}
