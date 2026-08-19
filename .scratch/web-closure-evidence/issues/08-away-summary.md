# 08 away_summary subtype 加固：两级判断 + 尾缀兜底钉死

## Objective

对应任务 #33。在 R8 降噪规则中加固 recap 判定的两级优先级，防止尾缀被误用作主信号：

1. **精确优先**：`subtype === 'away_summary'` → 主信号，直接判定为 recap。
2. **尾缀兜底（仅旧数据）**：`!subtype && RECAP_SUFFIX_PATTERN` 匹配 → 仅作兜底，覆盖缺少 subtype 字段的旧转录。
3. **降级 plain**：两者皆无 → 降级 plain 渲染（+1200 截断 + 可展开）。

注释钉死："尾缀永不得作主信号"，防止后续维护者把尾缀匹配提为主判定路径而覆盖真实 subtype。

## Blocking edges

- blocked by：票据 06（降噪管线 R8 基座，away_summary 加固在其上构建）。
- blocks：—。

## Status: DONE

## TDD evidence

从仓库取证：

- `apps/web/src/features/transcripts/transcript-denoise.test.ts` — `away_summary` 相关用例 3 处（grep `away_summary` 计数，覆盖精确优先 / 尾缀兜底 / 降级 plain 三态）。

## Verification

- 540 单测时点（引用会话口径：任务 #33 执行时 vitest 计数 540；其后随管线扩充收敛至 555）。

---
Commit: `3b392b73`
Status: DONE (retroactive evidence)
