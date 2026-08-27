# Provider fixtures（任务 6.1）

## LLM fixture 补充（任务 9.9）

`groq/*.json` 由 LLM 专用精确测试读取，不进入生成供应商的 `fixtures.test.ts`。本机没有 Groq
真实请求日志，因此三份 fixture 均按既定来源优先级取自 Groq 官方 Models、Chat/Reasoning 与
Errors 文档的字段说明；每份 `source` 已分别标明，内容与 token 均为不可联网的占位数据。

`tests/fixtures/<供应商>/*.json` 是 8 个供应商适配器的请求/响应回归快照，由 `tests/fixtures.test.ts` 驱动，
对每个 fixture 做**正向**（`params` → 实际发送的请求体）与**反向**（`response` → 解析出的状态/URL/错误）
双向断言。这是任务 3.2 迁移 99 个模型定义时唯一能发现"静默请求体差异"的安全网，改动
`packages/ai-sdk/src/providers/**` 前必须先跑通 `npx vitest run packages/ai-sdk`。

## 数据来源（如实说明，按供应商分列）

任务要求"采集来源必须是真实日志，禁止手写"。执行时核实：本机开发日志
（`~/Library/Application Support/com.henji.ai/Henji-AI/logs/henji-2026-08-26.log`）里只有
**Grsai 一个供应商**留下过真实的 `generation.runtime.request_json` / `generation.runtime.response_json`
事件配对（共 2 组：1 次创建 + 1 次轮询成功，均为 `grsai-gpt-image-2` 模型）。其余 7 个供应商本机
从未发起过真实生成请求，日志里没有任何 `generation.runtime.*` 记录，`henji.db` 也没有历史生成记录
可查。按任务要求的退而求其次方案处理，**每个 fixture 的 `source` 字段都写明了具体来源，不要只看这张表**：

| 供应商 | 请求体（`params`/`expectedRequest`）来源 | 响应体（`response`）来源 |
|---|---|---|
| **grsai** | `create-task-success.json`/`poll-success.json` 两个场景来自真实开发日志（脱敏后，prompt 已替换为占位符）；`poll-failure.json`/`domain-fallback.json` 本机无真实失败样本，取自 `docs/供应商/Grsai.md` 文档描述 | 同左：2 个场景真实日志，2 个场景文档描述 |
| **kie** | `tests/catalog/kie-images.test.ts` / `kie-videos.test.ts` 已核对过的 `request.builder` 真实断言 | `docs/model-adaptation/供应商/KIE.md` 的字面 JSON 代码块（§2.2），结果 URL 替换为占位符 |
| **apimart** | `tests/catalog/apimart-images.test.ts` / `apimart-videos.test.ts` 真实断言 | `docs/model-adaptation/供应商/APIMart.md` 的字面 JSON 代码块（§3.2），任务 id 取自文档原文字面量，结果 URL 替换为占位符 |
| **fal** | `tests/catalog/fal-targets.test.ts` 真实断言 | `docs/model-adaptation/供应商/Fal.md` 的字面 JSON 代码块（§2.1/§2.2） |
| **ppio** | `tests/catalog/ppio.test.ts` 真实断言 + `docs/model-adaptation/Kling-3.0/Kling-3.0_派欧云.md` 官方默认值 | `docs/model-adaptation/供应商/派欧云.md` 的字段路径描述（**非字面 JSON 块**，该文档只有 inline 引用的最小示例 `{ "task_id": "..." }`，其余字段路径按文档表格中的名称拼装） |
| **modelscope** | `tests/catalog/modelscope.test.ts` 真实断言 + `docs/model-adaptation/供应商/魔搭.md` 官方默认值 | 同 ppio：文档字段路径描述，非字面 JSON 块 |
| **bailian** | `tests/catalog/official-images.test.ts` 真实断言 | `docs/model-adaptation/供应商/百炼.md` 的字段路径描述（`output.choices[].message.content[].image`），非字面 JSON 块 |
| **volcengine** | `tests/catalog/official-images.test.ts` 真实断言 | `docs/model-adaptation/供应商/火山引擎.md` 的字段路径描述（`data[].url`），非字面 JSON 块 |

**采集时间**：2026-08-27。执行细节与逐条判断记录在
`docs/task/模型SDK抽离/任务/第六阶段-测试发布与交付/6.1-建立fixture回归测试体系.md` 的执行记录里。

所有响应里的结果 URL 一律替换为占位符域名/文件名（不指向任何真实可下载的文件）；grsai 两个真实日志场景的
用户 prompt 已替换为脱敏占位符；没有任何 fixture 包含真实 API Key。核对命令：

```bash
rg -i "sk-|bearer |api[_-]?key" packages/ai-sdk/tests/fixtures/
```

应无命中。

## Fixture 格式

```jsonc
{
  "provider": "kie",                 // providerId，对应 tests/providers/<provider>.ts
  "modelId": "kie-gpt-image-2",       // 仅作说明，不参与断言
  "scenario": "create-task-success",  // 场景名，用于分类，不参与断言逻辑
  "phase": "execute",                 // "execute" | "continuePolling" —— 决定调哪个 provider 导出函数
  "method": "POST",                   // 仅 phase=execute 时使用，传给 ProviderExecutionInput.method
  "route": "/api/v1/jobs/createTask", // 传给 ProviderExecutionInput.route（execute）或用于拼轮询 URL
  "taskId": "kie-fixture-task_001",   // 仅 phase=continuePolling 时必填
  "params": { /* JsonValue */ },      // 仅 phase=execute：作为 ProviderExecutionInput.body 传入
  "expectedRequest": {                // 可选：正向断言——实际发到 fetch 的 URL/方法/请求体
    "url": "https://api.kie.ai/api/v1/jobs/createTask",
    "method": "POST",
    "body": { /* 期望的最终请求体，含 provider 在发送边界做的强制覆盖 */ }
  },
  "response": { /* JsonValue，作为 mock fetch 返回的响应体 */ },
  "responseStatus": 200,              // 可选，默认 200
  "expected": {                       // 反向断言：解析结果
    "outcome": "resolve",             // "resolve" | "reject"
    "status": "pending",              // resolve 时可选："pending" | "completed"
    "url": "a|||b",                   // resolve && completed 时可选
    "taskId": "kie-task-1",           // resolve && pending 时可选
    "errorCode": "provider_task_failed",       // reject 时可选
    "errorMessageIncludes": "..."              // reject 时可选，子串匹配
  },
  "endpointPreference": {             // 仅 apimart/grsai 的多域名切换场景使用
    "markReachable": "https://api.aiuxu.com/v1/balance",
    "expectedOrder": ["https://api.aiuxu.com/...", "..."]
  },
  "skipRequestAssertion": false,      // 可选：true 时跳过正向断言（如 bailian/volcengine 的
                                       // continuePolling-unsupported 场景，该分支不发起网络请求）
  "source": { "params": "...", "response": "..." }  // 必填：如实标注数据来源
}
```

### 关于"正向"断言的范围

只有 `phase: "execute"` 且带 `expectedRequest` 的 fixture 才做请求体断言——`continuePolling` 阶段是无
请求体的 GET 查询（taskId 拼进 URL），请求体差异只可能出现在提交阶段，因此正向断言集中在创建/提交场景。

### 同步供应商（bailian / volcengine）的场景适配

这两个供应商的官方契约是同步返回，没有独立的"创建任务"与"轮询"两阶段：`execute()` 一次请求直接
返回 `completed`，`continuePolling()` 对任何输入都直接抛 `unsupported_provider`。因此这两个供应商的
3 个场景是 `sync-success`（等价于"创建成功"与"轮询完成"合并）、`failure`、`continuePolling-unsupported`，
而不是字面的"创建/轮询/失败"三段式。

## 场景覆盖

- 8 个供应商各 ≥3 个场景（创建成功 / 轮询完成 / 失败，或同步供应商的等价场景），合计 30 个 fixture。
- KIE 额外 4 个结果解析边界场景（`boundary-*.json`）：`resultJson` 是 JSON 字符串需二次解析、
  结果藏在 `resultObject` 深层（`collectDeepUrls`）、多个结果 URL、首尾帧 `firstFrameUrl`/`lastFrameUrl`。
- APIMart 与 Grsai 各有一个 `domain-fallback.json`：验证 `markXReachable` 后 `buildXEndpoints` 的
  域名顺序，以及 provider 实际请求确实打到了优先域名。

## 新增供应商时必须补的 fixture（供应商适配流程的一部分，同步写进了 docs/rules/model-adaptation.md）

1. 在 `tests/fixtures/<新供应商>/` 下至少补 3 个场景：创建成功（或同步供应商的 `sync-success`）、
   轮询完成（同步供应商可省略）、失败响应。数据来源优先级：
   - 真实开发日志（用 `scripts/collect-provider-fixtures.cjs` 采集草稿，人工核对后转正）；
   - 该供应商 `model-adaptation-*.test.ts` 里已核对过的 `request.builder` 断言（请求体侧）；
   - 供应商官方文档记录的响应示例（响应体侧，字面 JSON 优先于字段路径描述）。
   **不允许凭空手写"看起来对"的结构**，且必须在 fixture 的 `source` 字段写清楚具体来源。
2. 若新供应商的响应解析存在多分支（如 KIE 的 `resultJson`/`resultObject`），比照 KIE 的
   `boundary-*.json` 补齐每个分支的边界场景。
3. 若新供应商有多域名/多线路切换策略，比照 `apimart`/`grsai` 的 `domain-fallback.json` 补一个。
4. 跑 `npx vitest run packages/ai-sdk/tests/fixtures.test.ts` 确认新 fixture 被自动发现并通过
   （`fixtures.test.ts` 用 `readdirSync` 遍历目录，新增文件不需要改测试代码）。
5. 跑脱敏检查：`rg -i "sk-|bearer |api[_-]?key" packages/ai-sdk/tests/fixtures/` 必须无命中；
   结果 URL 不能带可访问的签名参数。

## 采集脚本

`scripts/collect-provider-fixtures.cjs` 从本机日志按 `requestId` 配对
`generation.runtime.request_json`/`generation.runtime.response_json`，脱敏后写出**草稿**到
`_drafts/<provider>/`（草稿字段里 `scenario`/`expected` 等需要人工判断的部分留 `TODO`，人工核对后
才能移进正式 fixture 目录）。用法见 `node scripts/collect-provider-fixtures.cjs --help`。
