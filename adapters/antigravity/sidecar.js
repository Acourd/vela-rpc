/**
 * Acourd RPC — Antigravity Workspace Sidecar
 * Automatically detects current Git repository, active branch, and provides continuous
 * presence heartbeat for Antigravity IDE and CLI sessions.
 */

import { execSync } from 'node:child_process';
import path from 'node:path';
import { AcourdClient } from '../generic-client.js';
import { COGNITIVE_STATES } from '../../core/constants.js';

export class AntigravitySidecar {
  constructor(options = {}) {
    this.workspaceDir = options.workspaceDir || process.cwd();
    this.pollIntervalMs = options.pollIntervalMs || 30000;
    this.client = new AcourdClient();
    this.timer = null;
    this.lastBranch = null;
  }

  detectGitInfo() {
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: this.workspaceDir,
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8',
        timeout: 1000,
      }).trim();
      return branch || 'main';
    } catch (_) {
      return 'main';
    }
  }

  async heartbeat() {
    const branch = this.detectGitInfo();
    const projectName = path.basename(this.workspaceDir) || 'Project';

    await this.client.sendEvent({
      state: COGNITIVE_STATES.IDLE,
      project: projectName,
      branch,
      agentName: 'Google Antigravity 2.0',
      details: 'Active in IDE • Ready for missions',
      largeImage: 'antigravity_logo',
    });
  }

  start() {
    this.heartbeat();
    this.timer = setInterval(() => this.heartbeat(), this.pollIntervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
