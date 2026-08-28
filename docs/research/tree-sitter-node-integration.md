# 语法树解析在 Node 工具链的集成路径 — tree-sitter vs TypeScript compiler API

对应决策票：#262（Knowledge Map v2 wayfinder，父图 #260）

- 日期：2026-08-28
- 方法与深度声明：本报告为**主线程紧凑版**（后台研究代理两次启动即挂，按既定协议转产）。版本/许可证/依赖事实为 npm registry 主源当日采集；性能与确定性部分为基于官方文档模型的工程判断，证据密度低于 `docs/research/js-graph-analytics-ecosystem.md`（#259），已在各节标注判断性质。
- 关联：`docs/research/js-graph-analytics-ecosystem.md`（分析层选型）、`docs/research/f059-knowledge-map-review.md`（现图基线 105 节点/92 边）

## 1. 问题与 TL;DR

**问题**：Knowledge Map v2 要把仓库代码（当前语料 100% JS/TS，约 200+ 源文件）解析出文件/符号/调用关系，作为确定性证据入图。在 Windows 开发 + GitHub Actions CI、供应链敏感、要求「稳定序、重算字节一致」的前提下，选哪条解析路线？

**TL;DR 推荐**：

> **主选：TypeScript compiler API**（`typescript` 已是 apps/web devDependency `^6.0.3`，**零新增供应链**）。`ts.createProgram` + TypeChecker 做符号表与调用边，类型感知的引用解析比纯语法层更准（能穿透 re-export、别名）。
> **备选（多语言未来）：web-tree-sitter（wasm）**——非 JS/TS 语料真实出现时启用；native binding 路线排除。
> **重评触发条件**：仓库出现需要入图的非 JS/TS 语料；或 TS API 提取性能在全仓冷启动超过可接受阈值（预期不会：200+ 文件量级）。

## 2. 三路线对比

| 维度 | TypeScript compiler API | web-tree-sitter（wasm） | node-tree-sitter（native） |
| --- | --- | --- | --- |
| 最新版 / 发布 | 本仓已锁 `^6.0.3` | 0.26.13 / 2026-08 | 0.25.1 / 2026-07 |
| 许可证 | Apache-2.0（既有依赖） | MIT | MIT |
| 新增供应链 | **0 包** | 1 包 + 各语言 grammar `.wasm` | core + grammar + node-gyp-build 链 |
| Windows/CI 成本 | 无（纯 JS） | 无原生编译，跨平台一致 | napi prebuilds（`prebuildify --napi`）缓解，但仍是本仓**第一个原生依赖先例** |
| 语言覆盖 | 仅 JS/TS/TSX | 任意有 grammar 的语言 | 同左 |
| 调用图质量 | **类型感知**（checker 解析引用/别名/re-export） | 语法级（需自建作用域推断） | 同左 |
| 生态节奏 | 与 tsc 同步 | 由 tree-sitter 主仓子目录直接发布（版本最前） | grammar peer 滞后：`tree-sitter-typescript` 0.23.2 peer 要求 `tree-sitter ^0.21.0`，落后 core 0.25.x 两个 minor（registry 采集） |

事实出处（registry 当日采集）：`tree-sitter@0.25.1`（MIT，`prebuildify --napi` + `node-gyp-build` 运行时加载，repo `tree-sitter/node-tree-sitter`）；`web-tree-sitter@0.26.13`（MIT，主仓 `lib/binding_web` 子目录，wasm 直出 exports）；`tree-sitter-typescript@0.23.2`（MIT，覆盖 TS+TSX，peer `tree-sitter ^0.21.0` optional）。

## 3. grammar 生态（tree-sitter 路线适用）

- `tree-sitter-typescript` 0.23.2：官方组织维护，MIT，TS 与 TSX 双 grammar；运行时依赖 `tree-sitter-javascript ^0.23.1`。
- 摩擦点：grammar 包的 peer 版本窗口落后 core 发布节奏（上表）；wasm 路线绕开 peer 问题（grammar 以 `.wasm` 工件加载，不走 npm peer 解析），这是 wasm 优于 native 的第二依据（第一依据是零原生编译）。

## 4. 冷启动与增量（工程判断）

- 200+ 文件冷启动：两条路线都是秒级量级——TS Program 全仓构建等价于一次 `tsc --noEmit` 的前端部分；tree-sitter 逐文件解析为毫秒级/文件。均可接受，不构成选型依据。
- 增量：tree-sitter 的 incremental parsing 面向编辑器（同一文档的编辑增量），**批量索引场景用不上**。正确的增量单元是文件级：内容 hash 未变则跳过重析——与现有知识图快照的 normHash 模式（`scripts/lib/core/knowledge-projection.js`）同构，可直接复用该纪律。

## 5. 确定性输出注意点（两路线通用）

- 提取产物一律按 `(path, startLine, startCol, symbolName)` 稳定排序后序列化；禁止输出任何运行时句柄/内存序。
- 路径归一化：Windows 反斜杠 → POSIX（现有图构建器已有同类处理）。
- 工具链版本入 provenance：TS 路线记录 `typescript` 精确版本（编译器升级可能改变符号解析结果）；tree-sitter 路线记录 grammar `.wasm` 的 sha256。
- TS API 陷阱：`Program.getSourceFiles()` 顺序与 tsconfig include 展开相关，不可信任其自然序——显式排序。

## 6. TS compiler API 覆盖度评估

「符号 + 调用关系」需求映射：导出符号表（`checker.getExportsOfModule`）、函数/类/接口声明（AST 遍历 + `SyntaxKind` 过滤）、调用边（`CallExpression`/`NewExpression` → `checker.getResolvedSignature`/`getSymbolAtLocation` 回声明位置）、import 边（`ImportDeclaration` 解析）。全部在既有依赖内完成；`ts-morph` 是易用性包装（新增 1 依赖），首版不需要——直接用裸 API，接口面留在自研模块内。

## 7. 推荐与触发条件

1. **v2 首版走 TypeScript compiler API**：零新增供应链、类型感知调用图、与语料现状（JS/TS-only）精确匹配；作为「AST 符号图数据模型」票（#261）的默认实现假设。
2. **多语言语料出现时启用 web-tree-sitter**：wasm 路线，不引原生依赖；grammar `.wasm` 工件 hash 入 provenance。
3. **node-tree-sitter 排除**：为单一功能开原生依赖先例 + grammar peer 滞后，收益不抵成本。

## 8. 主源列表

- registry.npmjs.org/tree-sitter/latest（0.25.1 元数据）
- registry.npmjs.org/web-tree-sitter/latest（0.26.13 元数据）
- registry.npmjs.org/tree-sitter-typescript/latest（0.23.2 元数据）
- 本仓 apps/web/package.json（`typescript ^6.0.3` 既有依赖）
