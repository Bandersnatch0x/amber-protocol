# F092：只读 Feature 交付看板与续接导航

spec_id: F092
**Status:** accepted
updated: 2026-11-27
owner: repository-maintainer
feature: F092
provenance: 本次对话的方案评审及用户“按建议来”；用户另确认本次沿用 docs/product/DESIGN.md，执行完整界面检查。

## L1 目标和非目标

仓库维护者在既有 `/governance` 页查看 Feature 交付状态、显式关联的 Amber Session、记录阶段和证据摘要，并打开既有续接入口。Feature 看板不是通用任务管理器。

不增加任务实体、状态机、调度器、依赖或外部服务。不自动派发 Agent、批准、验收、执行命令或拖拽改状态。不改变既有 Session 控制，不提交或推送代码。

## L2 数据和权威

- 新增 `continuity.governance.board` 只读 query，经 `scripts/lib/web-adapter.js` 调用确定性读取模块。客户端不能传入路径或执行选项。
- Feature 只读来源为启动时选定仓库内固定的 `feature_list.json`；Session 来源为 `.amber/sessions/*/manifest.json`，不回退 `.harness`。读取须约束真实路径，拒绝越界符号链接或 Junction。
- 返回快照时间以及分开的 Feature、Session 读取状态和错误。Feature 字段限定为 id、title、status、priority、notes、evidence；Session 字段限定为 sessionId、feature、goal、status、currentStage。
- 使用既有 Feature 校验和 Session schema，不维护第二套合法状态表。无效或不可读来源不转为空列表；坏 Session 可被逐项标明，同时保留其他有效 Session。
- 仅用 `manifest.feature` 显式关联。没有 feature 的 Session 单列为未绑定；指向不存在 Feature 的 Session 单列并保留原 feature 引用。Feature 读取失败时不宣称引用不存在。
- 多个 Session 全部保留，不计算聚合进度。Session 阶段是 manifest 的已记录投影，缺失时显示未知，不推进游标。
- Feature `passing` 仅显示原状态及中性说明，不将非空证据升级为实际执行或独立验证。Feature、Session、spec 和票据状态互不提升。

## L3 信息布局

在治理页现有筛选和报告区域附近增加只读聚焦列表，不替换或默认折叠既有报告。原五状态保留为筛选维度和状态标识，不再强制五列。窄屏自然换行并顺序展示，不依赖拖拽或横向操作。

每行首先展示 Feature 标识、标题、原状态和显式关联 Session 数量；使用原生可访问的展开区域查看 priority、完整 notes、evidence 和全部显式关联 Session 的状态、记录阶段及详情链接，不静默截断。无关联 Session 显示明确空状态。未绑定和未解析引用的 Session 独立列示，不随 Feature 筛选消失。

展示修订依据：用户在第二轮 A/B 预览及 A 聚焦列表推荐之后明确要求“你来评审 按你的建议来”，随后要求继续。因此采用 A，不把 B 的布局切换器作为本次必须实现的产品功能。该方向授权不代表预览工具事务已确认，也不代表产品验收；L1/L2/L4/L5/L6 和执行权限不变。

## L4 操作

- 手动刷新重新获取看板快照；筛选只改变页面展示。
- Feature 聚焦复用治理页 featureId 和既有建议查询，不为每张卡计算昂贵治理报告。
- Session 链接打开既有详情及其交接查看入口。下一步命令沿用既有只复制、不执行的组件，不伪造按卡片定制的建议。
- 页面不调用 session run、lease、settle、控制 mutation 或任何写入接口。进入详情后的既有独立控制不属于看板操作。

## L5 加载、失效和异常

首次加载显示读取中。刷新失败时明确旧快照已失效，不将缓存当当前成功；显示最后成功获取时间和错误。每个来源可独立不可读取或部分读取失败。合法空目录、空 Feature 列表与读取失败分别呈现。损坏、缺失或越界来源必须可见，不归类为 blocked 或完成。

时间语义按用户选择A明确：请求失败，或任一来源为error/partial，均属于读取失败。只有Feature和Session两个来源均为ok，才更新本页的最后成功时间；后续来源错误和部分失败不得用诊断快照的生成时间替换它，须标明旧快照失效。继续展示本次来源错误及可用记录，不要求保留失败来源的旧条目。首次来源失败而本页尚无健康读取记录时明确说明，不伪造成功时间；该历史仅在本页存续期间保留，不新增持久化写入。恢复为两来源均ok后，清除失效提示并更新时间。

完整读入有效列表；不静默截断。初版不轮询、不自动窗口聚焦刷新。用户点击刷新、筛选和复制建议都不产生仓库写入。所有文案进入既有中英文 i18n，采用原生键盘可访问控件、语义标题、链接和错误提示。

## L6 验收条件

1. Given 五种原状态和自述证据，When 打开看板，Then 所有 Feature 按原状态展示，passing 不显示为独立验证。证据为读取测试、渲染测试及真实页面截图；seed 为五状态样本。
2. Given 一张 Feature 的两个 Session、一个未绑定 Session 和一个未知 feature 引用，When 查看和筛选，Then 不猜绑、不丢失、不折算总进度，并保留引用信息。证据为 query 和交互测试；seed 为关联样本。
3. Given 损坏、缺失和越界来源，When 读取或刷新，Then 明确不可读取或部分失败，不报没有任务或成功；旧快照注明失效和时间。证据为读取测试及错误状态交互截图；seed 为坏来源样本。
4. Given 一个固定临时仓库，When 连续 query、打开页面、刷新和筛选，Then 文件树和文件字节不变，不生成 lease、pending request 或账本。证据为前后文件快照断言及 mutation 请求拦截；seed 为只读样本。
5. Given 正常、空、加载和失败状态，When 使用宽屏、窄屏和键盘，Then 既有报告保留、操作可访问、长内容可换行，Session 和交接入口指向既有页面。证据为浏览器交互、截图和适用静态检查；seed 为界面状态样本。

## 交付状态

规范已确认不代表代码完成。实施、测试、独立评审及发布证据分别记录在 `docs/plans/F092-Read-only-feature-delivery-board.md`。未合并前交付保持 pending-publish。
