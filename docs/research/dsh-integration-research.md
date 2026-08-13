# Amber Protocol × dsh 集成调研

> **调研日期**: 2026-08-14
> **dsh 版本**: `@deepseek-ai/dsh@0.1.0-rc.6`
> **本地源码**: `/path/to/deepseek-harness/deepseek-harness`
> **Amber 仓库**: `/path/to/amber-protocol`

## 1. dsh 插件体系概要

dsh 是 DeepSeek 的 agent harness，基于 [Cordis](https://github.com/cordiverse/cordis) 插件框架。核心概念：

- **Plugin（插件）**: Cordis 插件，npm 包形式，注册到 `ctx.tools` / `ctx.skills` 等宿主注册表
- **Bundle（组合包）**: 声明 `dsh.bundle.patch` 的 npm 包，其 `cordis.patch.yml` 是一个 patch 层
- **Profile（配置文件）**: `$DSH_HOME/profiles/<name>/` 目录，含 `package.json`（依赖 + `dsh.profile.bundles` 列表）和用户 `cordis.patch.yml`
- **Patch 语法**: YAML 数组，操作为 `- insert:` / `- update:` / `- remove:`，按 `id` 定位行

**来源**: `packages/boot/app-boot/src/profile.ts` — `loadProfile` 双锚点解析 bundle，无 `dsh.bundle` 声明的包报错；`packages/bundle/README.md` — "npm packages whose manifest declares `dsh: { bundle: { patch: './cordis.patch.yml' } }`"

## 2. 三条集成路径

### 路径 A — MCP Server（零代码，推荐首选）

**原理**: dsh 的 `@deepseek-ai/dsh-mcp-client` 连接外部 MCP server（stdio 传输），将工具注册到 `ctx.tools`，工具名格式 `mcp__<serverName>__<rawName>`。

**来源**: `packages/mcp/mcp-client/README.md` Config 表；`packages/mcp/mcp-client/lib/types/index.d.ts` — `StdioConfig` 接口

**Amber 现状**: 已有完整 MCP server（`scripts/amber-mcp.js`），支持 `--target <repo>` 配置仓库，F018 fail-closed 治理不变量已验证。

**配置方式** — 在 dsh profile 的 `cordis.patch.yml` 中插入：

```yaml
- insert:
    - id: mcp-amber
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        transport: stdio
        serverName: amber
        command: node
        args:
          - /path/to/amber-protocol/scripts/amber-mcp.js
          - --target
          - /path/to/target-repo
        env: {}
        toolCallTimeoutMs: 60000
        failOnStartupError: false
```

**Config 字段**（来源: `packages/mcp/mcp-client/README.md`）:

| 字段 | 必填 | 说明 |
|------|------|------|
| `transport` | ✓ | `"stdio"` |
| `serverName` | ✓ | 工具命名空间，`[A-Za-z0-9_-]{1,32}`，唯一 |
| `command` | ✓ | 可执行文件 |
| `args` | ✗ | 参数数组，不经 shell 插值 |
| `env` | ✗ | 额外环境变量 |
| `cwd` | ✗ | 子进程工作目录 |
| `toolCallTimeoutMs` | ✗ | 单次调用超时，默认 60000 |
| `failOnStartupError` | ✗ | 连接失败是否阻止插件激活，默认 false |
| `reconnect.*` | ✗ | 自动重连策略 |

**优势**: 零代码改动；HMR 支持热替换（编辑配置即断开+重连）；工具名与 Claude Code/Codex 的 `mcp__server__tool` 形状一致。

**限制**: 每个 MCP server 需一个独立插件实例；`serverName` 全局唯一。

### 路径 B — Skill 插件（中复杂度，可叠加）

**原理**: dsh 的 `@deepseek-ai/dsh-skill-filesystem` 扫描 SKILL.md 文件。支持 `customSkillDirs` 配置额外 skill 根目录。也可发布为 bundle npm 包，patch 中 `insert` 一个 `skill-filesystem` 行。

**来源**: `packages/skill/skill-filesystem/README.md` — Config 表；`packages/skill/skill-filesystem/README.md` — Skill Format 章节

**Amber 现状**: 有 4 个 journey skills（`amber-delivery`、`amber-diagnosis-adoption`、`amber-context-continuity`、`amber-continuous-improvement`），每个有 `SKILL.md`（frontmatter: `name` + `description`，kebab-case 名称）。

**dsh Skill 格式要求**（来源: `packages/skill/skill-filesystem/README.md`）:
- 单层目录 bundle（`<name>/SKILL.md`）或平铺 Markdown（`<name>.md`）
- Frontmatter: 必填 `name`（kebab-case）+ `description`；可选 `whenToUse`、`metadata`、`disable-model-invocation`、`user-invocable`
- 嵌套 `**/SKILL.md` 发现被排除

**方式 B1 — customSkillDirs（零发包）**:

在 profile `cordis.patch.yml` 中 update `skill-filesystem` 行：

```yaml
- update:
    - id: skill-filesystem
      config:
        customSkillDirs:
          - /path/to/amber-protocol/skills
```

**方式 B2 — 发布 npm bundle 包**:

发布 `@amber-protocol/dsh-skills` npm 包，`package.json` 声明：

```json
{
  "name": "@amber-protocol/dsh-skills",
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

`cordis.patch.yml`:

```yaml
- insert:
    - id: skill-filesystem-amber
      name: '@deepseek-ai/dsh-skill-filesystem'
      config:
        includeDefaultRoots: false
        customSkillDirs:
          - !!js "require('path').join(__dirname, 'skills')"
```

安装: `dsh plugin --profile <name> add @amber-protocol/dsh-skills`

**来源（安装流程）**: `apps/cli/lib/plugin-9h8shc4d.js` — pnpm 安装后 `reconcilePlugins` 检测 `dsh.bundle.patch` 声明，自动加入 `dsh.profile.bundles` 列表。

### 路径 C — Cordis 原生插件（高复杂度，不推荐）

**原理**: 用 Cordis 插件 API 写 Host 插件（纯 JS 函数体返回 Cordis Plugin），直接注册 Amber 工具到 `ctx.tools`，不走 MCP 协议。

**来源**: `packages/extensions/cordis-host-runner/`；`config/agent-presets/cordis/skills/cordis-plugin-development/SKILL.md`

**不推荐原因**:
- 需学习 Cordis API（`ctx.get`、`inject`、`ctx.effect`、Slots、Host/Client 分层）
- Amber 需暴露 JS API 而非 CLI/MCP，需重构
- Cordis 插件是纯 JS 函数体（不能用 `import`/`require`/TypeScript），Amber 是 CommonJS 模块
- 动态插件是临时的、进程本地的，不适合持久化工具注册

## 3. 推荐方案

### 第一阶段：路径 A（MCP Server）

1. 在目标项目或 `$DSH_HOME/profiles/<name>/cordis.patch.yml` 中配置 `mcp-client` 行
2. `command: node`，`args` 指向 `scripts/amber-mcp.js --target <repo>`
3. `serverName: amber`
4. Amber 治理工具（`governance_report`、`session_status`、`context_preview` 等）直接出现在 dsh agent 工具列表

### 第二阶段：路径 B1（Skill 暴露）

在同一个 `cordis.patch.yml` 中 update `skill-filesystem` 的 `customSkillDirs` 加入 Amber skills 目录。dsh agent 即可通过 `/amber-delivery` 等 journey skill 引导工作流。

### 第三阶段（可选）：路径 B2（npm 包发布）

发布 `@amber-protocol/dsh-skills` npm 包，含 `dsh.bundle.patch` 声明 + skills 目录。用户 `dsh plugin --profile <name> add @amber-protocol/dsh-skills` 一键安装。

## 4. 验证来源清单

| 声明 | 来源文件 |
|------|----------|
| `dsh.bundle.patch` 声明格式 | `packages/bundle/base/package.json`; `packages/bundle/README.md` |
| `loadProfile` 双锚点解析 | `packages/boot/app-boot/src/profile.ts` |
| `reconcilePlugins` pnpm 后检测 | `apps/cli/lib/plugin-9h8shc4d.js` |
| MCP client stdio config | `packages/mcp/mcp-client/README.md`; `lib/types/index.d.ts` |
| 工具名 `mcp__<serverName>__<rawName>` | `packages/mcp/mcp-client/lib/types/index.d.ts` |
| Skill 格式（SKILL.md frontmatter） | `packages/skill/skill-filesystem/README.md` |
| `customSkillDirs` 配置 | `packages/skill/skill-filesystem/README.md` Config 表 |
| Profile 模板（web/headless） | `packages/boot/app-boot/src/profile.ts` — `PROFILE_TEMPLATES` |
| `PROFILE_PATCH_TEMPLATE` | `packages/boot/app-boot/src/profile.ts` |
| Cordis 插件开发指南 | `config/agent-presets/cordis/skills/cordis-plugin-development/SKILL.md` |
| Amber MCP server 入口 | `scripts/amber-mcp.js`（amber-protocol 仓库） |
