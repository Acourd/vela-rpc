/**
 * Acourd RPC — Generic Client Helper
 * Lightweight HTTP client for posting agent events to the local micro-daemon.
 * Fast, non-blocking (< 15ms response), with automatic background daemon spawn.
 */

import http from 'node:http';
import { DAEMON_CONFIG } from '../core/constants.js';
import { AcourdDaemon } from '../core/daemon.js';

export class AcourdClient {
  constructor(options = {}) {
    this.port = options.port || DAEMON_CONFIG.DEFAULT_PORT;
    this.host = options.host || DAEMON_CONFIG.DEFAULT_HOST;
    this.timeoutMs = options.timeoutMs || 1000;
  }

  /**
   * Posts an event payload to the local daemon with optional auto-spawn.
   */
  async sendEvent(event, autoSpawn = true) {
    try {
      return await this._post('/event', event);
    } catch (err) {
      if (autoSpawn) {
        try {
          await AcourdDaemon.ensureRunning({ port: this.port, host: this.host });
          return await this._post('/event', event);
        } catch (spawnErr) {
          return { ok: false, error: spawnErr.message };
        }
      }
      return { ok: false, error: err.message };
    }
  }

  /**
   * Requests daemon to clear presence.
   */
  async clear() {
    try {
      return await this._post('/clear', {});
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Fetches daemon status and Discord IPC health.
   */
  async getStatus() {
    return new Promise((resolve) => {
      const req = http.get(`http://${this.host}:${this.port}/status`, { timeout: this.timeoutMs }, (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw));
          } catch (e) {
            resolve({ ok: false, error: e.message });
          }
        });
      });

      req.on('error', (err) => resolve({ ok: false, error: err.message }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, error: 'Connection timed out' });
      });
    });
  }

  _post(endpoint, payload) {
    return new Promise((resolve, reject) => {
      const body = Buffer.from(JSON.stringify(payload || {}), 'utf8');
      const req = http.request(
        {
          hostname: this.host,
          port: this.port,
          path: endpoint,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': body.length,
          },
          timeout: this.timeoutMs,
        },
        (res) => {
          let raw = '';
          res.on('data', (c) => { raw += c; });
          res.on('end', () => {
            try {
              resolve(JSON.parse(raw));
            } catch (_) {
              resolve({ ok: res.statusCode === 200, raw });
            }
          });
        }
      );

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`HTTP POST ${endpoint} timed out`));
      });

      req.write(body);
      req.end();
    });
  }
}
