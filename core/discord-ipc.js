/**
 * Acourd RPC — Pure IPC Transport
 * Zero-Bloat Discord IPC client for Windows Named Pipes and Unix Domain Sockets.
 * 8-byte Little-Endian binary framing with defragmenting chunk accumulator.
 */

import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { OPCODES, RPC_COMMANDS, RPC_EVENTS, DEFAULT_CLIENT_ID, DAEMON_CONFIG } from './constants.js';

export class DiscordIPC extends EventEmitter {
  constructor(options = {}) {
    super();
    this.clientId = options.clientId || DEFAULT_CLIENT_ID;
    this.customPath = options.customPath || null;
    this.socket = null;
    this.workingBuffer = Buffer.alloc(0);
    this.connected = false;
    this.ready = false;
    this.currentPath = null;
    this.nonceCounter = 0;
  }

  /**
   * Generates a deterministic or monotonic nonce.
   */
  nextNonce() {
    this.nonceCounter += 1;
    return `${Date.now()}-${this.nonceCounter}`;
  }

  /**
   * Returns list of candidate IPC paths for the current operating system.
   */
  static getAvailablePaths() {
    const isWindows = process.platform === 'win32';
    const paths = [];

    if (isWindows) {
      for (let i = 0; i < 10; i += 1) {
        paths.push(`\\\\.\\pipe\\discord-ipc-${i}`);
      }
      for (let i = 0; i < 10; i += 1) {
        paths.push(`\\\\?\\pipe\\discord-ipc-${i}`);
      }
      return Array.from(new Set(paths));
    }

    // Unix paths (macOS, Linux, Flatpak, Vesktop, Snap)
    const baseDirs = [
      process.env.XDG_RUNTIME_DIR,
      process.env.TMPDIR,
      process.env.TMP,
      process.env.TEMP,
      '/tmp',
    ].filter(Boolean);

    const subDirs = [
      '',
      'app/com.discordapp.Discord/',
      'app/dev.vencord.Vesktop/',
      'snap.discord/',
    ];

    for (const base of baseDirs) {
      for (const sub of subDirs) {
        for (let i = 0; i < 10; i += 1) {
          paths.push(path.join(base, sub, `discord-ipc-${i}`));
        }
      }
    }

    return Array.from(new Set(paths));
  }

  /**
   * Connects to Discord IPC. Scans available pipes unless customPath is set.
   */
  async connect() {
    if (this.connected) return;

    if (this.customPath) {
      return this._tryConnectPath(this.customPath);
    }

    const candidatePaths = DiscordIPC.getAvailablePaths();
    let lastError = null;

    for (const pipePath of candidatePaths) {
      try {
        await this._tryConnectPath(pipePath);
        return; // Connected successfully!
      } catch (err) {
        lastError = err;
      }
    }

    const failureErr = new Error(`Could not connect to Discord RPC on any pipe: ${lastError?.message || 'No Discord instance found'}`);
    if (this.listenerCount('error') > 0) {
      this.emit('error', failureErr);
    }
    throw failureErr;
  }

  /**
   * Attempts connection to a specific pipe/socket path with connection timeout.
   */
  _tryConnectPath(targetPath) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const sock = net.createConnection(targetPath);
      let timeoutTimer = null;

      const cleanup = () => {
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          timeoutTimer = null;
        }
        sock.removeAllListeners('connect');
        sock.removeAllListeners('error');
      };

      timeoutTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        sock.destroy();
        reject(new Error(`Connection to pipe ${targetPath} timed out`));
      }, DAEMON_CONFIG.SOCKET_CONNECT_TIMEOUT_MS);

      sock.once('connect', () => {
        if (settled) return;
        settled = true;
        cleanup();

        this.socket = sock;
        this.currentPath = targetPath;
        this.connected = true;
        this.workingBuffer = Buffer.alloc(0);

        this._setupSocketListeners();
        this._sendHandshake();

        this.emit('connect', { path: targetPath });
        resolve();
      });

      sock.once('error', (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        sock.destroy();
        reject(err);
      });
    });
  }

  /**
   * Sets up binary data streaming, chunk accumulation, and disconnection handlers.
   */
  _setupSocketListeners() {
    if (!this.socket) return;

    this.socket.on('data', (chunk) => {
      this.workingBuffer = Buffer.concat([this.workingBuffer, chunk]);
      this._processAccumulator();
    });

    this.socket.on('close', (hadError) => {
      const wasConnected = this.connected;
      this._teardown();
      if (wasConnected) {
        this.emit('close', { hadError });
      }
    });

    this.socket.on('error', (err) => {
      this.emit('error', err);
    });
  }

  /**
   * Little-Endian 8-byte framing de-fragmentation loop.
   */
  _processAccumulator() {
    while (this.workingBuffer.length >= 8) {
      const opcode = this.workingBuffer.readUInt32LE(0);
      const length = this.workingBuffer.readUInt32LE(4);

      if (length > DAEMON_CONFIG.MAX_PAYLOAD_SIZE_BYTES) {
        const sizeErr = new Error(`Frame length ${length} exceeds maximum safety limit (${DAEMON_CONFIG.MAX_PAYLOAD_SIZE_BYTES} bytes)`);
        if (this.listenerCount('error') > 0) {
          this.emit('error', sizeErr);
        }
        this.disconnect();
        break;
      }

      const totalFrameBytes = 8 + length;

      if (this.workingBuffer.length < totalFrameBytes) {
        // Frame is not yet fully received; wait for next chunk
        break;
      }

      const payloadSlice = this.workingBuffer.subarray(8, totalFrameBytes);
      this.workingBuffer = this.workingBuffer.subarray(totalFrameBytes);

      let payload = null;
      if (length > 0) {
        try {
          payload = JSON.parse(payloadSlice.toString('utf8'));
        } catch (parseErr) {
          const err = new Error(`Malformed JSON in frame opcode ${opcode}: ${parseErr.message}`);
          if (this.listenerCount('error') > 0) {
            this.emit('error', err);
          }
          continue;
        }
      }

      this._handleFrame(opcode, payload);
    }
  }

  /**
   * Handles parsed frames according to opcode.
   */
  _handleFrame(opcode, payload) {
    this.emit('frame', { opcode, payload });

    if (opcode === OPCODES.FRAME && payload) {
      if (payload.cmd === RPC_COMMANDS.DISPATCH && payload.evt === RPC_EVENTS.READY) {
        this.ready = true;
        this.emit('ready', payload.data);
      } else if (payload.evt === RPC_EVENTS.ERROR) {
        this.emit('rpc_error', payload.data);
      }
    } else if (opcode === OPCODES.PING) {
      this.send(OPCODES.PONG, payload || {});
    } else if (opcode === OPCODES.CLOSE) {
      this.emit('server_close', payload);
      this.disconnect();
    }
  }

  /**
   * Sends Opcode 0 (Handshake)
   */
  _sendHandshake() {
    const handshakePayload = {
      v: 1,
      client_id: this.clientId,
    };
    this.send(OPCODES.HANDSHAKE, handshakePayload);
  }

  /**
   * Encodes and transmits an 8-byte LE framed binary packet.
   */
  send(opcode, payload) {
    if (!this.socket || !this.connected) {
      throw new Error('Cannot send frame: Discord IPC socket is not connected');
    }

    const jsonStr = JSON.stringify(payload ?? {});
    const payloadBuffer = Buffer.from(jsonStr, 'utf8');
    const headerBuffer = Buffer.alloc(8);

    headerBuffer.writeUInt32LE(opcode, 0);
    headerBuffer.writeUInt32LE(payloadBuffer.length, 4);

    const frameBuffer = Buffer.concat([headerBuffer, payloadBuffer]);
    this.socket.write(frameBuffer);
  }

  /**
   * Sends SET_ACTIVITY command.
   */
  setActivity(activity = null, pid = null) {
    const nonce = this.nextNonce();
    const packet = {
      cmd: RPC_COMMANDS.SET_ACTIVITY,
      args: {
        pid: pid || activity?.pid || process.pid,
        activity: activity || null,
      },
      nonce,
    };

    this.send(OPCODES.FRAME, packet);
    return nonce;
  }

  /**
   * Clears Discord Rich Presence activity.
   */
  clearActivity() {
    return this.setActivity(null);
  }

  /**
   * Cleanly closes the IPC socket.
   */
  disconnect() {
    if (this.socket) {
      try {
        this.send(OPCODES.CLOSE, {});
      } catch (_) {
        // Socket may already be closing
      }
      this.socket.destroy();
    }
    this._teardown();
  }

  _teardown() {
    this.connected = false;
    this.ready = false;
    this.socket = null;
    this.currentPath = null;
    this.workingBuffer = Buffer.alloc(0);
  }
}
