# Vela RPC

**English** · [Español](README.es.md)

Minimalist Discord Rich Presence for AI coding harnesses. One local Node.js daemon with zero npm dependencies handles 14 tools, reads the active model and session title directly, and never sends prompt text or secrets to Discord.

## Discord preview

The preview below switches automatically with your GitHub theme (dark mode shows Official Dark; light mode shows Porcelain Light).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/previews/discord_all14_classic_dark.png">
  <source media="(prefers-color-scheme: light)" srcset="assets/previews/discord_all14_porcelain_light.png">
  <img alt="Vela RPC Discord preview across 14 AI harnesses" src="assets/previews/discord_all14_classic_dark.png" width="100%">
</picture>

<details>
<summary>View Titanium OLED icon pack</summary>

![Vela RPC Titanium OLED preview](assets/previews/discord_all14_titanium_oled.png)

</details>

## Installation

Requires Node.js 18+ and a local Discord desktop client. No `npm install` needed.

```bash
git clone https://github.com/Acourd/vela-rpc.git
cd vela-rpc

# Verify the local test suite (6/6 suites, mock Discord IPC)
node tests/run-all.js

# Start the background daemon
node bin/acourd.js start

# Check active status
node bin/acourd.js status
```

## Icon theme switch (dark / light / titanium)

Every harness ships with three 512×512 PNG variants in `assets/styles/`: `classic` (Official Dark), `light` (Porcelain Light), and `titanium` (Titanium OLED). Switch the active icon style at runtime without restarting the daemon:

```bash
node bin/acourd.js config --icon-style titanium   # Titanium OLED
node bin/acourd.js config --icon-style classic    # Official Dark
node bin/acourd.js config --icon-style light      # Porcelain Light
```

### Supported harnesses

Icons in this table adapt automatically to GitHub's dark and light themes:

| Icon | Harness | Default model | Icon | Harness | Default model |
| :---: | :--- | :--- | :---: | :--- | :--- |
| <picture><source media="(prefers-color-scheme: dark)" srcset="assets/styles/antigravity_classic_dark.png"><source media="(prefers-color-scheme: light)" srcset="assets/styles/antigravity_porcelain_light.png"><img src="assets/styles/antigravity_classic_dark.png" width="28" alt="Antigravity"></picture> | Antigravity 2.0 / IDE | Gemini 4 Neon | <picture><source media="(prefers-color-scheme: dark)" srcset="assets/styles/kimi_classic_dark.png"><source media="(prefers-color-scheme: light)" srcset="assets/styles/kimi_porcelain_light.png"><img src="assets/styles/kimi_classic_dark.png" width="28" alt="Kimi Code"></picture> | Kimi Code | Kimi K2 |
| <picture><source media="(prefers-color-scheme: dark)" srcset="assets/styles/claude_classic_dark.png"><source media="(prefers-color-scheme: light)" srcset="assets/styles/claude_porcelain_light.png"><img src="assets/styles/claude_classic_dark.png" width="28" alt="Claude Code"></picture> | Claude Code | Claude Opus 5.5 | <picture><source media="(prefers-color-scheme: dark)" srcset="assets/styles/deepseek_classic_dark.png"><source media="(prefers-color-scheme: light)" srcset="assets/styles/deepseek_porcelain_light.png"><img src="assets/styles/deepseek_classic_dark.png" width="28" alt="DeepSeek"></picture> | DeepSeek | DeepSeek R2 |
| <picture><source media="(prefers-color-scheme: dark)" srcset="assets/styles/codex_classic_dark.png"><source media="(prefers-color-scheme: light)" srcset="assets/styles/codex_porcelain_light.png"><img src="assets/styles/codex_classic_dark.png" width="28" alt="Codex"></picture> | Codex | GPT-5.4 Codex | <picture><source media="(prefers-color-scheme: dark)" srcset="assets/styles/kiro_classic_dark.png"><source media="(prefers-color-scheme: light)" srcset="assets/styles/kiro_porcelain_light.png"><img src="assets/styles/kiro_classic_dark.png" width="28" alt="Kiro"></picture> | Kiro | Claude Sonnet 4.6 |
| <picture><source media="(prefers-color-scheme: dark)" srcset="assets/styles/opencode_classic_dark.png"><source media="(prefers-color-scheme: light)" srcset="assets/styles/opencode_porcelain_light.png"><img src="assets/styles/opencode_classic_dark.png" width="28" alt="OpenCode"></picture> | OpenCode | Claude Sonnet 4.6 | <picture><source media="(prefers-color-scheme: dark)" srcset="assets/styles/mistral_classic_dark.png"><source media="(prefers-color-scheme: light)" srcset="assets/styles/mistral_porcelain_light.png"><img src="assets/styles/mistral_classic_dark.png" width="28" alt="Mistral Vibe"></picture> | Mistral Vibe | Devstral 2 |
| <picture><source media="(prefers-color-scheme: dark)" srcset="assets/styles/openchamber_classic_dark.png"><source media="(prefers-color-scheme: light)" srcset="assets/styles/openchamber_porcelain_light.png"><img src="assets/styles/openchamber_classic_dark.png" width="28" alt="OpenChamber"></picture> | OpenChamber | Claude Opus 5.5 | <picture><source media="(prefers-color-scheme: dark)" srcset="assets/styles/droid_classic_dark.png"><source media="(prefers-color-scheme: light)" srcset="assets/styles/droid_porcelain_light.png"><img src="assets/styles/droid_classic_dark.png" width="28" alt="Factory Droid"></picture> | Factory Droid | Claude Opus 5.5 |
| <picture><source media="(prefers-color-scheme: dark)" srcset="assets/styles/hermes_classic_dark.png"><source media="(prefers-color-scheme: light)" srcset="assets/styles/hermes_porcelain_light.png"><img src="assets/styles/hermes_classic_dark.png" width="28" alt="Hermes"></picture> | Hermes | Hermes 4 | <picture><source media="(prefers-color-scheme: dark)" srcset="assets/styles/amp_classic_dark.png"><source media="(prefers-color-scheme: light)" srcset="assets/styles/amp_porcelain_light.png"><img src="assets/styles/amp_classic_dark.png" width="28" alt="Amp"></picture> | Amp | Claude Opus 5.5 |
| <picture><source media="(prefers-color-scheme: dark)" srcset="assets/styles/gemini_cli_classic_dark.png"><source media="(prefers-color-scheme: light)" srcset="assets/styles/gemini_cli_porcelain_light.png"><img src="assets/styles/gemini_cli_classic_dark.png" width="28" alt="Gemini CLI"></picture> | Gemini CLI | Gemini 4 Neon | | | |

## Adapter configuration

<details>
<summary>Claude Code (<code>~/.claude/settings.json</code>)</summary>

```json
{
  "hooks": {
    "SessionStart": [{ "command": "node \"<path>/bin/acourd.js\" hook SessionStart" }],
    "UserPromptSubmit": [{ "command": "node \"<path>/bin/acourd.js\" hook UserPromptSubmit" }],
    "PreToolUse": [{ "command": "node \"<path>/bin/acourd.js\" hook PreToolUse" }],
    "PostToolUse": [{ "command": "node \"<path>/bin/acourd.js\" hook PostToolUse" }],
    "Stop": [{ "command": "node \"<path>/bin/acourd.js\" hook Stop" }],
    "SessionEnd": [{ "command": "node \"<path>/bin/acourd.js\" hook SessionEnd" }]
  }
}
```

</details>

<details>
<summary>Antigravity 2.0 and Antigravity IDE</summary>

```bash
node adapters/antigravity/hook.js intent "Architecture review"
node adapters/antigravity/hook.js verify "6/6 suites passing"
```

</details>

<details>
<summary>Hermes, Codex, OpenCode, OpenChamber, Kimi Code, DeepSeek and others</summary>

Each harness exposes a standalone adapter under `adapters/<harness>/adapter.js` or can push events directly via CLI:

```bash
node bin/acourd.js set --source codex --task "API refactor" --model "GPT-5.4 Codex"
node bin/acourd.js clear
```

</details>

<details>
<summary>Presets, custom Discord Client IDs and architecture notes</summary>

- Presets: `autonomous` (clean title + active model), `telemetry`, `linear`, `studio`, `stealth`, `hacker`, `custom`. Apply with `node bin/acourd.js preset autonomous`.
- Custom Discord App titles: register your own Discord Application IDs and set them with `--antigravity-id`, `--claude-id`, or `--hermes-id` in `node bin/acourd.js config`.
- Transport: local HTTP loopback (`127.0.0.1:19452`) into native 8-byte LE Discord IPC (Windows Named Pipes and Unix Domain Sockets, including Flatpak and Vesktop), 15s rate-limit debounce, 90s multi-session priority lease, 5-minute stale-presence watchdog, and 128-byte UTF-8 safe truncation.

</details>

## License

MIT
