---
status: complete
trigger: "检查我的ccswitch对Hermes的配置为什么不生效"
created: "2026-05-20T00:00:00+08:00"
updated: "2026-05-20T13:30:00+08:00"
---

# Debug Session: ccswitch-hermes-config

## Symptoms

- Expected behavior: ccswitch 切换到 Hermes 后，Hermes/Claude 运行时应读取到对应配置并生效。
- Actual behavior: 用户反馈 ccswitch 对 Hermes 的配置不生效。
- Error messages: 未提供具体报错。
- Timeline: 2026-05-20 反馈。
- Reproduction: 在当前 Windows 用户环境中检查 ccswitch、Hermes、Claude 相关配置和命令解析状态。

## Current Focus

- hypothesis: CC Switch 运行在 Windows 并写入 `C:\Users\PC\.hermes\config.yaml`，但用户通过 bat 启动 WSL Hermes，Hermes 实际读取 `/home/pc/.hermes/config.yaml`。
- test: 对比 Windows 和 WSL 两份 Hermes 配置文件、CC Switch 设置、Hermes 启动脚本和官方源码中 Hermes 配置路径解析逻辑。
- expecting: Windows `~/.hermes/config.yaml` 与 WSL `/home/pc/.hermes/config.yaml` 内容不同，且 CC Switch 没有配置 `hermesConfigDir` 覆盖到 WSL 路径。
- next_action: complete
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- `Get-Command ccswitch` and `where.exe ccswitch` did not find a command in the current PowerShell session.
- Current process environment only exposed Codex-specific variables among Hermes/ccswitch/Claude-like names; no Hermes, Claude, Anthropic, or ccswitch API/base-url environment variables were present.
- `C:\Users\PC\.hermes\config.yaml` exists and was modified on 2026-05-20 13:11:54.
- `C:\Users\PC\.claude\settings.json` exists and was modified on 2026-05-19 14:08:04.
- `C:\Users\PC\AppData\Local\Programs\CC Switch\cc-switch.exe` is installed as CC Switch 3.14.1 and is currently running. It is a desktop app, not a shell command in PATH.
- CC Switch source and UI strings confirm Hermes support reads/writes `~/.hermes/config.yaml`, with optional `hermes_config_dir` / `hermesConfigDir` override.
- `C:\Users\PC\.cc-switch\settings.json` initially did not contain `hermesConfigDir`, so CC Switch used the Windows home default.
- `C:\Users\PC\Desktop\启动Hermes.bat` starts Hermes through WSL: `wsl /home/pc/.hermes/hermes-agent/start.sh`.
- WSL `hermes --version` resolves `/home/pc/.local/bin/hermes` and reports Hermes Agent v0.14.0.
- WSL Hermes config is `/home/pc/.hermes/config.yaml`, size 14353 bytes, modified 2026-05-20 13:12:05.
- Windows Hermes config is `/mnt/c/Users/PC/.hermes/config.yaml`, size 763 bytes, modified 2026-05-20 13:11:54.
- Windows config has `custom_providers: [deepseek, bialian]` and `model.provider: bialian`, `model.default: deepseek-v4-pro`.
- WSL config has `model.provider: alibaba`, `model.default: qwen3.6-plus`, `model.base_url: https://dashscope-intl.aliyuncs.com/compatible-mode/v1`, and `custom_providers: []`.
- The current Windows Hermes config is also internally inconsistent: `model.provider: bialian` but `model.default: deepseek-v4-pro`; `deepseek-v4-pro` belongs to provider `deepseek`, while `bialian` defines `qwen3.6-plus-2026-04-02` and `qwen3.6-plus`.
- CC Switch database has separate app types for Claude and Hermes. The active Claude provider is `DeepSeek` and writes `C:\Users\PC\.claude\settings.json`; this does not make WSL Hermes read the Windows Hermes config.
- No process/user/machine `ANTHROPIC_*`, `CLAUDE_*`, `HERMES_*`, or `OPENAI_*` environment variables were found that would override these config files.
- Updated `C:\Users\PC\.cc-switch\settings.json` with `hermesConfigDir: \\wsl$\Ubuntu-24.04\home\pc\.hermes` after verifying that UNC path and its `config.yaml` are reachable from Windows.

## Eliminated

- Missing `ccswitch` command in PowerShell is not the primary failure; CC Switch is installed and running as a Tauri desktop app.
- Environment-variable precedence is not the primary failure; no relevant overrides are set.
- Claude Code config is a separate path from Hermes config; changing Hermes in CC Switch will not affect `claude.exe` unless CC Switch is switching the Claude app type/provider.

## Resolution

- root_cause: CC Switch is modifying the Windows Hermes config at `C:\Users\PC\.hermes\config.yaml`, while the Hermes instance the user launches runs inside WSL and reads `/home/pc/.hermes/config.yaml`. These are separate files with different provider/model settings, so CC Switch changes appear not to take effect.
- fix: Applied `hermesConfigDir` in `C:\Users\PC\.cc-switch\settings.json` to point CC Switch at the WSL Hermes config directory: `\\wsl$\Ubuntu-24.04\home\pc\.hermes`. CC Switch should be restarted so it reloads settings from disk.
- verification: Verified PowerShell command resolution, CC Switch process/install path, CC Switch state/database, redacted Windows Claude/Hermes config, batch launcher contents, WSL Hermes binary/version, WSL Hermes config path/content, and Windows reachability of the WSL UNC config directory.
- files_changed: `.planning/debug/ccswitch-hermes-config.md`
