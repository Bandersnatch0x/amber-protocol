# Amber Protocol Banner 重新生成提示词

**目标图片**:`amber-protocol-banner.png`  
**尺寸**: 1728×912 px (约 1.9:1 宽屏)  
**用途**: GitHub README 主 banner,项目首页视觉锚点  

---

## AI 图像生成提示词(中文)

为"Amber Protocol"项目生成一张 GitHub README banner 图片。

**项目定位**:Amber Protocol 是一个面向 AI 辅助工程的仓库本地治理层——帮助工程团队在 AI agent 编码时保持可审计、可交接、可验证。它是"治理优先"而非"执行优先",强调审批记录、只读检查、交接产物,刻意避免成为通用 agent 平台。

**视觉风格要求**:
- **色调**:暖色系,以琥珀色/蜂蜜金(#C8853F ~ #D4A574)为主色,搭配深炭灰(#2A2723)和暖白(#F6F1E8)。避免冷蓝、紫、纯黑。
- **氛围**:专业、可信、沉稳,有"治理/审计"的权威感,但不冰冷——温暖的琥珀色传达"保护"而非"限制"。
- **元素建议**:
  - 抽象几何图形:网格、边界框、审批印章轮廓、检查点节点,象征治理结构
  - 流动的琥珀色渐变波纹或光晕,代表"协议层"的包裹/保护
  - 可选:细微的代码片段纹理(作为背景,半透明),暗示"repo-local"语境
  - 避免:机器人、AI 拟人化图形、复杂插画、过于具象的图标
- **构图**:横向宽屏,左右留白适中,视觉重心居中偏左;可在右侧留白区域加淡化的 Amber Protocol 文字水印(可选)。
- **技术感与克制**:现代、扁平、微渐变,不要过度装饰或卡通化;图形边缘可以是锐利的(体现"边界/治理"),但整体保持温暖。

**情绪**:"你的 AI 编码工作在安全的治理层保护下,可追溯、可交接、可审计。"

---

## AI Image Generation Prompt (English)

Generate a GitHub README banner image for "Amber Protocol."

**Project Positioning**: Amber Protocol is a repository-local governance layer for AI-assisted engineering — helping teams keep AI agent coding auditable, transferable, and verifiable. It is "governance-first" rather than "execution-first," emphasizing approval records, read-only checks, and handoff artifacts, deliberately avoiding becoming a general agent platform.

**Visual Style Requirements**:
- **Color Palette**: Warm tones, with amber/honey gold (#C8853F ~ #D4A574) as the primary color, paired with deep charcoal gray (#2A2723) and warm off-white (#F6F1E8). Avoid cold blues, purples, or pure black.
- **Atmosphere**: Professional, trustworthy, steady, with the authoritative feel of "governance/audit," but not cold — the warm amber conveys "protection" rather than "restriction."
- **Suggested Elements**:
  - Abstract geometric shapes: grids, bounding boxes, approval stamp outlines, checkpoint nodes, symbolizing governance structure
  - Flowing amber gradient ripples or halos, representing the "protocol layer" as an enveloping/protective wrapper
  - Optional: subtle code snippet texture (as background, semi-transparent), hinting at the "repo-local" context
  - Avoid: robots, anthropomorphized AI figures, complex illustrations, overly literal icons
- **Composition**: Horizontal widescreen, moderate left/right margins, visual center slightly left; optionally add faded "Amber Protocol" text watermark in the right whitespace.
- **Technical Feel & Restraint**: Modern, flat design, subtle gradients; avoid over-decoration or cartoonish styles; shapes can have sharp edges (reflecting "boundaries/governance"), but keep the overall feel warm.

**Mood**: "Your AI coding work is safeguarded by a transparent governance layer — traceable, transferable, auditable."

---

## 工具推荐

- **Midjourney** v6+: `/imagine [上述英文提示词] --ar 19:10 --style raw --s 50`
- **DALL·E 3**: 直接粘贴中文或英文提示词,指定 1792×1024(最接近 1.9:1)后裁剪
- **Stable Diffusion**: 使用 `--width 1728 --height 912`,添加 negative prompt: `robot, character, cartoon, blue, purple, cold colors`

---

## 当前 Banner 参考

现有 `amber-protocol-banner.png`(1728×912)的视觉风格未知,若需要保持连续性,建议先用图像描述工具(如 GPT-4 Vision、Claude)分析现有 banner,提取关键元素后融入上述提示词。

---

生成后替换 `assets/readme/amber-protocol-banner.png`,并在 README.md 中保持引用 `![Amber Protocol](./assets/readme/amber-protocol-banner.png)`。
