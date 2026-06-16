# 多平台 Agent Skill 分发设计（Amber Protocol）

- **日期**: 2026-06-16
- **状态**: Draft（待用户复核 → 转 writing-plans）
- **主题**: 把 Amber 核心 CLI 命令封装为主流 AI coding agent 平台可调用的 skill + 手动 slash 命令，做成可分发 plugin，单一来源维护、覆盖"原生支持 SKILL.md"的四家平台。

---

## 1. 背景与目标

Amber Protocol 的全部能力通过统一 CLI 入口 `node scripts/amber.js <command>` 暴露。目前用户要在 Claude Code / Codex 等 agent 平台里使用这些能力，只能手动敲完整命令。

**目标**：让 agent 平台能以 **skill（模型自动调用）** 和 **slash / 手动命令（用户显式触发）** 两种形式调用 Amber 的核心命令，打包成**可分发 plugin**，并在**单一来源**维护、避免多平台副本漂移。

首批封装 **5 个核心命令**：`init` / `audit` / `wiki` / `doctor` / `handoff`。

## 2. 现状（已勘查事实）

- **统一入口**：`scripts/amber.js`，24 个命令；`package.json` version `1.0.0`，`bin` 暴露 `amber` 与 `coding-harness`。
- **已有 plugin 雏形（半成品）**：
  - `.claude-plugin/plugin.json`（version `0.1.0`，`skills: "../skills"`）
  - `.codex-plugin/plugin.json`（version `0.1.0`，`skills: "./skills/"` — 相对 `.codex-plugin/` 可能指错）
  - 两者 version 均与 `package.json` 的 `1.0.0` 不一致。
- **已有 6 个 `skills/*/SKILL.md`**：`amber-init / amber-audit / amber-wiki / amber-doctor / amber-handoff / amber-continuous-improvement`。frontmatter 仅含标准 `name` + `description`。
- **命令路径过时/不一致**（详见 §6.B）：例如 `amber-init` 让 agent 运行 `node scripts/scaffold-harness.js`，**该文件已不存在**；其余指向 `audit-project.js` / `validate-wiki.js` / `doctor.js` 等旁路 wrapper，应统一到 `amber.js` 入口。
- **缺失**：无 `.claude/commands/`（无 slash 命令）、无根 `AGENTS.md`（`templates/AGENTS.md` 是发给**目标项目**的模板，非本仓库根文件）。

## 3. 调研结论（2026-06，外部平台机制）

关键事实：**`SKILL.md` 已成为跨平台开放标准**，把"适配大多数平台"从高成本变为近乎免费。

| 平台 | 原生读 `SKILL.md`? | skill 目录 | 手动 / slash 触发机制 |
|---|---|---|---|
| Claude Code | ✅ | `.claude/skills/` | `.claude/commands/*.md`（md + frontmatter） |
| OpenAI Codex | ✅ | `.codex/skills/`（项目）/ `~/.codex/skills/` | skill `$name` 显式调用（**custom prompts 已废弃**） |
| Cursor | ✅（2.4+ 迁移 skills format） | 待确认（见 §9） | `/commands`（.md） |
| Gemini CLI | ✅ | 待确认（见 §9） | `.gemini/commands/*.toml`（**TOML**，字段 `description` + `prompt`，`{{args}}`） |
| GitHub Copilot | ⚠️ 主走 prompt 文件 | — | `.github/prompts/*.prompt.md` |
| Windsurf | ⚠️ 主走 workflow | — | `.windsurf/workflows/*.md` |

补充结论：
- **`AGENTS.md` 是另一个开放标准**（Linux Foundation / Agentic AI Foundation 治理，60,000+ 项目，跨 Codex/Cursor/Copilot/Windsurf/Gemini/Amp 通用）。纯 Markdown，放仓库根，是"给 agent 的 README"。
- **skill 层已统一**（`SKILL.md`，一份不改通吃四家），**仅手动 / slash 命令层仍碎片化**（md+frontmatter vs TOML vs prompt.md）。
- Codex 的 custom prompts 已废弃改用 skills；Cursor 也在把 rules/commands 迁移到 skills format —— 行业向 skill 收敛的信号明确。

## 4. 设计决策（用户已确认）

- **方案**：A —— SKILL.md 为单一来源 + 轻量命令生成器 + 修复 plugin。
- **平台范围**：仅 **SKILL.md 四家**（Claude Code / Codex / Cursor / Gemini）。**不做** Copilot / Windsurf。
- **形式**：skill（自动） + slash / 手动命令（显式），两者都要。
- **分发**：做成可分发 plugin。
- **命令范围**：核心 5 个（`init` / `audit` / `wiki` / `doctor` / `handoff`）。
- **AGENTS.md**：纳入（新建仓库根 `AGENTS.md`）。

## 5. 架构与数据流

**单一来源 = 5 个 `skills/<name>/SKILL.md`**。frontmatter 用标准字段 + Amber 专有 `x-amber` 块：标准字段供四家 skill 层直接读，`x-amber` 仅供生成器派生手动命令。

```
skills/*/SKILL.md   ← 唯一手写维护处（source of truth）
   │
   ├─（原样复用，不转格式）→ 四家 skill 层
   │      Claude .claude/skills/ · Codex .codex/skills/ · Cursor · Gemini
   │      触发：模型按 description 自动调用（Codex/Cursor 另可 $name 显式调）
   │
   └─→ scripts/gen-agent-commands.js（生成器，仅读 x-amber 块）
          ├─→ .claude/commands/amber-*.md      （Claude 独立 slash，md+frontmatter）
          └─→ .gemini/commands/amber/*.toml    （Gemini 独立手动命令，TOML）
             （Codex/Cursor 的"手动触发"复用 skill 的 $name，无需额外文件）
```

**三条核心原则**：
1. **skill 不生成、只分发** —— 四家原生读 `SKILL.md`，生成器**不复制/不改写 skill 内容**，杜绝多副本漂移；各平台靠 plugin manifest 或目录约定指向同一份 `skills/`。
2. **生成器只产出 2 种手动命令格式**：Claude `.md` + Gemini `.toml`（这两家的"手动 slash"与 skill 是分离机制）。Codex / Cursor 的手动触发复用 skill 本身。
3. **生成产物可重建、不手改** —— 生成器幂等覆盖，产物顶部写 `# GENERATED — edit skills/ instead`；维护永远只发生在单一来源。

> 这同时满足"skill + slash 两者"：skill 层给自动调用，生成的 command 层给显式 `/` 触发。

## 6. 实现细节

### A. `SKILL.md` frontmatter 模型

```yaml
---
name: amber-init
description: Install the V1 Amber Protocol scaffold in a repository without overwriting existing files.
x-amber:
  command: "node scripts/amber.js init --target {{target}}"
  args:
    - { name: target, hint: "repo path", default: "." }
  manualName: "amber-init"
---
（指令正文：何时使用、步骤、边界 —— 四家 skill 层都读这段）
```

- 标准 `name`/`description` + 正文：四家 skill 层读取，保持兼容。
- `x-amber`：仅生成器读取，平台 skill 层忽略未知键（向后兼容）。

### B. 5 个 SKILL.md 修复清单

| skill | 当前命令 | 问题 | 修复为 |
|---|---|---|---|
| amber-init | `scripts/scaffold-harness.js` | ❌ 文件不存在 | `node scripts/amber.js init --target {{target}}` |
| amber-audit | `scripts/audit-project.js` | ⚠️ 旁路 wrapper | `node scripts/amber.js audit --target {{target}}` |
| amber-wiki | `scripts/validate-wiki.js` | ⚠️ 只验证、不创建（语义错） | `node scripts/amber.js wiki --target {{target}}` |
| amber-doctor | `scripts/doctor.js` | ⚠️ 旁路 wrapper | `node scripts/amber.js doctor --target {{target}}` |
| amber-handoff | 步骤4 `scripts/doctor.js` | ⚠️ 旁路 wrapper | `node scripts/amber.js doctor` + `node scripts/amber.js handoff` 校验 |

- 5 个均补全 `x-amber` 块。
- `amber-continuous-improvement` 是复合工作流、不映射单条命令，**首批不纳入**（仍保留文件不动）。

### C. 生成器 `scripts/gen-agent-commands.js`

- **输入**：扫描 `skills/*/SKILL.md`，解析 frontmatter（标准 + `x-amber`）。无 `x-amber` 的 skill（如 continuous-improvement）跳过，不报错。
- **字段映射**：

| 来源 | → Claude `.claude/commands/amber-*.md` | → Gemini `.gemini/commands/amber/*.toml` |
|---|---|---|
| `description` | frontmatter `description` | `description = "..."` |
| `x-amber.command` | body：`Execute: node scripts/amber.js …`（`{{target}}`→`$1`） | `prompt = """… {{args}} …"""` |
| `x-amber.args` | `argument-hint: [target]` | `{{args}}` |

- **幂等**：覆盖式生成；产物顶部写 `# GENERATED — edit skills/ instead`；连跑两次字节一致。
- **`--check` 模式**：重新生成到内存与磁盘比对，不一致则非零退出（供 CI 防漂移）。
- **不依赖新增第三方依赖**：手写最小 TOML 序列化（字段固定、值为字符串），避免引入 toml 库；frontmatter 解析复用项目已有方式或最小实现。

### D. Plugin 对齐

- `.claude-plugin/plugin.json`：`version 0.1.0 → 1.0.0`；确认 `skills: "../skills"` 解析到仓库根 `skills/`；如平台支持，补 `commands` 指向 `.claude/commands/`。
- `.codex-plugin/plugin.json`：`version → 1.0.0`；**修正 `skills` 路径**指向仓库根 `skills/`（核对 Codex 对 `.codex-plugin/` 相对路径的解析规则）。

### E. 根 `AGENTS.md`（新建）

- 仓库根新建 `AGENTS.md`，纯 Markdown，包含：项目一句话定位、`node scripts/amber.js <command>` 用法、5 个核心命令速查、安全边界（只读/dry-run 优先、不自动执行目标项目命令）。
- 与 `templates/AGENTS.md`（发给目标项目的模板）**区分**：本文件描述的是**本仓库自身**给 agent 的说明。
- 内容可从生成器附带派生（保证命令清单与 skills 同源），或手写并加一条测试校验命令名一致性。

### F. npm scripts

- `gen:agents` → `node scripts/gen-agent-commands.js`
- `gen:agents:check` → `node scripts/gen-agent-commands.js --check`（纳入 CI）

## 7. 测试策略（纳入现有 `node --test tests/`）

- `tests/unit/gen-agent-commands.test.js`：
  - frontmatter（标准 + `x-amber`）解析正确。
  - Claude `.md` 产物 frontmatter 合法、含正确 `Execute:` 命令行。
  - Gemini `.toml` 产物可被解析、`description` + `prompt` 字段正确、含 `{{args}}`。
  - **幂等**：连跑两次输出一致。
  - `--check`：产物最新→退出 0；人为改动→非零。
- **防漂移断言**：每个 `SKILL.md` 的 `x-amber.command` 命令名 ∈ `amber.js` 的 `COMMANDS` 数组。
- **AGENTS.md 一致性**：根 `AGENTS.md` 列出的核心命令名与 skills 集合一致。

## 8. 范围与非目标

**做**：5 个核心命令的 SKILL.md 修复 + `x-amber`；生成器（Claude `.md` + Gemini `.toml`）；plugin 对齐；根 `AGENTS.md`；测试。

**不做（本期）**：
- ❌ Copilot（`.github/prompts/`）/ Windsurf（`.windsurf/workflows/`）适配。
- ❌ `amber-continuous-improvement` 及其余 19 个非核心命令。
- ❌ 由 plugin/skill **实际执行** Amber 命令 —— 仍由 agent 在其权限模型下运行，符合 Amber "不自动执行" 的产品边界。
- ❌ 发布到任何外部 marketplace。

## 9. 待验证点（实现期用官方 docs + `--help` 最终确认）

1. **Cursor / Gemini 放置 `SKILL.md` 的确切目录**：调研确认二者支持 skills，但官方目录约定较新；存在 `.agents/skills/` 这类跨平台位置的说法待证实。不影响架构，仅为分发落点参数。
2. **Codex `.codex-plugin/` 的 `skills` 相对路径解析规则**，以及 Codex 是否需要 `.codex/skills/` 实体目录 vs plugin 指向。
3. **Claude plugin manifest 是否支持 `commands` 字段**声明 slash 命令位置。

## 10. 验收标准

- 5 个核心 `SKILL.md` 命令路径全部指向 `node scripts/amber.js <command>`，且命令名通过防漂移断言。
- `npm run gen:agents` 生成 `.claude/commands/amber-*.md`（5 个）与 `.gemini/commands/amber/*.toml`（5 个），幂等。
- `npm run gen:agents:check` 在产物最新时退出 0。
- 两个 plugin manifest version = `1.0.0`，`skills` 路径解析正确。
- 仓库根存在 `AGENTS.md`，命令清单与 skills 同源。
- `node --test tests/` 全绿。

## 11. 来源（2026-06 调研）

- SKILL.md 跨平台标准 / Codex skills：https://www.agensi.io/learn/codex-cli-skills-install-skill-md ；https://www.thepromptindex.com/how-to-use-ai-agent-skills-the-complete-guide.html
- Codex custom prompts 已废弃 → skills：https://developers.openai.com/codex/custom-prompts ；AGENTS.md：https://developers.openai.com/codex/guides/agents-md
- Cursor rules / skills 迁移：https://www.vibecodingacademy.ai/blog/cursor-rules-complete-guide
- GitHub Copilot prompt files：https://docs.github.com/en/copilot/tutorials/customization-library/prompt-files
- Gemini CLI custom commands（TOML）：https://google-gemini.github.io/gemini-cli/docs/cli/custom-commands.html
- Windsurf workflows：https://docs.windsurf.com/windsurf/cascade/workflows
- AGENTS.md 开放标准：https://agents.md/ ；https://openai.com/index/agentic-ai-foundation/
