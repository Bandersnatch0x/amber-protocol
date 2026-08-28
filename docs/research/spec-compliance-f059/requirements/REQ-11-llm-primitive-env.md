# REQ-11 — 唯一 LLM primitive、中性 env、三 facade

> "Provider access goes through one primitive (`KnowledgeLLM.complete`) behind neutral env configuration (`LLM_API_KEY`, `LLM_PROVIDER`, `LLM_MODEL`, `LLM_BASE_URL`; server-only). Three prompt facades sit on the primitive: semantic edges, node summaries, cited QA."
> — F059 spec L107-109

**Verdict:** implemented · confidence: high

---

## What this demands of an implementation

1. 供应商访问（HTTP 端点、认证头、报文格式）收敛到唯一 primitive；其余代码不得直连供应商。
2. 配置项恰为四个中性命名 env（无 OPENAI_/ANTHROPIC_ 等厂商前缀）。
3. env 仅服务端可读——客户端 bundle 不得接触。
4. 三个 prompt facade（semantic edges / node summaries / cited QA）全部落在该 primitive 之上。

---

## Where enforcement lives

**唯一 primitive**（`apps/web/server/lib/knowledge-llm.ts:1-4` 模块头）：

```ts
/**
 * VENDOR-AWARE BOUNDARY — this is the ONLY module that may reference
 * provider-specific HTTP endpoints, authentication headers, or API formats.
 */
```

- 出网点唯一：全 `apps/web/server` 目录 `fetch(` 仅两处——`knowledge-llm.ts:246`（primitive 内 `requestTextWithBounds`）与 `error-forwarder.ts:24`（错误上报 webhook，非 LLM 域）。供应商细节（`api.openai.com` 回退、`x-api-key`、`anthropic-version`）全部在 `completeOpenAI`（L297-333）/`completeAnthropic`（L335-369）内。
- 入口形态：`complete`（L135-142）是 `completeWithMetadata`（L144-170）的薄包装（L141 直接委托）；两者同模块、同一 HTTP 路径。
- 边界回归测试（`knowledge-llm.test.ts:227-249`）：扫描 `server/` 下全部 `knowledge*.ts`，断言 vendor token（`api.openai.com`、`api.anthropic.com`、`x-api-key`）只允许出现在 `knowledge-llm.ts`，且被扫文件 ≥ 4——空扫即失败。

**中性 env**（`knowledge-llm.ts:108-117` `readConfig`）：

```ts
const apiKey = process.env.LLM_API_KEY ?? '';
const provider = parseProvider(process.env.LLM_PROVIDER);
return { apiKey, provider, model: parseModel(process.env.LLM_MODEL),
  baseUrl: validateBaseUrl(provider, process.env.LLM_BASE_URL ?? '') };
```

四个规格 env 逐一对应；另有 `LLM_TIMEOUT_MS`（L101，上限 30s）——同为中性命名，且已在运维文档登记（`docs/wiki/engineering/runbook.md:27-31` 五行表格）。

**server-only**：全仓 grep `LLM_API_KEY|LLM_PROVIDER|LLM_MODEL|LLM_BASE_URL|LLM_TIMEOUT_MS` → 8 文件：`server/lib/knowledge-llm.ts`（唯一运行时读取点）、两个服务端测试、`playwright.config.ts:59-62`（Node 侧注入 e2e stub env）、`.env.example:23-28`（标注 "server-only"）、runbook、spec、评审文档。`apps/web/src`（客户端）0 命中；`vite.config.mts` 无 `define`/`envPrefix` 覆写（grep 0 hits）→ Vite 默认只暴露 `VITE_*`，`LLM_*` 不可能进 bundle。客户端可见的只有 `semanticStatus` query 返回的 `{available, provider, model}`（`routers/knowledge.ts:62-64`），不含 key/URL。

**三 facade 全部过 primitive**：
- semantic edges：`knowledge-llm-prompts.ts:240` `complete('semantic-edges', SEMANTIC_EDGES_PROMPT, ...)`；
- node summaries：`knowledge-llm-prompts.ts:258` `complete('node-summaries', NODE_SUMMARY_PROMPT, ...)`；
- cited QA：`knowledge-qa.ts:223` `completeWithMetadata('cited-qa', CITED_QA_PROMPT, userMessage)`。

全仓 `knowledge-llm'` 导入面仅 4 处生产文件：router（getStatus）、prompts（complete/getCacheIdentity）、qa（completeWithMetadata）、cache（无导入）——无第五个消费者，无旁路。

---

## Paths walked

- ✓ openai 分支（L159 → completeOpenAI）、anthropic 分支（L157-158 → completeAnthropic）、stub 分支（L156 → buildStubResponse，纯本地，无出网）。
- ✓ 三 facade → primitive 调用链逐一确认（上节行号）。
- ✓ 客户端读取路径（不可达）：src 无 `process.env.LLM`/`import.meta.env.LLM`；Vite 前缀墙。
- ✓ 非法 env 路径：非白名单 provider 抛 `invalid-provider`（L54-60）、坏 model 抛 `invalid-model`（L62-72）、坏 URL（含凭据/query/非 https 非回环）抛 `invalid-base-url`（L78-98）——`knowledge-llm.test.ts:66-111` 全覆盖，且 L87 断言拒绝发生在任何 fetch 之前。

---

## Searched

- `fetch(` in `apps/web/server` → 2 hits（knowledge-llm.ts:246 唯一 LLM 出网点；error-forwarder.ts:24 非 LLM）。
- `api.openai|api.anthropic|x-api-key` in `apps/web` 生产代码 → 仅 `knowledge-llm.ts`（并被 L227-249 回归测试锁定）。
- `LLM_` env 全仓 → 8 文件（见上），客户端 0。
- `OPENAI_API_KEY|ANTHROPIC_API_KEY` in `apps/web` → 0 hits（无厂商命名 env）。

---

## How the verdict was reached

不是 partial：出网点唯一性有 grep（0 旁路）+ 专用回归测试双重证据；三 facade 的 primitive 调用逐行定位；server-only 由 Vite 前缀墙与全仓 grep 封闭。不是 contradicted：不存在第二条供应商通道。规格括号中的名字是 `KnowledgeLLM.complete`，实现为模块级函数 `complete`（无 `KnowledgeLLM` 类/对象），且 QA facade 走的是 `completeWithMetadata`——但后者是 `complete` 的实现体（L141 委托关系），二者共享同一配置读取、同一 HTTP 路径、同一错误面，"one primitive" 的语义（单一供应商 chokepoint）成立，故判 implemented 而非 partial。

---

## Open questions

- 规格写 `KnowledgeLLM.complete`（对象成员记法），实现是模块 `knowledge-llm.ts` 导出的 `complete`/`completeWithMetadata` 双入口。功能上单 chokepoint，命名上无 `KnowledgeLLM` 符号——属规格记法与实现形态的差异，建议在 spec 或评审文档补一句"primitive = knowledge-llm 模块的 complete/completeWithMetadata"。
- `LLM_TIMEOUT_MS` 是规格四 env 之外的第五个中性 env（有 runbook 文档），属增强配置项，未违反"behind neutral env configuration"。
