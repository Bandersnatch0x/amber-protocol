# vX.Y.Z 标签与 DSH 稳定版发布调研

> 调研日期：2026-08-14  
> 事实基线：仓库 HEAD `f63c2a8d980dd73204dbd43cf7ba494eecf03d84`（工作区未提交修改不作为 HEAD 事实）

## 结论摘要

1. **当前 HEAD 没有 DSH 专用 GitHub Actions workflow。** 当前仓库只有
   `.github/workflows/ci.yml` 与 `.github/workflows/publish-github-packages.yml`。两者都对
   `push` 的 `v*` tag 生效，所以推送一个 `vX.Y.Z` tag 时，当前实际会启动这两个 workflow；
   但没有 workflow 会发布 `dsh-amber-protocol`。
2. **如果另有一个 DSH workflow 也声明 `on.push.tags: ["v*"]`，同一个 tag push 会独立触发它。**
   触发匹配不提供跨 workflow 的先后顺序；不能把一个 workflow 的完成当成另一个 workflow
   的 `needs`。需要顺序时，应将两个发布 job 放在同一 workflow 用 `needs` 编排，或用
   `workflow_run` 表达跨 workflow 依赖。
3. **在当前仓库的版本契约下，建议每个主包稳定版都发布同版本 DSH 包，即使 bundle 的
   运行逻辑没有变化。** `dsh/package.json` 的 `version` 必须等于根 `package.json`，其
   `amber-protocol` 依赖也按根版本生成；集成测试明确断言这两个不变量。新 DSH 版本至少
   更新了不可变的 package manifest（版本和依赖），并为每个主版本提供可追溯的一一对应
   安装入口。
4. **“每次都发”不是 npm 的技术硬性要求。** 如果产品决定 DSH 独立发版，可以保留旧
   DSH 版本，让其 `^X.Y.Z` 依赖在兼容范围内解析新的主包；但这会改变当前 lockstep 契约，
   需要同时修改测试、版本同步、发布核验和文档，而不是只删掉一个 publish step。

## 当前事实（HEAD）

### Tag 触发与发布 job

- `ci.yml` 的 `on.push.tags` 是 `v*`（[HEAD 文件，L4-L12](https://github.com/Bandersnatch0x/amber-protocol/blob/f63c2a8d980dd73204dbd43cf7ba494eecf03d84/.github/workflows/ci.yml#L4-L12)）。tag 触发后，`release-dry-run` 只要满足 tag 条件就运行；`release` 还要求 identity、test、coverage、security、performance、web 全部成功，并排除 ref 中含 `-rc` 或 `-beta` 的 tag（[release job，L217-L320](https://github.com/Bandersnatch0x/amber-protocol/blob/f63c2a8d980dd73204dbd43cf7ba494eecf03d84/.github/workflows/ci.yml#L217-L320)）。该 job 执行根目录 `npm publish` 并创建 GitHub Release。
- `publish-github-packages.yml` 也声明 `on.push.tags: ["v*"]`，并另有 `workflow_dispatch`（[HEAD 文件，L3-L7](https://github.com/Bandersnatch0x/amber-protocol/blob/f63c2a8d980dd73204dbd43cf7ba494eecf03d84/.github/workflows/publish-github-packages.yml#L3-L7)）。它读取根 `package.json` 版本，在 GitHub Packages registry 上按版本幂等跳过或发布（[publish step，L55-L61](https://github.com/Bandersnatch0x/amber-protocol/blob/f63c2a8d980dd73204dbd43cf7ba494eecf03d84/.github/workflows/publish-github-packages.yml#L55-L61)）。它没有 `-rc`/`-beta` 条件，因此从 YAML 看来预发布 `v*` tag 也会进入该 workflow。
- `CONTRIBUTING.md` 将 GitHub Packages workflow 描述为权威流程，并称 `ci.yml` 的 release job 是历史遗留；但 HEAD 的 `ci.yml` 仍由 `v*` tag 触发、执行根目录 `npm publish`。这是文档与可执行 YAML 的冲突；判断真实触发和发布行为时应以 workflow YAML 为准，并在落地 DSH 发布前先收敛为一个权威入口。
- `git ls-tree -r --name-only HEAD .github/workflows` 只列出上述两个文件；没有 `publish-dsh.yml` 或其他 DSH workflow。`git grep` 也找不到 workflow 中的 `dsh-amber-protocol` 发布命令。因此“现有 DSH workflow”不是当前 HEAD 的事实，若它存在于其他分支/未提交设计，应单独核对其触发器。
- 根 `package.json` 的 `files` 列表没有 `dsh/`；DSH 是独立 npm 包，不会随根包自动进入同一个 tarball（[HEAD package.json](https://github.com/Bandersnatch0x/amber-protocol/blob/f63c2a8d980dd73204dbd43cf7ba494eecf03d84/package.json#L1-L24)）。

### DSH 包的锁步契约

- `dsh/package.json` 声明包名 `dsh-amber-protocol`、独立 `version`、`dsh.bundle.patch`，并依赖
  `amber-protocol: ^<根版本>`（[HEAD dsh/package.json](https://github.com/Bandersnatch0x/amber-protocol/blob/f63c2a8d980dd73204dbd43cf7ba494eecf03d84/dsh/package.json)）。
- `tests/integration/dsh-bundle.test.js` 从两个 manifest 读取版本，断言 DSH 版本等于根版本，且依赖字符串等于 `^${amberManifest.version}`；它还用 `npm pack --dry-run` 检查 bundle 声明的四个文件和 `package.json` 都会打包（[HEAD 测试，L13-L21、L60-L78](https://github.com/Bandersnatch0x/amber-protocol/blob/f63c2a8d980dd73204dbd43cf7ba494eecf03d84/tests/integration/dsh-bundle.test.js#L13-L21)）。
- HEAD 的 `scripts/sync-version.js` 只同步 `.claude-plugin/plugin.json`、`.codex-plugin/plugin.json` 和 README 版本徽章，`TARGETS` 没有 `dsh/package.json`（[HEAD 脚本，L1-L20](https://github.com/Bandersnatch0x/amber-protocol/blob/f63c2a8d980dd73204dbd43cf7ba494eecf03d84/scripts/sync-version.js#L1-L20)）。因此在 HEAD 中，发布准备必须人工保持 DSH manifest 锁步；否则上述集成测试会在 tag workflow 中暴露漂移。工作区里有未提交的 F020 相关修改意图扩展这一同步范围，但它不是本次 HEAD 事实。
- HEAD 的 `scripts/verify-release.js` 只读取根 `package.json` 名称并查询该包的 GitHub Packages 版本，未检查 `dsh-amber-protocol`（[HEAD 脚本](https://github.com/Bandersnatch0x/amber-protocol/blob/f63c2a8d980dd73204dbd43cf7ba494eecf03d84/scripts/verify-release.js)）。因此当前 release verifier 不能证明 DSH 包已随主包发布。

### Registry 观测

在 2026-08-14 用 npm registry 元数据核验：

```text
amber-protocol@1.5.1       time: 2026-08-13T23:51:49.588Z
dsh-amber-protocol@1.5.1  time: 2026-08-13T23:52:21.314Z
```

核验命令：

```bash
npm view amber-protocol@1.5.1 time --json
npm view dsh-amber-protocol@1.5.1 time --json
```

这证明两个 `1.5.1` artifact 已存在且发布时间相差约 32 秒；它不能证明两者由同一个
workflow 发布，也不能推出未来每个稳定 tag 都会发布 DSH。

## 一手规则与决策影响

### 同一 tag 是否会同时触发两个 workflow

GitHub Actions 的 workflow syntax 将 `on.push.tags` 定义为 push tag 的 glob 过滤器；每个
workflow 独立匹配事件。官方文档：[Workflow syntax for GitHub Actions](https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions#onpushbranches-tags-branches-ignore-tags-ignore)。

因此，若主 workflow 和 DSH workflow 都写 `on.push.tags: ["v*"]`，同一个 tag push 会使两者
各自创建 run。两者之间不存在隐含的完成顺序；`needs` 只在同一个 workflow 的 jobs 中生效。
要表达“主包成功后再发 DSH”，官方支持的跨 workflow 事件是 `workflow_run`（[Events that
trigger workflows](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#workflow_run)），
但实现时必须显式传递并校验原始 tag、上游结论和 registry 目标。

### 是否每个稳定主包都发同版本 DSH

**按当前契约：是。** 理由是：

1. DSH 是公开可安装 bundle，而不是根包中可忽略的测试目录；两个包的 manifest 和集成测试
   已把版本相等设为可执行不变量。
2. npm 规定同一个包的 `name + version` 一旦发布就不可再次复用；要发布一个新 manifest，
   必须使用新版本（[npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish#description)）。
   即使运行时 patch 内容未变，新版本的 manifest 仍代表新的主包依赖和 release 对应关系。
3. SemVer 规定已发布版本的内容不可修改，任何修改必须作为新版本发布（[Semantic Versioning
   2.0.0，条款 3](https://semver.org/#spec-item-3)）。这支持为每个稳定主版本产生不可变
   DSH artifact，而不是重写旧 DSH tarball。

**按独立生命周期：不一定。** npm `dependencies` 允许声明 semver range（[package.json
   dependencies](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#dependencies)）；
   `^1.5.1` 在 1.x 兼容范围内可以解析更高的 1.x 主包。因此，若 bundle 真正无变化，可以
   不发布新的 DSH 版本，继续使用旧 DSH 包并让依赖解析主包更新。但这会带来：

- `dsh-amber-protocol` 的 `latest` 不再与主包稳定 tag 一一对应；
- lockfile/安装时间可能使用户拿到不同的 `amber-protocol` 解析结果；
- `scripts/verify-release.js` 无法发现“主 tag 有、DSH tag 无”的缺口；
- 现有集成测试的版本相等断言必须改为允许独立版本。

## 建议决策

### 推荐方案：保持 lockstep，并由一个编排入口发布

在 DSH 仍是 Amber 的官方安装入口时，采用以下规则：

1. 稳定 `vX.Y.Z` tag 只允许一个发布编排入口；先运行共享质量 gates，再发布根包，确认根
   包版本在目标 registry 可见后发布 `dsh-amber-protocol@X.Y.Z`。
2. 将 `publish-main` 与 `publish-dsh` 放在同一 workflow，用 job-level `needs` 表达顺序；
   两个 publish step 都保留“版本已存在则跳过、其他错误失败”的幂等策略。
3. 发布前把根版本、插件 manifest、`dsh/package.json` 的 version 和根依赖统一同步，并把
   DSH 版本加入 release verifier。当前 HEAD 的 `sync-version.js`/`verify-release.js` 尚未
   覆盖这两项，不能把工作区未提交 F020 改动当成已落地能力。
4. 对 `-rc`/`-beta` 明确统一策略。当前 `ci.yml` 的主 npm release 排除它们，但 GitHub
   Packages workflow 的 `v*` 过滤没有排除；新增 DSH workflow 时不要复制这种不一致。

### 只有在确认独立生命周期时才跳过未变化 DSH

若产品明确接受 DSH 不跟随每个 patch/minor 主包发布，应记录 ADR/发布策略并完成结构性调整：
移除测试中的强制版本相等、允许独立 dsh 版本/依赖策略、让 verifier 分别检查两个包的预期
映射、更新安装文档和 tag 到 DSH 的查询方式。仅在 workflow 中加入“bundle 无变化就跳过”会
制造未记录的 release 缺口。

## 核验命令

```bash
git rev-parse HEAD
git ls-tree -r --name-only HEAD .github/workflows
git show HEAD:.github/workflows/ci.yml
git show HEAD:.github/workflows/publish-github-packages.yml
git show HEAD:dsh/package.json
git show HEAD:tests/integration/dsh-bundle.test.js
npm view amber-protocol@1.5.1 time --json
npm view dsh-amber-protocol@1.5.1 time --json
```
