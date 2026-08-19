# 10 apps/web 格式门禁与一次性重排

## Objective

对应任务 #35/#37。为 apps/web 建立独立 Prettier 格式门禁，与根门禁协同：

- **`apps/web/.prettierrc.json`**：`singleQuote` / `semi` / `tabWidth 2` / `trailingComma "all"` / `printWidth 100` / `endOfLine "auto"`（量化取证决策，见 Notes）。
- **根 `format:check` 聚合**：`prettier --check . && npm --prefix apps/web run format:check`，根门禁串入 apps/web 子门禁。
- **CI ci.yml 自动覆盖**：「Check format」步骤跑 `npm run format:check`，PR 必过。
- **`src/routeTree.gen.ts` 入 `apps/web/.prettierignore`**：TanStack Router 生成产物，每次路由变更重写，格式化会无谓 churn 门禁红（文件头已声明 lint/typecheck 豁免）。
- **113 文件零行为重排**：纯空白 / 换行 / 引号调整，无逻辑改动。

## Blocking edges

- blocked by：票据 01（dev 端口稳定 → dev 可起 → 格式检查可运行）。
- blocks：—（收尾）。

## Status: DONE

## TDD evidence

- 无专门测试文件（门禁通过 `npm run format:check` 验证，不通过单测覆盖）。

## Verification

- 根 `npm run format:check` 全绿：根 prettier 段 + apps/web prettier 段均输出「All matched files use Prettier code style!」。

## Notes

- **endOfLine `auto` 决策原因**：Windows/Linux 混合团队，强制 `lf` 会在 Windows 签出时产生噪声 diff（CRLF→LF 转换触及大量行）；`auto` 让各平台保留本地行尾、提交时不强行转换，门禁只校验非行尾格式问题。
- 重排与功能改动合并提交于 commit `3b392b73`（同一次收敛提交），故不需单列 `.git-blame-ignore-revs` 条目——blame 仍可追溯每行最后语义改动。

---
Commit: `3b392b73`
Status: DONE (retroactive evidence)
