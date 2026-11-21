# Acourd RPC (Aura AI RPC)
> **Zero-Bloat Universal Discord Rich Presence Microkernel for AI Coding Environments**  
> Native Node.js (ESM) • Zero Dependencies (`dependencies: {}`) • Sub-15ms Hook Latency • 15s Rate-Limit Debounce

---

## 🎨 Visual Presence Showcase (Discord Preview)

Acourd RPC renders high-fidelity Rich Presence cards dynamically reflecting your AI agent's cognitive state:

### 1. 🧠 Reasoning & Planning (`thinking`)
```text
┌────────────────────────────────────────────────────────────────────────┐
│  [  ANTIGRAVITY 2.0  ]                                                 │
│                                                                        │
│  (●) Google Antigravity 2.0                                            │
│      🧠 Reasoning & Planning                                           │
│      AcourdCore • feat/microkernel                                     │
│      [ Deep cognitive synthesis ]                                      │
│      00:04:12 elapsed                                                  │
└────────────────────────────────────────────────────────────────────────┘
```

### 2. 🛠️ Tool Execution (`tool_call`)
```text
┌────────────────────────────────────────────────────────────────────────┐
│  [  CLAUDE CODE  ]                                                     │
│                                                                        │
│  (●) Claude Code                                                       │
│      🛠️ Editing discord-ipc.js                                         │
│      universal-rpc • main                                              │
│      [ Modifying files & running commands ]                            │
│      00:12:45 elapsed                                                  │
└────────────────────────────────────────────────────────────────────────┘
```

### 3. 🛡️ Deterministic Verification (`verifying`)
```text
┌────────────────────────────────────────────────────────────────────────┐
│  [  PHYSICAL ORACLE  ]                                                 │
│                                                                        │
│  (●) Google Antigravity 2.0                                            │
│      🛡️ Deterministic Verification (5/5 PASS)                          │
│      acourd-rpc • release/v1.0                                         │
│      [ Running test suites (Exit Code 0) ]                             │
│      00:18:03 elapsed                                                  │
└────────────────────────────────────────────────────────────────────────┘
```

### 4. ⚡ Agent Swarm Coordination (`swarm`)
```text
┌────────────────────────────────────────────────────────────────────────┐
│  [  SWARM ORCHESTRATOR  ]                                              │
│                                                                        │
│  (●) Google Antigravity 2.0                                            │
│      ⚡ Directing Swarm: [SecurityAuditor]                             │
│      distributed-kernel • swarm-topology                               │
│      [ Orchestrating multi-agent topology ]                            │
│      00:25:30 elapsed                                                  │
└────────────────────────────────────────────────────────────────────────┘
```

### 5. ☕ Standing By / Idle (`idle`)
```text
┌────────────────────────────────────────────────────────────────────────┐
│  [  IDLE / STANDBY  ]                                                  │
│                                                                        │
│  (●) Google Antigravity 2.0                                            │
│      ☕ Mission accomplished • Standing by                             │
│      acourd-rpc • main                                                 │
│      [ Awaiting instruction ]                                          │
│      00:32:10 elapsed                                                  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 🏛️ Architecture & System Topology

```
   ┌─────────────────────────────────────────────────────────────────┐
   │ AI Agents & Environments (Antigravity 2.0, Claude Code, etc.)  │
   └───────────────────────────────┬─────────────────────────────────┘
                                   │ Ephemeral POST (< 15ms)
                                   ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │ Acourd Micro-Daemon (HTTP Loopback: 127.0.0.1:19452)             │
   │ ├─ Autospawn & Single Instance Mutex                            │
   │ ├─ State Engine (Cognitive States: idle, thinking, tool, swarm) │
   │ ├─ 15s Cooldown Rate-Limiter (Discord anti-flood protection)    │
   │ ├─ Privacy Sanitizer (~/path obfuscation, secret redaction)     │
   │ └─ 128-byte UTF-8 Boundary Truncator                            │
   └───────────────────────────────┬─────────────────────────────────┘
                                   │ 8-byte LE Framed Binary Stream
                                   ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │ Native IPC Transport (core/discord-ipc.js)                      │
   │ ├─ Windows: \\.\pipe\discord-ipc-{0..9}                         │
   │ ├─ Unix:    $XDG_RUNTIME_DIR/discord-ipc-{0..9}                 │
   │ └─ Linux Sandboxes: Flatpak (com.discordapp.Discord), Vesktop   │
   └───────────────────────────────┬─────────────────────────────────┘
                                   │ IPC Socket
                                   ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │ Discord Desktop Client (Rich Presence Gateway)                  │
   └─────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Key Technical Highlights

1. **Pure Native Node.js (Zero Dependencies):** No `@xhayper/discord-rpc`, no heavy transpilers, no NPM dependency tree. Uses only standard `node:net`, `node:http`, and `node:buffer`.
2. **8-Byte Little-Endian Binary Framing:**
   - 4 bytes UInt32 LE: `Opcode` (0: Handshake, 1: Frame, 2: Close, 3: Ping, 4: Pong)
   - 4 bytes UInt32 LE: `Length`
   - UTF-8 JSON payload with chunk defragmentation accumulator.
3. **Robust Cross-Platform IPC:**
   - Windows Named Pipes (`\\.\pipe\discord-ipc-{0..9}` and `\\?\pipe\discord-ipc-{0..9}`).
   - Unix Domain Sockets (macOS `/tmp`, Linux standard `$XDG_RUNTIME_DIR`, plus Flatpak and Vesktop paths).
4. **Discord API Flood Guard (15s Debounce):** Discord rate-limits activity updates to once every 15 seconds. Acourd queues and flushes updates safely without socket drops.
5. **Zero-Trust Privacy & Safety:**
   - Automatic user home directory sanitization (`C:\Users\Ayzok\...` -> `~/...`).
   - Redaction of `.env` configurations, SSH keys (`id_rsa`), and API tokens (`sk-...`, `ghp_...`).
   - Hard 128-byte UTF-8 boundary enforcement avoiding multi-byte replacement character corruptions.

---

## 📦 Installation & Usage

### 1. Test Suite Verification
Run the physical deterministic test suite (including mock Discord IPC server):
```bash
node tests/run-all.js
```

### 2. Launch Background Daemon
```bash
node bin/acourd.js start
```

### 3. Check Status & Live Preview
```bash
node bin/acourd.js status
```

### 4. Render All Visual States Preview
```bash
node bin/acourd.js preview
```

---

## 🔌 Adapter Configurations

### Claude Code (`.claude/settings.json`)
Add the hooks generated by `adapters/claude-code/config-helper.js`:
```json
{
  "hooks": {
    "SessionStart": [{ "command": "node \"<path>/adapters/claude-code/hook.js\" SessionStart" }],
    "UserPromptSubmit": [{ "command": "node \"<path>/adapters/claude-code/hook.js\" UserPromptSubmit" }],
    "PreToolUse": [{ "command": "node \"<path>/adapters/claude-code/hook.js\" PreToolUse" }],
    "PostToolUse": [{ "command": "node \"<path>/adapters/claude-code/hook.js\" PostToolUse" }],
    "Stop": [{ "command": "node \"<path>/adapters/claude-code/hook.js\" Stop" }],
    "SessionEnd": [{ "command": "node \"<path>/adapters/claude-code/hook.js\" SessionEnd" }]
  }
}
```

### Google Antigravity 2.0 (Hook / Sidecar)
Invoke from workflow or sidecar runner:
```bash
# During reasoning:
node adapters/antigravity/hook.js intent "Architectural design"

# During verification:
node adapters/antigravity/hook.js verify "Oracle exit code 0"

# Run persistent workspace watcher:
node -e "import('./adapters/antigravity/sidecar.js').then(m => new m.AntigravitySidecar().start())"
```

---

## 📄 License
MIT License. Free and open source for the agentic engineering community.
