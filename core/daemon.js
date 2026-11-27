/**
 * Acourd RPC — Micro-Daemon HTTP Server
 * Local loopback HTTP server (127.0.0.1:19452) maintaining persistent Discord RPC
 * while serving ephemeral (< 15ms) POST events from CLI hooks and extension sidecars.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DAEMON_CONFIG, DEFAULT_CLIENT_ID, KNOWN_CLIENT_IDS } from './constants.js';
import { DiscordIPC } from './discord-ipc.js';
import { StateEngine } from './state-engine.js';
import { ConfigManager, PRESETS } from './templates.js';
import { resolveHarness } from './harnesses.js';
import { detectDynamicModel } from './model-detector.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class AcourdDaemon extends EventEmitter {
  constructor(options = {}) {
    super();
    this.port = options.port || DAEMON_CONFIG.DEFAULT_PORT;
    this.host = options.host || DAEMON_CONFIG.DEFAULT_HOST;
    this.clientId = options.clientId || DEFAULT_CLIENT_ID;
    this.explicitClientId = Boolean(options.clientId || options.customIpcPath);
    this.customIpcPath = options.customIpcPath || null;
    this.debounceMs = options.debounceMs;
    this.stealthMode = options.stealthMode || false;
    this.pidFile = options.pidFile !== undefined ? options.pidFile : null;
    this.configPath = options.configPath !== undefined
      ? options.configPath
      : (this.pidFile === false ? false : undefined);

    this.server = null;
    this.ipc = null;
    this.configManager = null;
    this.stateEngine = null;
    this.reconnectTimer = null;
    this.staleWatchdogTimer = null;
    this.staleTimeoutMs = options.staleTimeoutMs ?? (5 * 60 * 1000);
    this.lastActivityEventAt = 0;
    this.sessions = new Map(); // sessionKey -> { source, lastSeenAt }
    this.isShuttingDown = false;
    this.activeLease = null;
    this.startTime = Date.now();
  }

  /**
   * Starts both the HTTP server and Discord IPC connection.
   */
  async start() {
    this.configManager = new ConfigManager({ configPath: this.configPath });
    this.stateEngine = new StateEngine({
      debounceMs: this.debounceMs,
      stealthMode: this.stealthMode,
      config: this.configManager.getEffective(),
    });

    this.ipc = new DiscordIPC({
      clientId: this.clientId,
      customPath: this.customIpcPath,
    });

    // Pipe state engine emissions into Discord IPC (only if ready)
    this.stateEngine.on('activity', (activity) => {
      if (this.ipc && this.ipc.ready) {
        try {
          this.ipc.setActivity(activity);
        } catch (err) {
          // If IPC fails to write, schedule reconnect
          this._scheduleReconnect();
        }
      }
    });

    this._setupIpcEvents();
    await this._startHttpServer();
    this._writePidFile();
    this._startStaleWatchdog();

    // Connect to Discord (non-blocking for HTTP daemon start)
    this._connectIpc().catch(() => {
      this._scheduleReconnect();
    });

    return {
      port: this.port,
      host: this.host,
      pid: process.pid,
    };
  }

  _setupIpcEvents() {
    this.ipc.on('connect', (evt) => {
      this._clearReconnect();
    });

    this.ipc.on('ready', () => {
      // If we have an active or pending activity, send it now
      if (this.stateEngine && this.stateEngine.activeActivity && this.ipc && this.ipc.connected && this.ipc.ready) {
        try {
          this.ipc.setActivity(this.stateEngine.activeActivity);
        } catch (_) {}
      }
    });

    this.ipc.on('close', () => {
      if (!this.isShuttingDown) {
        this._scheduleReconnect();
      }
    });

    this.ipc.on('error', () => {
      if (!this.isShuttingDown) {
        this._scheduleReconnect();
      }
    });
  }

  async _connectIpc() {
    try {
      await this.ipc.connect();
    } catch (err) {
      this._scheduleReconnect();
    }
  }

  _scheduleReconnect() {
    if (this.reconnectTimer || this.isShuttingDown) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (!this.ipc.connected && !this.isShuttingDown) {
        await this._connectIpc();
      }
    }, 5000);
  }

  _clearReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  _startStaleWatchdog() {
    if (this.staleWatchdogTimer || !this.staleTimeoutMs || this.staleTimeoutMs <= 0) return;
    const intervalMs = Math.min(30_000, Math.max(5_000, Math.floor(this.staleTimeoutMs / 4)));
    this.staleWatchdogTimer = setInterval(() => {
      const now = Date.now();
      // Prune expired sessions
      for (const [key, sess] of this.sessions.entries()) {
        if (now - sess.lastSeenAt > this.staleTimeoutMs) {
          this.sessions.delete(key);
        }
      }
      // Clear ghost presence if no events received within staleTimeoutMs
      if (this.lastActivityEventAt > 0 && this.stateEngine?.activeActivity && (now - this.lastActivityEventAt) > this.staleTimeoutMs) {
        if (this.ipc && this.ipc.ready) {
          try { this.ipc.clearActivity(); } catch (_) {}
        }
        this.stateEngine.clear();
        this.activeLease = null;
        this.lastActivityEventAt = 0;
      }
    }, intervalMs);
    this.staleWatchdogTimer.unref?.();
  }

  _stopStaleWatchdog() {
    if (this.staleWatchdogTimer) {
      clearInterval(this.staleWatchdogTimer);
      this.staleWatchdogTimer = null;
    }
  }

  _startHttpServer() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this._handleHttpRequest(req, res);
      });

      this.server.once('error', (err) => {
        reject(err);
      });

      this.server.listen(this.port, this.host, () => {
        resolve();
      });
    });
  }

  _handleHttpRequest(req, res) {
    // Only accept local connections
    const remote = req.socket.remoteAddress;
    if (remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden: loopback only' }));
      return;
    }

    // Allow local studio/preview.html to communicate with loopback daemon
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    let pathname;
    try {
      const parsedUrl = new URL(req.url, `http://${this.host}:${this.port}`);
      pathname = parsedUrl.pathname;
    } catch (_) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Malformed request URL' }));
      return;
    }

    if (req.method === 'GET' && (pathname === '/status' || pathname === '/health')) {
      const status = {
        ok: true,
        service: 'acourd-rpc',
        pid: process.pid,
        uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
        ipc: {
          connected: Boolean(this.ipc && this.ipc.connected),
          ready: Boolean(this.ipc && this.ipc.ready),
          pipePath: this.ipc ? this.ipc.currentPath : null,
        },
        state: this.stateEngine ? this.stateEngine.currentState : 'unknown',
        config: this.configManager ? this.configManager.getEffective() : null,
        activity: this.stateEngine ? this.stateEngine.activeActivity : null,
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
      return;
    }

    if (req.method === 'GET' && pathname === '/config') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        config: this.configManager.getEffective(),
        presets: PRESETS,
      }));
      return;
    }

    if (req.method === 'POST' && pathname === '/config') {
      this._parseJsonBody(req, res, (patch) => {
        const effective = this.configManager.update(patch);
        const dispatchRes = this.stateEngine.setConfig(effective, true);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          config: effective,
          activity: this.stateEngine.activeActivity,
          dispatched: Boolean(dispatchRes && dispatchRes.sent),
        }));
      });
      return;
    }

    if (req.method === 'POST' && (pathname === '/event' || pathname === '/activity')) {
      this._parseJsonBody(req, res, async (payload) => {
        // Drop legacy pre-restart sidecar frames ("Active in Antigravity 2.0" / project "rpc")
        if (payload.details === 'Active in Antigravity 2.0' && payload.project === 'rpc') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, ignored: 'legacy_sidecar' }));
          return;
        }

        const harness = resolveHarness(payload);
        const source = payload.source || harness.id || 'antigravity';
        const canonicalSource = harness.id || source;
        const now = Date.now();
        this.lastActivityEventAt = now;

        const rawSessionId = payload.sessionId || payload.session_id || null;
        const sessionKey = rawSessionId ? `${canonicalSource}:${rawSessionId}` : canonicalSource;
        const normalizedEventState = String(payload.state || payload.cognitiveState || 'idle').toLowerCase();
        const isIdleEvent = normalizedEventState === 'idle';

        // Migrate anonymous session entry when an identified session for the same harness arrives
        if (rawSessionId && this.sessions.has(canonicalSource)) {
          this.sessions.delete(canonicalSource);
          if (this.activeLease && this.activeLease.sessionKey === canonicalSource) {
            this.activeLease = null;
          }
        }

        // Enrich with real dynamic model detection if payload omitted model (preserve explicit null)
        const dynamicModel = payload.model !== undefined
          ? payload.model
          : detectDynamicModel(harness.id, payload);
        const enrichedPayload = { ...payload, ...(rawSessionId ? { sessionId: rawSessionId } : {}), model: dynamicModel ?? null };

        // Rule 1: Session release / teardown with deterministic failover or clean clear
        if (payload.releaseLease) {
          this.sessions.delete(sessionKey);
          const wasActiveOwner = Boolean(this.activeLease && this.activeLease.sessionKey === sessionKey);

          if (!wasActiveOwner && this.activeLease && now < this.activeLease.expiresAt && this.sessions.has(this.activeLease.sessionKey)) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, released: true, keptActiveSession: this.activeLease.sessionKey }));
            return;
          }

          // Promote most recent live remaining session (preferring active non-idle over idle)
          const remaining = [...this.sessions.values()].sort((a, b) => {
            if (a.active !== b.active) return a.active ? -1 : 1;
            return b.lastSeenAt - a.lastSeenAt;
          });

          if (remaining.length > 0) {
            const winner = remaining[0];
            this.activeLease = winner.active
              ? { sessionKey: winner.sessionKey, source: winner.source, expiresAt: now + 90_000 }
              : null;
            const failoverResult = this.stateEngine.processEvent({ ...winner.payload, forceImmediate: true });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, released: true, promotedSession: winner.sessionKey, ...failoverResult }));
            return;
          }

          // No live sessions remain: clear active presence cleanly (zero ghost/wrong activity)
          this.activeLease = null;
          if (this.ipc && this.ipc.ready) {
            try { this.ipc.clearActivity(); } catch (_) {}
          }
          if (this.stateEngine) {
            this.stateEngine.clear();
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, released: true, cleared: true }));
          return;
        }

        // Track live session state
        this.sessions.set(sessionKey, {
          sessionKey,
          source,
          active: !isIdleEvent,
          payload: enrichedPayload,
          lastSeenAt: now,
        });

        // Rule 2: Never let an idle session displace another live active session holding a valid lease
        if (
          isIdleEvent &&
          this.activeLease &&
          this.activeLease.sessionKey !== sessionKey &&
          now < this.activeLease.expiresAt &&
          this.sessions.has(this.activeLease.sessionKey)
        ) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            deferred: true,
            activeSource: this.activeLease.source,
            activeSessionKey: this.activeLease.sessionKey,
          }));
          return;
        }

        if (!isIdleEvent) {
          this.activeLease = { sessionKey, source, expiresAt: now + 90_000 };
        } else if (this.activeLease && this.activeLease.sessionKey === sessionKey) {
          this.activeLease = null;
        }

        const configuredIds = this.configManager?.getEffective()?.clientIds || {};
        const targetClientId = payload.clientId
          || configuredIds[harness.id]
          || configuredIds[source]
          || (source === 'claude' ? KNOWN_CLIENT_IDS.CLAUDE_CODE : (process.env.DISCORD_CLIENT_ID || harness.defaultClientId));

        const needsClientSwitch = !this.explicitClientId && this.ipc && this.ipc.clientId !== targetClientId;

        // Process event first so stateEngine.activeActivity is ready when the new IPC handshake finishes
        const result = this.stateEngine.processEvent(
          needsClientSwitch ? { ...enrichedPayload, forceImmediate: true } : enrichedPayload
        );

        if (needsClientSwitch) {
          this.ipc.clientId = targetClientId;
          if (this.ipc.connected) {
            this.ipc.disconnect();
          }
          this._connectIpc().catch(() => {});
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ...result }));
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/clear') {
      if (this.ipc && this.ipc.ready) {
        try {
          this.ipc.clearActivity();
        } catch (_) {}
      }
      if (this.stateEngine) {
        this.stateEngine.clear();
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, cleared: true }));
      return;
    }

    if (req.method === 'POST' && pathname === '/stop') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, stopping: true }));
      setImmediate(() => this.stop());
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint not found' }));
  }

  _parseJsonBody(req, res, callback) {
    let raw = '';
    let exceeded = false;

    req.on('data', (chunk) => {
      if (exceeded) return;
      raw += chunk;
      if (raw.length > DAEMON_CONFIG.MAX_PAYLOAD_SIZE_BYTES) {
        exceeded = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload too large' }));
        req.destroy();
      }
    });

    req.on('error', () => {});

    req.on('end', () => {
      if (exceeded) return;
      try {
        const data = raw.trim() ? JSON.parse(raw) : {};
        callback(data);
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
      }
    });
  }

  static getPidFilePath() {
    const dir = path.join(os.homedir(), '.acourd');
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (_) {}
    }
    return path.join(dir, DAEMON_CONFIG.PID_FILE_NAME);
  }

  _writePidFile() {
    if (this.pidFile === false) return;
    try {
      const pidPath = typeof this.pidFile === 'string' ? this.pidFile : AcourdDaemon.getPidFilePath();
      fs.writeFileSync(pidPath, JSON.stringify({ pid: process.pid, port: this.port, time: Date.now() }));
    } catch (_) {}
  }

  _removePidFile() {
    if (this.pidFile === false) return;
    try {
      const pidPath = typeof this.pidFile === 'string' ? this.pidFile : AcourdDaemon.getPidFilePath();
      if (fs.existsSync(pidPath)) {
        fs.unlinkSync(pidPath);
      }
    } catch (_) {}
  }

  /**
   * Graceful shutdown of HTTP server, IPC, timers, and PID file.
   */
  async stop() {
    this.isShuttingDown = true;
    this._clearReconnect();
    this._stopStaleWatchdog();

    if (this.stateEngine) {
      this.stateEngine.destroy();
    }

    if (this.ipc) {
      if (this.ipc.ready) {
        try {
          this.ipc.clearActivity();
        } catch (_) {}
      }
      this.ipc.disconnect();
    }

    if (this.server) {
      this.server.closeAllConnections?.();
      await new Promise((resolve) => this.server.close(resolve));
      this.server = null;
    }

    this._removePidFile();
    this.emit('stop');
    return { ok: true };
  }

  /**
   * Helper: checks if daemon is running on port.
   */
  static isRunning(port = DAEMON_CONFIG.DEFAULT_PORT, host = DAEMON_CONFIG.DEFAULT_HOST) {
    return new Promise((resolve) => {
      const req = http.get(`http://${host}:${port}/status`, { timeout: 800 }, (res) => {
        let raw = '';
        res.on('data', (d) => { raw += d; });
        res.on('end', () => {
          try {
            const data = JSON.parse(raw);
            resolve(Boolean(data && data.ok));
          } catch (_) {
            resolve(false);
          }
        });
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  /**
   * Helper: ensures daemon is running, spawning detached process if absent.
   */
  static async ensureRunning(options = {}) {
    const port = options.port || DAEMON_CONFIG.DEFAULT_PORT;
    const host = options.host || DAEMON_CONFIG.DEFAULT_HOST;

    const alreadyRunning = await AcourdDaemon.isRunning(port, host);
    if (alreadyRunning) {
      return { spawned: false, running: true };
    }

    // Spawn detached daemon process
    const cliPath = path.resolve(__dirname, '../bin/acourd.js');
    const child = spawn(process.execPath, [cliPath, 'daemon'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();

    // Poll until ready (max 3000ms)
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
      if (await AcourdDaemon.isRunning(port, host)) {
        return { spawned: true, running: true, pid: child.pid };
      }
    }

    throw new Error('Failed to autospawn Acourd RPC daemon within timeout.');
  }
}
