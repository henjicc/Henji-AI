# Qwen-MT-Flash · 百炼

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-09-24 |
| 能力 | 文本翻译（增量流式 / 非流式） |
| 平台模型 ID | `qwen-mt-flash` |
| 地域 | 北京、新加坡、美国（弗吉尼亚）、德国（法兰克福）；以区域模型实际开通为准 |
| 文档/价格 | API/价格公开；选型页本次触发验证码 |

## 1. 协议与参数

```text
POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions
POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/text-generation/generation
Authorization: Bearer <API Key>
```

只支持 User Message，`content` 是待翻译文本。`translation_options` 必填：`source_lang` 为源语言英文全称或 `auto`，`target_lang` 为目标语言英文全称；可选 `terms/tm_list/domains`，其中领域提示只支持英文。

支持 `stream/max_tokens/seed/temperature/top_p/top_k/repetition_penalty`。官方 API 页将 `max_tokens` 上限指向选型页，但选型页本次被验证码拦截，**未获得可核实的独立上限，实现不得凭经验硬编数字**。

## 2. 结果、流式与价格

非流式译文为 `choices[0].message.content`，用量为 `usage.prompt_tokens/completion_tokens/total_tokens`。Flash 的 SSE `delta.content` 是**增量片段**，客户端直接追加。

北京官方原价：输入 0.7 元/百万 Token，输出 1.95 元/百万 Token；价格页列北京限时 100 万 Token 免费额度，以账号实际为准。

## 3. 适配要点

翻译是独立 capability，不用通用 LLM prompt 伪装；但可复用 OpenAI 兼容传输与 SSE 解析。只在按需注册翻译能力时暴露，不得因为 SDK 内置就强制进入所有宿主。

## 4. SDK 实现状态

- 按需入口：`@henjicc/ai-sdk/capabilities/translation/bailian`，工厂 `createQwenMtFlashTranslationModule()`。
- 默认走 OpenAI 兼容 Chat Completions 并开启 SSE；将官方增量块统一成 `delta(mode=append)`，最终输出完整 `item`，Token 计入 `usage`。
- Say-It 当前保存的常用语言代码会先映射为官方英文语言名；术语表映射到 `terms`，翻译记忆映射到 `tm_list`，通用 `context` 映射到英文领域提示 `domains`。
- 未核实的独立最大输出数不设默认值，也不发送 `max_tokens`。当前只有官方示例 fixture/单测证据，尚无真实付费请求证据。

### 三模型共享事件契约与回归矩阵（2026-09-24）

本节只复核响应及生命周期，价格和输入上限未重新调研。依据同页 OpenAI 兼容 API 的流式/非流式响应定义：Flash/Lite 增量、Plus 累积；生成中 `finish_reason=null`，自然结束为 `stop`，长度截断为 `length`。官方样例包含空首帧、两次相同 `stop` 帧及 `choices=[]` 用量帧。

| 事件/序列 | SDK 行为 | 回归依据 |
|---|---|---|
| 空 `content` 中间块、连续增量/累积内容 | 等待或更新部分结果，不报失败 | 官方 fixture；既有三模型测试 |
| 重复 `stop` + 独立 usage + DONE/正常 EOF | 只产出一次完整 item；累计模型重复最终快照不重复追加 | fixture 补齐官方重复结束块；生命周期测试 |
| 空 `choices` 且有用量 | 用量通知，不作为完成依据 | 官方 usage 块 |
| 部分结果后 DONE/EOF、末块无空行 | 缺少可分发最终块时报 `provider_response_invalid`；不补造 SSE 空行 | 删除结束块/截断分隔符的受控变异 |
| `length`（流式及非流式） | `provider_task_failed`，details 保留 `finishReason=length`；不把截断译文作为完整 item | 官方枚举的受控变异 |
| 缺少 choices/content/结束原因，字段错类型，最终内容继续变化 | 明确拒绝，不作为空状态通知跳过 | 从官方结果块移除或替换字段 |
| 错误对象缺少 code、SSE `event:error`、HTTP 错误 | 明确失败，保留实际模型/协议/阶段及安全错误码；不默认输出原始 message | 错误 envelope 的受控注入 |
| 未知具名 SSE 扩展事件 | 不提供成功或失败依据；继续等已知协议结果 | 扩展通知 + 正常/缺失结束序列 |
| 取消、断流、回调失败、DONE 后连接未关闭 | 中止或失败，取消剩余流并释放锁；取消后不再发送 item/completed | Mock 流与取消回放 |

`content` 必须是字符串，但不凭经验添加“最终译文必须非空”的限制；空输入本地短路仍受取消约束。SSE 分帧与聊天共用 `src/protocols/sse-events.ts`，结果校验和增量/累积语义保持在各适配器内。

证据：`tests/fixtures/bailian-translation/official-qwen-mt-examples.json`、`tests/bailian-qwen-mt.test.ts`、`tests/bailian-qwen-mt-lifecycle.test.ts`。负例是明确标注的受控变异，不声称来自真实付费请求。

## 5. 原始链接索引

| 信息 | 链接 | 登录 |
|---|---|---|
| API/请求/响应 | https://help.aliyun.com/zh/model-studio/qwen-mt-api | 否 |
| SSE 分帧与 EOF | https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation | 否 |
| 选型/语言/限制 | https://help.aliyun.com/zh/model-studio/machine-translation | 否（本次访问触发验证码，未取正文） |
| 价格 | https://help.aliyun.com/zh/model-studio/model-pricing | 否 |
| API Key | https://bailian.console.aliyun.com/?apiKey=1#/api-key | **是** |
