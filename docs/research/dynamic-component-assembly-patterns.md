# Amber 可审计动态组件装配模式调研

> 研究范围：以 Cordis 固定源码修订 `8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4` 为一手证据，评估其上下文、服务、组件依赖、生命周期、隔离、重配置和热更新机制，给出适用于 Amber 同步传输、存储、投影和策略适配器的取舍。本文是研究材料，不改变 Amber 仍是治理层、默认不执行任意目标项目代码的边界。

## 结论摘要

Amber 应采用“声明式组件清单 + 显式依赖图 + 受审计生命周期状态机 + 分代切换”的思路，但不应采用通用插件运行时或源码热更新实现。

- **采用**：显式依赖注入、作用域隔离、组件实例拥有其副作用、逆序释放、同步配置校验、依赖变更触发受控重激活、失败状态可查询。
- **改造后采用**：把内存中的上下文、组件实例和副作用树改成持久化的 `AssemblyGeneration`、`ComponentInstance`、`DependencyEdge`、`LifecycleTransition` 和 `EffectRecord`；所有排序、标识、配置和状态转换都必须确定且可重放。
- **拒绝**：配置中的任意 JavaScript 求值、运行时动态模块导入、随机组件标识、目录监听自动换码、修改 Node 模块缓存、宽泛 `catch` 后仅记录日志继续运行，以及先销毁旧实例再尝试回滚。
- **延后**：源码级热更新、运行时下载第三方适配器、跨进程共享组件实例、依赖环自动求解。它们都不是首版同步 Runtime 的必要条件。

## 一手证据

### 上下文、服务与组件实例

Cordis 的 `Context` 由代理、根 Fiber、服务反射表、组件注册表和事件系统组成；派生上下文通过原型继承获得父上下文能力，`isolate()` 和 `intercept()` 再覆盖局部映射。[源码：`context.ts`](https://github.com/cordiverse/cordis/blob/8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4/packages/core/src/context.ts#L36-L76)

组件声明可以携带配置模式、依赖、提供的服务和拦截规则；同一组件回调对应一个 Runtime，Runtime 持有多个 Fiber 实例。[源码：`registry.ts`](https://github.com/cordiverse/cordis/blob/8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4/packages/core/src/registry.ts#L68-L95) [源码：组件注册](https://github.com/cordiverse/cordis/blob/8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4/packages/core/src/registry.ts#L193-L205)

固定修订中没有公开名为 `Fork` 的生命周期对象；承担“一次组件装配实例”职责的是 `Fiber`，派生作用域由 `Context.extend()` 表达。Amber 因此只应借鉴“分支实例拥有独立生命周期”的概念，不应复制某个不存在的 Fork API。

### 激活、依赖与状态

Fiber 明确区分 `PENDING / LOADING / ACTIVE / FAILED / DISPOSED / UNLOADING`，并依据依赖实现的可用性计算 epoch；依赖实现标识变化会导致卸载后重载。[源码：状态枚举](https://github.com/cordiverse/cordis/blob/8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4/packages/core/src/fiber.ts#L78-L85) [源码：依赖刷新](https://github.com/cordiverse/cordis/blob/8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4/packages/core/src/fiber.ts#L348-L413)

服务提供和撤销会扫描受影响的组件实例、重新检查依赖并等待它们完成状态收敛。[源码：服务提供与通知](https://github.com/cordiverse/cordis/blob/8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4/packages/core/src/reflect.ts#L175-L217)

配置通过 Standard Schema 同步校验；校验问题会转成显式 `ValidationError`，异步校验被拒绝。[源码：配置校验](https://github.com/cordiverse/cordis/blob/8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4/packages/core/src/fiber.ts#L34-L45)

### 副作用与释放

组件执行产生的 disposer 被 Fiber 收集；同一个 effect 内按 LIFO 顺序释放，父 Fiber 的释放会触发子组件释放。[源码：effect 收集与逆序释放](https://github.com/cordiverse/cordis/blob/8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4/packages/core/src/fiber.ts#L275-L340) [源码：父子生命周期](https://github.com/cordiverse/cordis/blob/8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4/packages/core/src/fiber.ts#L170-L199)

组件启动失败会进入 `FAILED`，但加载和卸载异常主要被写入 logger；卸载阶段对每个 disposer 的异常记录后继续，`await()` 最终只重新抛出组件的 `_error`。[源码：加载、卸载与等待](https://github.com/cordiverse/cordis/blob/8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4/packages/core/src/fiber.ts#L415-L465) 另外，组件解析包含空的 `catch {}`，这是 Amber 不应继承的隐藏失败路径。[源码：组件解析](https://github.com/cordiverse/cordis/blob/8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4/packages/core/src/registry.ts#L144-L150)

### 动态重配置、隔离与热更新

Loader 条目支持继承式禁用、配置差异检测和局部上下文修补；配置变化会调用 Fiber 更新，禁用会释放实例。[源码：条目更新](https://github.com/cordiverse/cordis/blob/8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4/packages/loader/src/config/entry.ts#L64-L132)

隔离通过局部/全局 realm 为服务名映射不同 Symbol，并在上下文修补时迁移实现、通知依赖者和回收不再引用的 realm。[源码：realm 与隔离](https://github.com/cordiverse/cordis/blob/8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4/packages/loader/src/config/isolate.ts#L25-L168)

热更新先遍历模块依赖图，把变化传播到依赖它的组件，再清理 ESM/CJS 缓存、导入候选模块、替换旧组件；导入失败会恢复缓存，替换失败则尝试重新注册旧组件。[源码：依赖传播](https://github.com/cordiverse/cordis/blob/8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4/packages/hmr/src/index.ts#L167-L227) [源码：缓存与回滚](https://github.com/cordiverse/cordis/blob/8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4/packages/hmr/src/index.ts#L274-L378) 一手测试覆盖了依赖变化、语法错误回滚和运行期 `apply` 失败；运行期失败会让旧处理器消失，说明这种回滚不是事务性的。[测试：导入错误回滚](https://github.com/cordiverse/cordis/blob/8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4/packages/hmr/tests/index.spec.ts#L282-L340) [测试：运行期错误](https://github.com/cordiverse/cordis/blob/8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4/packages/hmr/tests/index.spec.ts#L699-L762)

Loader 还允许配置值通过 `new Function` 和 `eval` 求值，并在缺少 ID 时用 `Math.random()` 生成 ID。[源码：动态求值](https://github.com/cordiverse/cordis/blob/8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4/packages/loader/src/config/utils.ts#L3-L18) [源码：随机 ID](https://github.com/cordiverse/cordis/blob/8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4/packages/loader/src/config/tree.ts#L47-L53) 两者都与 Amber 的确定性、可审计和可重放要求冲突。

## Amber 目标装配模型

### 组件定义与实例

组件定义必须来自版本化、静态注册的 `ComponentType` 清单，而不是扫描目录或导入任意包：

```text
ComponentType
  type_id                # transport.git, store.sqlite, projection.timeline, policy.tenant
  version
  category               # transport | store | projection | policy
  config_schema_id
  required_capabilities
  provided_capabilities
  allowed_scopes         # personal | team | tenant
  implementation_digest

ComponentInstance
  instance_id            # canonical scope + type_id + logical name 的内容哈希
  generation_id
  scope_ref
  canonical_config_hash
  state
  dependency_edges[]
```

定义注册表是不可变元数据；实例注册表按作用域隔离。未知 `type_id`、摘要不匹配、配置模式未知或能力越权均在装配前失败，不进行动态兜底。

### 作用域和隔离

个人、团队和组织租户共用一套装配协议，只改变 `scope_ref` 与允许能力：

| 形态 | 实例作用域 | 允许共享 | 强制约束 |
| --- | --- | --- | --- |
| 单人自维护 | repository / device | 本机存储、显式远端传输 | 离线可用；密钥不进入清单或事件 |
| 团队共享 | workspace / repository | 团队存储、投影、同步传输 | 成员身份与仓库授权先于激活 |
| 组织租户 | tenant / workspace / repository | 租户内服务池 | `tenant_id` 是每个实例、边和事件的必填分区键 |

组件不能获得可继承的“根上下文”。Runtime 为每个实例构造不可变的窄能力视图，例如 `AppendEvent`、`ReadSnapshot`、`CheckPolicy`、`EmitProjection` 和 `Clock`。跨作用域能力绑定在构造时校验，激活后不得换绑；跨租户引用直接拒绝。

### 依赖图

首版依赖方向固定为：

```text
policy <- store <- transport
          ^
          |
      projection
```

含义是 transport 依赖 policy 与 store，projection 依赖 store；策略失败时不得写入，存储失败时传输暂停并失败闭锁，投影失败只标记投影陈旧，不能破坏权威事件流。

每条 `DependencyEdge` 必须记录来源实例、目标能力、是否必需、模式版本和解析到的目标实例。激活前执行确定性拓扑排序；同层按 `instance_id` 升序。缺少必需依赖进入 `BLOCKED`，缺少可选依赖产生显式 `capability_absent` 事件。依赖环在校验阶段拒绝，首版不做隐式环拆解。

相比参考实现通过注册表扫描并刷新 Fiber，Amber 应把已解析边持久化，使“为什么启动、为什么停止、谁受影响”可以直接查询，而不是事后从内存状态推断。

### 生命周期状态机

```text
DECLARED -> VALIDATED -> PREPARING -> ACTIVE -> DRAINING -> DISPOSED
                 |          |            |
                 v          v            v
               BLOCKED    FAILED       FAILED
```

- `VALIDATED`：类型、摘要、配置、作用域、依赖图和策略均通过。
- `PREPARING`：只创建候选代资源，尚未取得权威写入权。
- `ACTIVE`：候选代完成 readiness 后，经原子 generation 指针切换成为当前代。
- `DRAINING`：停止接收新工作，等待在途同步完成，再按逆拓扑顺序释放。
- `FAILED`：保留失败阶段、错误类型、输入摘要和因果边；不能通过记录日志后伪装成可用。

每次转换产生追加式 `LifecycleTransition`，包含 `transition_id`、组件/代、from/to、原因、输入摘要、依赖快照、发起主体、策略判定、时间和结果。写操作必须先记“尝试”，完成后再记“结果”；进程崩溃后可以据此确定恢复点。

### 配置更新与分代切换

配置更新采用两阶段分代，而不是在活动实例上原地修改：

1. 解析并按 JSON Canonicalization Scheme 等确定规则规范化配置，计算哈希。
2. 用模式校验配置，构造候选依赖图并执行策略检查。
3. 以 `generation = current + 1` 创建候选实例，按拓扑序 `prepare`。
4. 对 transport/store 执行只读 readiness；任何会扩大权限或产生外部写入的步骤仍需 Amber 审批。
5. 单次条件写入切换 active generation；旧代随后进入 `DRAINING`。
6. 按逆拓扑顺序释放旧代；组件内部副作用按 LIFO 释放。

候选失败时只释放候选资源，当前代继续服务；不允许“先删旧实例、再试新实例、失败后尽力重建旧实例”。因此参考实现的 effect 所有权和逆序释放值得采用，而源码热更新的缓存回滚路径应拒绝。

### 失败传播规则

| 故障 | Runtime 行为 | 审计要求 |
| --- | --- | --- |
| 配置或依赖图无效 | 不进入 `PREPARING` | 记录全部校验问题和配置哈希 |
| policy 不可用/损坏 | 所有变更与同步写入 fail closed | 记录拒绝原因；不得换用弱策略 |
| store 不可用 | transport 停止确认新写入；projection 标记 stale | 记录最后确认 offset 和受影响实例 |
| transport 不可用 | 权威本地事件保留，实例进入 `FAILED` 或显式重试态 | 每次重试单独记 attempt/result；无静默 fallback |
| projection 失败 | 权威事件流不回滚；投影可从已知 offset 重建 | 记录 source offset、schema 和失败事件 |
| disposer 失败/超时 | 聚合错误并使 generation 处于未完全释放状态 | 保留未释放 EffectRecord，阻止误报完成 |

释放器必须幂等并有明确超时；多个释放错误用聚合错误返回。参考实现“记录后继续”的方式适合尽力清理，但不适合作为 Amber 的最终状态语义：继续清理可以，最终结果必须失败且可查询。

## Adopt / Reject / Defer

### Adopt

1. **显式组件依赖**：组件只声明所需/提供能力，Runtime 解析并持久化依赖边。
2. **实例级生命周期状态机**：把 `PENDING/LOADING/ACTIVE/FAILED/...` 思路扩展成审计友好的状态与转换记录。
3. **作用域隔离**：保留局部实例、共享实例和命名 realm 的思想，但用显式 `scope_ref` 与租户分区取代原型链和 Symbol 身份。
4. **副作用所有权**：所有定时器、订阅、连接、锁和 watcher 都必须由创建它的实例登记，并在释放时逆序处理。
5. **配置先校验后激活**：配置错误必须在资源创建前暴露；规范化后的值和模式版本进入审计事件。
6. **依赖变更驱动重装配**：能力提供者改变时，只重建依赖闭包，不重启无关组件。

### Reject

1. **任意代码型插件**：首版只允许静态注册、摘要固定的内建适配器。
2. **配置求值与随机 ID**：禁止 `eval`、`new Function`、环境隐式插值和未记录随机数；ID 与排序必须由规范化输入确定。
3. **自动源码热更新**：文件变化不能自动获得装配或外部写入权限。
4. **内部模块缓存操作**：不依赖 Node 私有加载器，也不把进程内缓存恢复当作事务回滚。
5. **隐藏失败**：禁止空 `catch`、仅打日志继续、自动切换到备用 store/policy，或把部分释放标成成功。
6. **环境式全局上下文**：组件只拿到最小能力集，不能沿原型链访问未声明服务。

### Defer

1. **第三方适配器包动态安装**：待签名、来源、撤销和审批模型明确后再设计。
2. **源码级无停机替换**：首版通过进程/组件分代和连接排空满足更新需求。
3. **跨租户组件池**：先保证租户内隔离；跨租户复用会扩大计费、密钥和数据泄漏面。
4. **依赖环和可选实现自动择优**：首版要求单一、显式绑定，避免不可解释的运行时选择。
5. **任意扩展的事件脚本**：只支持注册表内的确定 Action Type/Function；动态脚本不进入 Runtime。

## 首版验收不变量

1. 同一组件清单、规范化配置和能力目录必须产生相同的 `instance_id`、依赖图、拓扑序和 generation 计划。
2. 未知组件、无效配置、依赖环、跨租户边或策略不可用时，零适配器副作用发生。
3. 候选代激活失败时，当前代的实例、offset 和写入权保持不变。
4. 每个外部副作用都能追溯到组件实例、generation、审批/策略判定和生命周期转换。
5. Runtime 崩溃后仅凭持久事件即可判断每个实例是继续排空、重新准备还是人工介入，不能依赖聊天记录或内存注册表。
6. projection 可丢弃重建，权威事件不可由 projection 或 transport 回写覆盖。
7. 释放发生在逆依赖序，组件内部为 LIFO；任何释放失败都阻止该 generation 被标记为完整 `DISPOSED`。
8. Runtime 不执行目标仓库任意命令、不调度智能体、不自动发布外部变更；这些边界继续服从 Amber ADR-0001/0005 和审批机制。

## 建议决策

首版将动态装配限定为“已编译适配器的确定性生命周期管理器”，而不是“通用插件或智能体执行 Runtime”。实现顺序应为：组件清单与模式 -> 依赖图与确定排序 -> 生命周期/审计事件 -> 分代切换 -> 四类内建适配器 -> 故障恢复。只有这些不变量通过跨个人、团队、租户三种作用域验证后，才重新评估动态包加载或源码热更新。
