/**
 * Acourd RPC — Micro-Daemon HTTP Server
 * Local loopback HTTP server (127.0.0.1:19452) maintaining persistent Discord RPC
 * while serving ephemeral (< 15ms) POST events from CLI hooks and extension sidecars.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DAEMON_CONFIG, DEFAULT_CLIENT_ID } from './constants.js';
import { DiscordIPC } from './discord-ipc.js';
import { StateEngine } from './state-engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class AcourdDaemon {
  constructor(options = {}) {
    this.port = options.port || DAEMON_CONFIG.DEFAULT_PORT;
    this.host = options.host || DAEMON_CONFIG.DEFAULT_HOST;
    this.clientId = options.clientId || DEFAULT_CLIENT_ID;
    this.customIpcPath = options.customIpcPath || null;
    this.debounceMs = options.debounceMs;
    this.stealthMode = options.stealthMode || false;

    this.server = null;
    this.ipc = null;
    this.stateEngine = null;
    this.reconnectTimer = null;
    this.isShuttingDown = false;
    this.startTime = Date.now();
  }

  /**
   * Starts both the HTTP server and Discord IPC connection.
   */
  async start() {
    this.stateEngine = new StateEngine({
      debounceMs: this.debounceMs,
      stealthMode: this.stealthMode,
    });

    this.ipc = new DiscordIPC({
      clientId: this.clientId,
      customPath: this.customIpcPath,
    });

    // Pipe state engine emissions into Discord IPC
    this.stateEngine.on('activity', (activity) => {
      if (this.ipc && this.ipc.connected) {
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
      if (this.stateEngine && this.stateEngine.activeActivity) {
        this.ipc.setActivity(this.stateEngine.activeActivity);
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

    const { pathname } = new URL(req.url, `http://${this.host}:${this.port}`);

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
        activity: this.stateEngine ? this.stateEngine.activeActivity : null,
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
      return;
    }

    if (req.method === 'POST' && (pathname === '/event' || pathname === '/activity')) {
      this._parseJsonBody(req, res, (payload) => {
        const result = this.stateEngine.processEvent(payload);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ...result }));
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/clear') {
      if (this.ipc && this.ipc.connected) {
        this.ipc.clearActivity();
      }
      if (this.stateEngine) {
        this.stateEngine.activeActivity = null;
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
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > DAEMON_CONFIG.MAX_PAYLOAD_SIZE_BYTES) {
        req.destroy();
      }
    });

    req.on('end', () => {
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
    try {
      const pidPath = AcourdDaemon.getPidFilePath();
      fs.writeFileSync(pidPath, JSON.stringify({ pid: process.pid, port: this.port, time: Date.now() }));
    } catch (_) {}
  }

  _removePidFile() {
    try {
      const pidPath = AcourdDaemon.getPidFilePath();
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

    if (this.stateEngine) {
      this.stateEngine.destroy();
    }

    if (this.ipc) {
      if (this.ipc.connected) {
        try {
          this.ipc.clearActivity();
        } catch (_) {}
      }
      this.ipc.disconnect();
    }

    if (this.server) {
      await new Promise((resolve) => this.server.close(resolve));
      this.server = null;
    }

    this._removePidFile();
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
