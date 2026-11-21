/**
 * Acourd RPC — Google Antigravity 2.0 Adapter
 * Translates Antigravity agent lifecycle, subagent swarms, tool calls, and physical oracle verifications
 * into Discord Rich Presence activities.
 */

import path from 'node:path';
import { AcourdClient } from '../generic-client.js';
import { COGNITIVE_STATES } from '../../core/constants.js';

export function translateAntigravityEvent(actionName, context = {}) {
  const project = context.project || path.basename(context.workspace || process.cwd()) || 'Antigravity Workspace';
  const branch = context.branch || 'main';
  const action = String(actionName || 'idle').toLowerCase();

  switch (action) {
    case 'taskstart':
    case 'task_start':
    case 'intent':
      return {
        state: COGNITIVE_STATES.THINKING,
        project,
        branch,
        agentName: 'Google Antigravity 2.0',
        details: context.task ? `Intent: ${context.task.slice(0, 48)}` : 'Architectural reasoning & planning',
        largeImage: 'antigravity_logo',
        largeText: 'Google Antigravity 2.0 • Autonomous Engine',
      };

    case 'tool':
    case 'tool_call':
    case 'edit':
    case 'command': {
      const toolDesc = context.description || (context.tool ? `Running ${context.tool}` : 'Executing tool');
      return {
        state: COGNITIVE_STATES.TOOL_CALL,
        project,
        branch,
        agentName: 'Google Antigravity 2.0',
        tool: context.tool,
        details: toolDesc,
        largeImage: 'antigravity_logo',
      };
    }

    case 'swarm':
    case 'subagent':
    case 'dispatch': {
      const agentRole = context.subagentRole || context.role || 'Worker';
      return {
        state: COGNITIVE_STATES.SWARM,
        project,
        branch,
        agentName: 'Google Antigravity 2.0',
        details: `Directing Swarm: [${agentRole}]`,
        largeImage: 'antigravity_logo',
      };
    }

    case 'verify':
    case 'verification':
    case 'test':
      return {
        state: COGNITIVE_STATES.VERIFYING,
        project,
        branch,
        agentName: 'Google Antigravity 2.0',
        details: context.summary || 'Oracle verification (Exit Code 0)',
        largeImage: 'antigravity_logo',
      };

    case 'review':
    case 'audit':
      return {
        state: COGNITIVE_STATES.REVIEWING,
        project,
        branch,
        agentName: 'Google Antigravity 2.0',
        details: 'Reviewing diff & zero-trust boundaries',
        largeImage: 'antigravity_logo',
      };

    case 'idle':
    case 'finish':
    case 'stop':
      return {
        state: COGNITIVE_STATES.IDLE,
        project,
        branch,
        agentName: 'Google Antigravity 2.0',
        details: 'Mission accomplished • Standing by',
        largeImage: 'antigravity_logo',
        forceImmediate: true,
      };

    default:
      return {
        state: COGNITIVE_STATES.IDLE,
        project,
        branch,
        agentName: 'Google Antigravity 2.0',
        details: `Active in ${project}`,
        largeImage: 'antigravity_logo',
      };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const action = args[0] || 'idle';
  const detail = args[1] || '';

  const client = new AcourdClient();
  const event = translateAntigravityEvent(action, {
    description: detail,
    task: detail,
    workspace: process.cwd(),
  });

  await client.sendEvent(event, true);
  process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith('hook.js') && process.argv[1].includes('antigravity')) {
  main().catch(() => process.exit(0));
}
