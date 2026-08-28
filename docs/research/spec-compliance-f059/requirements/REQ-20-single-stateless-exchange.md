# REQ-20 — 每次 ask 单次无状态交换：无多轮会话、无流式

> "Single stateless exchange per ask: no multi-turn conversation, no streaming."
> — F059 spec L144

**Verdict:** implemented · confidence: high

---

## What this demands of an implementation

1. 一次 ask 恰好一次 provider 交换；服务端不缓存、不复用上一次交换。
2. 无多轮：请求不携带也不累积对话历史（服务端与客户端都不得存 conversation 状态）。
3. 无流式：provider 请求不开 stream，响应整体返回；对客户端也不经 SSE/subscription 推送。

---

## Where enforcement lives

**(1) 单次交换、无状态** — `apps/web/server/lib/knowledge-qa.ts:216-244` `answerKnowledgeQuestion` 全函数只有一处出站调用：

```ts
const exchange = await completeWithMetadata('cited-qa', CITED_QA_PROMPT, userMessage); // knowledge-qa.ts:223
```

无循环、无重试、无第二次调用。`knowledge-qa.ts` 不 import `llmCache`（对照语义层 `knowledge-llm-prompts.ts:4` 引缓存）——spec L118 "Cited QA is never cached" 的落点。测试 `apps/web/tests/server/knowledge-qa.test.ts:248-284`：同一问题连问两次断言 `completeSpy` 恰被调用 2 次（每问一换），且 `llmCache.size === 0 && llmCache.inflightSize === 0`。

**(2) 无多轮** — 输入面：`askInputSchema`（`apps/web/server/routers/knowledge.ts:23-44`）字段仅 `question`/`focusNodeId?`/`allowExternal`，`.strict` 语义下无 history/messages/conversationId 字段可携带。provider 请求面：OpenAI 路径 messages 恒为 `[{role:'system'},{role:'user'}]` 两条（`apps/web/server/lib/knowledge-llm.ts:313-316`）；Anthropic 路径 `messages: [{ role: 'user', content: userMessage }]` 单条（`knowledge-llm.ts:354`）。服务端无任何模块存储 ask 历史（ask 链路文件 grep `history|conversation` 0 命中）。客户端：`KnowledgeMapPage.tsx:1000-1012` 只有单值 `askInput` state，`submitQuestion`（L1034-1051）整体替换该值或 refetch，无问答对列表累积；查询配置 `staleTime: 0, gcTime: 0, retry: false`（L1006-1011）——上一答不驻留缓存。

**(3) 无流式** — provider 请求体不含 stream 标志：`knowledge-llm.ts` 全文件 grep `stream` 0 命中（OpenAI body L311-319、Anthropic body L350-356）；响应经 `readBoundedResponse`（L262-295）完整缓冲到 128KiB 上限后一次性返回字符串（内部 `body.getReader()` 是限长防御性读取，非对外流式转发）。传输面：ask 注册为 tRPC `.query`（`knowledge.ts:131-133`）——请求/响应一元语义；`apps/web/server` 全域 grep `subscription` 0 命中；仓内唯一 SSE 端点是会话事件流 `apps/web/server/routes/sse.ts`（按 `req.params.sessionId` 服务 `/api/sessions/:id/events`，与 knowledge 无关）；前端唯一 `EventSource` 在 `apps/web/src/lib/hooks/useSessionEvents.ts:101`，knowledge 特性目录零命中。e2e `knowledge.spec.ts:465-485` 以网络计数断言一次提交恰好发出 1 个 `/knowledge.ask?` 请求。

---

## Paths walked

- ✓ 成功 ask：一次 `completeWithMetadata`、一个响应对象（`knowledge-qa.ts:221-243`）。
- ✓ 重复提问同一问题：客户端 `refetch()`（`KnowledgeMapPage.tsx:1043-1048`）→ 服务端仍新起一次完整交换（测试 L253-258 两问两换）。
- ✓ provider 失败/超时：`KnowledgeLLMError` 单抛，无重试循环（`knowledge-llm.ts:235-260`；tRPC 客户端 `retry: false` L1006）。
- ✓ stub provider：同步构造单段响应（`knowledge-llm.ts:191-203`），同为一次交换。
- ✗（不可达）多轮路径：输入 schema 无历史字段（`knowledge.ts:23-44`），provider 调用点 messages 数组字面量固定（`knowledge-llm.ts:313-316,354`），不存在拼接历史的代码。
- ✗（不可达）流式路径：无 `stream: true`、无 subscription procedure、ask 不经 SSE 路由。

---

## Searched

- `stream` in `apps/web/server/lib/knowledge-llm.ts` → 0 命中。
- `subscription` in `apps/web/server/**` → 0 命中。
- `text/event-stream|EventSource` in `apps/web` → 仅 `server/routes/sse.ts:31`（会话事件）与 `src/lib/hooks/useSessionEvents.ts:68,101`（会话事件消费）；knowledge 相关文件 0 命中。
- `history|conversation|messages\s*:` in ask 链路（`knowledge.ts`、`knowledge-qa.ts`、`knowledge-llm.ts`）→ messages 仅 L313,354 两处固定字面量；history/conversation 0 命中。
- `llmCache` in `knowledge-qa.ts` → 0 命中（import 面 L1-8）；运行时断言 `knowledge-qa.test.ts:282-283`。
- e2e 请求计数 → `knowledge.spec.ts:466-485`（`askRequests` 恰为 1）。

---

## How the verdict was reached

不是 `partial`：三个子约束（单次、无多轮、无流式）在服务端调用点、provider 请求体、传输语义、客户端 state 四层逐一为正向证据，且多轮/流式两条反路径经全域 grep 确认不存在代码入口——没有可失守的分支。不是 `stronger-than-spec`：`gcTime: 0`（`KnowledgeMapPage.tsx:1011`，答案不驻留客户端缓存）与"Cited QA is never cached"（spec L118）同族，属既有 spec 覆盖而非未记录约束。不是 `contradicted`/`absent`：`npx vitest run`（26/26）与 e2e 断言与实现一致。`readBoundedResponse` 内部的 reader 循环（`knowledge-llm.ts:276-293`）经核读为限长缓冲而非流式转发，不构成歧义，故非 `undecidable`。

---

## Open questions

1. "stateless" 的一个弱化点：客户端在同一页面生命周期内保留**最近一次**答案供渲染（`askQuery.data`，`KnowledgeMapPage.tsx:1335`）——这是展示态而非会话态（下次提问整体替换，不回传服务端），spec 措辞按"per ask 交换无状态"解读成立；若 spec 意图连展示驻留都禁止，需要 spec 方澄清。
2. 服务端对 provider 的 30s 超时（`knowledge-llm.ts:43,100-106`）内若客户端离开页面，`gcTime: 0` 会丢弃返回结果但服务端交换仍完成——单次交换语义不受影响，属资源性观察，spec 无相关要求。
