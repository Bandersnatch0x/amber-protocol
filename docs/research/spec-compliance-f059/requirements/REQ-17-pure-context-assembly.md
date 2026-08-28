# REQ-17 — 上下文装配是 (snapshot, focusNodeId, promptVersion) 的纯函数，2-hop 稳定序，overflow 类型化

> "Context assembly is a pure function of `(snapshot, focusNodeId, promptVersion)` over the deterministic snapshot only — inferred edges and summaries never enter QA context (no inference-on-inference). With `focusNodeId`, assembly uses the 2-hop neighborhood in stable order; `contextDigest` (sha256) records exactly what was fed. Overflow is a typed error, never silent truncation."
> — F059 spec L129-133

**Verdict:** implemented · confidence: high

---

## What this demands of an implementation

1. 装配函数的输出只由三元组决定：不得读时钟、随机源、环境变量或磁盘。
2. 只吃确定性快照：inferred 边、inferred 摘要不得进入 QA 上下文（含 2-hop 遍历本身）。
3. 有 focus 时取 2-hop 邻域，输出顺序稳定（与输入顺序无关）。
4. `contextDigest` 是对实际喂给模型的上下文的 sha256。
5. 超限抛类型化错误，任何路径都不得静默截断。

---

## Where enforcement lives

**(1) 纯函数签名与体内零环境依赖** — `apps/web/server/lib/knowledge-qa.ts:128-165`：

```ts
export function assembleKnowledgeContext(
  snapshot: KnowledgeGraphDTO,
  focusNodeId: string | undefined,
  promptVersion = CITED_QA_PROMPT_VERSION,
): ContextAssembly {
```

整个 `knowledge-qa.ts` 对 `Date\.|Math\.random|process\.env` 零命中（全文件 grep）。时间戳只出现在 provider 交换元数据（`knowledge-llm.ts:153`），在 digest 之外。`promptVersion` 被嵌入 context JSON（`knowledge-qa.ts:156`），因此 digest 绑定它。

**(2) 只吃确定性层** — 两道 origin 过滤：2-hop 遍历只走 `edge.origin === 'deterministic'`（`knowledge-qa.ts:97`）；context 的 edges 再次过滤 `edge.origin === 'deterministic'`（`knowledge-qa.ts:139-141`）。inferred 摘要根本不在 `KnowledgeGraphDTO` 里（`knowledge-dto.ts:34-40` 无 summaries 字段；摘要只存在于独立的 `SemanticResultDTO`，`knowledge.ts:66-129` 单独返回，服务端从不合并回快照）。客户端展示层的合并（`KnowledgeMapPage.tsx:1014-1018`）注释明示 "never feeds back into DTO"，且 ask 请求只上送 `{question, focusNodeId, allowExternal}`——服务端自行重读快照。

**(3) 2-hop + 稳定序** — BFS 两轮（`knowledge-qa.ts:100-108`，`for (let depth = 0; depth < 2; ...)`，src/dst 双向扩张）；无 focus 时取全量节点集（`knowledge-qa.ts:93-94`）。排序器 `stable()`（`knowledge-qa.ts:88-90`）对 nodes 按 `node.id`、edges 按 `` `${src}\0${dst}\0${verb}` ``、drift 按 `` `${nodeId}\0${path}\0${detail}` `` 排序（`knowledge-qa.ts:134-153`），再经 `canonicalJson` 键排序（`scripts/lib/core/context-hash.js:123-133`，`Object.keys(value).sort()` 为码元序）。

**(4) digest** — `knowledge-qa.ts:164` `contextDigest: sha256Hex(context)`；`sha256Hex` 即 `crypto.createHash("sha256")`（`context-hash.js:22-24`）。喂给模型的 userMessage 为 `JSON.stringify({ question, context: assembly.context })`（`knowledge-qa.ts:222`）——context 字段与被 digest 的字符串逐字节同一；question 另有 `questionDigest`、整体有 `exchangeDigest`（`knowledge-qa.ts:235-236`）。

**(5) overflow 类型化、无截断** — `assertContextBounds`（`knowledge-qa.ts:112-126`）对节点数>256、边数>512、drift>256、字节数>512KiB 一律 `throw new KnowledgeAskError('context-overflow')`；`knowledge-qa.ts:134-153` 的装配管线只有 filter/sort/map，没有 `slice`/裁剪。router 将其映射为 `BAD_REQUEST` 且 message 即错误码（`knowledge.ts:152-157`）。对照组：语义层的 `normalizeNodes` 确实做 `body.slice(0, bodyLimit)` 截断（`knowledge-llm-prompts.ts:174-179`），QA 装配不走那条管线。

**测试锁定** — `apps/web/tests/server/knowledge-qa.test.ts`：L99-118 输入 nodes/edges/drift 全反转后 context 字节相等，且用独立 `crypto` 复算 digest 相符；L120-136 断言 focus=node:a 的 2-hop 恰为 `['node:a','node:b','node:c']`、inferred 边（fixture L67 `node:a→node:d origin:'inferred'`）被排除、context 内不含 `"origin":"inferred"`；L138-169 断言 257 节点与 256×1000 多字节 body 两种超限均抛 `context-overflow` 而非截断。本机 `npx vitest run` 全绿。

---

## Paths walked

- ✓ 无 focus：全节点 + 全确定性边 + 全 drift，稳定排序后装配（`knowledge-qa.ts:93-94,133-153`）。
- ✓ 有 focus 且存在：2-hop（`knowledge-qa.ts:96-109`）。
- ✓ focus 不存在于快照：`throw KnowledgeAskError('invalid-focus-node')`（`knowledge-qa.ts:95`），在 provider 调用前（`knowledge-qa.test.ts:314-323`）。
- ✓ 节点数/边数/drift 数/字节数四路超限：同一 `context-overflow`（`knowledge-qa.ts:118-125`）。
- ✓ inferred 边参与 2-hop 的路径：不可达——遍历集在 `knowledge-qa.ts:97` 已预过滤。
- ✓ 摘要进入 context 的路径：不可达——快照 DTO 无该字段（`knowledge-dto.ts:34-40`）。
- ✓ promptVersion 非默认值路径：参数直通 context（`knowledge-qa.ts:131,156`）；`answerKnowledgeQuestion` 固定用默认值（`knowledge-qa.ts:221`）。

---

## Searched

- `Date\.|Math\.random|process\.env` in `knowledge-qa.ts` → 0 命中。
- `slice|substring|truncat` in `knowledge-qa.ts` 装配段（L88-165）→ 0 命中（`Buffer.byteLength` 仅用于判超）。
- `origin === 'deterministic'` in `knowledge-qa.ts` → 2 命中（L97, L140）。
- `"origin":"inferred"` 反证断言 → `knowledge-qa.test.ts:134`。
- `localeCompare` in `knowledge-qa.ts` → 1 命中（L89，见 Open questions）。
- `sort\(|localeCompare` in `scripts/lib/core/knowledge-graph.js` → 底层图输出用码元比较 `(a.id < b.id ? -1 : 1)`（L807）与 `readdirSync().sort()`（L125,152,178,298），不用 localeCompare。

---

## How the verdict was reached

不是 `partial`：五项子约束各有正向实现行号与针对性测试，四条 overflow 分支全部到达同一类型化错误，inferred 排除有双重过滤加反证断言——没有失守的具体路径。不是 `contradicted`：未发现任何截断、时钟或快照外数据源进入 context 的代码。不是 `stronger-than-spec`：装配约束与 spec 逐条对齐，上限常量（256/512/256/512KiB，`knowledge-qa.ts:32-35`）是 spec "Overflow is a typed error" 的必要参数化而非额外约束。唯一的纯度疑点（localeCompare 的环境 locale 依赖）在现有 id 字符集与单机部署下无可观测差异、测试通过，不足以把主判定压到 partial，遂入 Open questions。

---

## Open questions

1. `stable()` 用无参 `localeCompare`（`knowledge-qa.ts:89`）——排序结果依赖 Node 进程的默认 ICU locale（如 da/丹麦语对 "aa" 的集序特例），跨不同 locale 的服务器上同一快照理论上可产生不同 context 字节与不同 `contextDigest`；底层图解析器用的是码元比较（`knowledge-graph.js:807`），两层排序器不一致。建议改为 `<` 码元比较或 `localeCompare(..., 'en')` 钉死，或在 spec 中记录"单进程内稳定"即为满足。
2. 排序键用 `\0` 拼接（`knowledge-qa.ts:143,152`）——ICU 集序中控制字符可忽略，两个不同 key 可能比较相等，此时次序回退到输入序（JS sort 稳定）；与第 1 条同根，现实 id 集合中未发现可构造的碰撞对。
3. `contextDigest` 覆盖 context 而非完整 userMessage——spec 措辞 "records exactly what was fed" 以 context 为对象成立（`knowledge-qa.ts:222` 逐字节嵌入），完整交换由 `exchangeDigest`（L236）补齐；spec 未提 `exchangeDigest`/`questionDigest`，属未记录的加强项。
