# REQ-21 — 设计系统遵循（Obsidian & Amber Pulse）

> "`/knowledge` follows `.stitch/DESIGN.md` (Obsidian & Amber Pulse v10): master-detail with a
> right rail, amber/cobalt dual accents, dual theme, no new visual grammar."
>
> — F059 spec L148-149

**Verdict:** partial · confidence: high

---

## What this demands of an implementation

四个可静态核查的子款：
1. 页面布局为 master-detail，右侧为 rail（详情/操作栏）。
2. 双 accent：amber gold（`#F59E0B`）与 cobalt blue（`#2563EB`）按 `.stitch/DESIGN.md` 的角色分工使用——DESIGN.md L107-108 规定 amber = 治理权威/挂起关卡/脉冲，cobalt = 开发者交互（键盘焦点、active selection、可执行按钮）。
3. 双主题（Obsidian 深色 + Porcelain 浅色），随主题切换全页生效。
4. 不引入新的视觉语法（复用既有 card/按钮/badge/间距体系）。

---

## Where enforcement lives

**1. master-detail + 右 rail — 成立**

```tsx
// KnowledgeMapPage.tsx:1212-1213
<div className="flex flex-col lg:flex-row gap-4">
  <div className="flex-1 min-w-0">          // master：画布 + 过滤器
// KnowledgeMapPage.tsx:1307
<aside className="w-full lg:w-96 shrink-0 space-y-4">   // 右 rail：Detail/Ask + Recent & Drift
```
到得了：lg 断点以上恒定 384px 右栏；到不了：窄屏折叠为纵向堆叠（`flex-col`），rail 移至地图下方——响应式降级，非语法违背。

**2. 双主题 — 成立**

- `apps/web/tailwind.config.js:4` `darkMode: 'class'`；obsidian/porcelain 色板定义于 tailwind.config.js:8-24，与 DESIGN.md L5-19 的十六进制值逐一相同（`#080B10/#0F141C/#151D28/#1B2433`、border rgba 0.08）。
- 主题类挂载：`apps/web/src/lib/theme-provider.tsx:31` `root.classList.toggle('dark', theme === 'dark')`。
- 页面内 `dark:` 变体全覆盖（如 KnowledgeMapPage.tsx:612 `bg-white dark:bg-obsidian-elevated`，:313 `bg-slate-50 dark:bg-obsidian-surface`）。
- e2e 双主题测试：`apps/web/tests/e2e/knowledge.spec.ts:611-649`（dark palette 断言 + in-app toggle 实测）。

**3. amber accent — 成立；cobalt accent — 失守**

amber：选中节点 `border-amber-400 ... shadow-glow-amber`（KnowledgeMapPage.tsx:613），高亮边 `#f59e0b`（:502），rail 激活态 `bg-amber-500/10 ... text-amber-700`（:1321），focus ring `focus:ring-amber-500/40`（:1220）、`focus:ring-amber-500/30`（:680）。

cobalt：token 已在 `tailwind.config.js:32-37` 定义（`cobalt.DEFAULT: '#2563EB'`）、`glow-cobalt` 阴影在 :78 定义，**但整个 `apps/web/src` 零使用**（见 Searched）。页面实际使用的蓝色是 Tailwind 默认 `blue-*` 工具类与硬编码 `'#3b82f6'`（KnowledgeMapPage.tsx:44 knowledge 层 stroke；:42-44 `bg-blue-500`/badge；:683 Ask 披露框 `border-blue-200 bg-blue-50 ... text-blue-800`；:766 superseder 链接 `text-blue-700`）。`#2563EB` 本身不出现在页面代码中。且 DESIGN.md L108 分配给 cobalt 的角色（键盘焦点、active selection）在本页由 amber 承担（:613、:1220、:680）。

**4. 无新视觉语法 — 成立**

页面复用 `apps/web/src/index.css` 既有组件类：`.page-container`（:73）、`.card`（:77）、`.btn-secondary`（:107）、`.bg-dot-matrix`（:53）。唯一新 class `knowledge-edge-inferred`（KnowledgeMapPage.tsx:507）是无样式定义的裸标记类（供 e2e 选择器 knowledge.spec.ts:423 使用），虚线样式经内联 `strokeDasharray: '6 4'`（:512）实现，且虚线推断边是 spec L114-116 自己规定的处理。

---

## Paths walked

- 布局路径（lg 双栏 / 窄屏堆叠）✓ — KnowledgeMapPage.tsx:1212, :1307
- 深色主题路径（`.dark` class → obsidian token）✓ — theme-provider.tsx:31 → tailwind.config.js:8-16
- 浅色主题路径（默认 → 白卡 + slate 边框）✓ — index.css:77-79
- amber 交互路径（选中/悬停/focus/rail 激活）✓ — KnowledgeMapPage.tsx:613, :1220, :1321
- cobalt token 使用路径 ✗ — 全 src 无任何 `cobalt`/`accent` 类命中
- 新组件类路径 ✗（未新增带样式的组件类）— experience.css 中 grep `knowledge` 0 命中

---

## Searched

- `cobalt`（apps/web 全仓）→ 2 命中，均在 `tailwind.config.js:32, :78`（定义处），src 0 命中。
- `(bg|text|ring|border|fill|stroke)-accent|glow-cobalt|bg-cobalt|text-cobalt`（apps/web/src）→ 0 命中。
- `knowledge-edge-inferred` → 2 命中：KnowledgeMapPage.tsx:507（赋 class）、tests/e2e/knowledge.spec.ts:423（选择器）。
- `knowledge`（apps/web/src/experience.css）→ 0 命中（无页面专属新 CSS）。
- `classList` dark 挂载 → theme-provider.tsx:31。

---

## How the verdict was reached

四个子款中三个（master-detail 右 rail、双主题、无新视觉语法）在代码层完整成立并有 e2e 覆盖；amber accent 大量且按 DESIGN.md 角色使用。失守点是"dual accents"的 cobalt 半边：专用 cobalt token 是死配置，页面蓝色全部来自默认 `blue-*` 工具类（`#3b82f6` 系而非 `#2563EB`），且 DESIGN.md L108 规定的 cobalt 角色（focus/active selection）在本页由 amber 占据。主路径（视觉上确有 amber+蓝双色系）成立、规定路径（cobalt token 与角色分工）失守 → partial。注意这不是本页独有偏差：全 src 均不使用 cobalt/accent token（如 index.css:127-129 `status-badge-running` 也用 `blue-*`），故未构成"新视觉语法"。

---

## Open questions

1. 蓝色观感是否达到 DESIGN.md 的 cobalt 视觉意图（`#3b82f6` vs `#2563EB` 的色差、glow 效果）——需浏览器验证。
2. spec 写 "Obsidian & Amber Pulse v10"，`.stitch/DESIGN.md` 文件内无 "v10" 版本标记（frontmatter name 仅为 "Amber Protocol Web Viewer — Obsidian & Amber Pulse"）——版本对应关系无法从文件判定，属文档发现。
3. "dual accents" 的验收语义 spec 未定义：是"页面出现 amber+蓝两种强调色"（已满足）还是"使用 DESIGN.md 的 cobalt token 并遵循其角色分工"（未满足）。本记录按后者从严裁定；若按前者，此款可升为 implemented。
