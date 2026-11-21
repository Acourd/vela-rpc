/**
 * Acourd RPC — Mock Discord IPC Server
 * Simulates a Discord Desktop client listening on Windows Named Pipe or Unix Domain Socket.
 * Decodes 8-byte LE binary frames, responds to Handshakes, and records SET_ACTIVITY calls.
 */

import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { OPCODES, RPC_COMMANDS, RPC_EVENTS } from '../core/constants.js';

export class MockDiscordServer {
  constructor(options = {}) {
    this.pipePath = options.pipePath || MockDiscordServer.generateTestPipePath();
    this.server = null;
    this.activeSockets = new Set();
    this.receivedHandshakes = [];
    this.receivedActivities = [];
    this.receivedFrames = [];
  }

  static generateTestPipePath() {
    const id = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    if (process.platform === 'win32') {
      return `\\\\.\\pipe\\test-discord-rpc-${id}`;
    }
    return path.join(os.tmpdir(), `test-discord-rpc-${id}.sock`);
  }

  start() {
    return new Promise((resolve, reject) => {
      // Clean up previous unix socket if exists
      if (process.platform !== 'win32' && fs.existsSync(this.pipePath)) {
        try { fs.unlinkSync(this.pipePath); } catch (_) {}
      }

      this.server = net.createServer((socket) => {
        this.activeSockets.add(socket);
        let workingBuffer = Buffer.alloc(0);

        socket.on('data', (chunk) => {
          workingBuffer = Buffer.concat([workingBuffer, chunk]);

          while (workingBuffer.length >= 8) {
            const opcode = workingBuffer.readUInt32LE(0);
            const length = workingBuffer.readUInt32LE(4);
            const totalFrameBytes = 8 + length;

            if (workingBuffer.length < totalFrameBytes) {
              break;
            }

            const payloadBuf = workingBuffer.subarray(8, totalFrameBytes);
            workingBuffer = workingBuffer.subarray(totalFrameBytes);

            let payload = {};
            if (length > 0) {
              try {
                payload = JSON.parse(payloadBuf.toString('utf8'));
              } catch (_) {}
            }

            this.receivedFrames.push({ opcode, payload });

            if (opcode === OPCODES.HANDSHAKE) {
              this.receivedHandshakes.push(payload);
              // Send READY event
              this._sendFrame(socket, OPCODES.FRAME, {
                cmd: RPC_COMMANDS.DISPATCH,
                evt: RPC_EVENTS.READY,
                data: {
                  v: 1,
                  config: { api_endpoint: '//discord.com/api' },
                  user: { id: '999999999', username: 'MockTester', discriminator: '0001' },
                },
                nonce: null,
              });
            } else if (opcode === OPCODES.FRAME) {
              if (payload.cmd === RPC_COMMANDS.SET_ACTIVITY) {
                this.receivedActivities.push(payload.args?.activity || null);
                // Acknowledge activity
                this._sendFrame(socket, OPCODES.FRAME, {
                  cmd: RPC_COMMANDS.SET_ACTIVITY,
                  data: payload.args?.activity || null,
                  evt: null,
                  nonce: payload.nonce,
                });
              }
            } else if (opcode === OPCODES.PING) {
              this._sendFrame(socket, OPCODES.PONG, payload);
            }
          }
        });

        socket.on('close', () => {
          this.activeSockets.delete(socket);
        });

        socket.on('error', () => {
          this.activeSockets.delete(socket);
        });
      });

      this.server.once('error', reject);
      this.server.listen(this.pipePath, () => {
        resolve(this.pipePath);
      });
    });
  }

  _sendFrame(socket, opcode, payload) {
    if (!socket || socket.destroyed) return;
    const body = Buffer.from(JSON.stringify(payload || {}), 'utf8');
    const header = Buffer.alloc(8);
    header.writeUInt32LE(opcode, 0);
    header.writeUInt32LE(body.length, 4);
    socket.write(Buffer.concat([header, body]));
  }

  close() {
    return new Promise((resolve) => {
      for (const sock of this.activeSockets) {
        sock.destroy();
      }
      this.activeSockets.clear();

      if (this.server) {
        this.server.close(() => {
          if (process.platform !== 'win32' && fs.existsSync(this.pipePath)) {
            try { fs.unlinkSync(this.pipePath); } catch (_) {}
          }
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}
