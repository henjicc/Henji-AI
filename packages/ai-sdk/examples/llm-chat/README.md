# llm-chat

用 `@henjicc/ai-sdk@0.2.7` 的 `llm/streaming` 按需入口走 OpenAI-compatible SSE 流式对话，
不会把 generation、BigModel preset/models/pricing、Groq 或 LLM modules 打进示例 bundle；
通用端点身份解析所需的 BigModel profiles 仍会保留。默认目标是
DeepSeek `deepseek-v4-flash`，提示词要求只回复 `SDK OK`，并限制最多 16 tokens。示例显式传入
`reasoning: { enabled: false, effort: 'high' }`，避免短输出预算被供应商默认思考过程占用；若流结束后
没有任何文本 token，示例会明确失败。

```bash
npm install
npm run dry-run
npm run check:bundle
```

`dry-run` 使用本地 SSE fixture，不访问网络。真实调用前先确认供应商、模型、Base URL 和价格：

```bash
LLM_API_KEY='你的密钥' \
LLM_PROVIDER_ID='deepseek' \
LLM_MODEL_ID='deepseek-v4-flash' \
LLM_BASE_URL='https://api.deepseek.com' \
npm start
```

DeepSeek Flash 当前资料价为缓存未命中输入 ¥1.5/百万 tokens（闲时）或 ¥3/百万（高峰），输出
¥4.5/百万（闲时）或 ¥9/百万（高峰）。示例按高峰价、并把字符数保守当 token 数输出粗估；实际账单
以供应商 usage 和账单为准。

示例对 `/chat/completions` 的 POST 设置单次外网闸门，进程内第二次付费请求会在本地被拒绝。
要取消流式请求，保存 `resolveLlmTaskId(request)` 返回的 `taskId`，再调用
`cancelLlmChatTask(taskId)`。按需流式入口没有需要宿主释放的客户端实例。
