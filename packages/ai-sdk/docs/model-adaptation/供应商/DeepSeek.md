# DeepSeek（独立工具接口）

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-14 |
| providerId | `deepseek`（与大语言模型共用同一凭据槽，见 `../../llm-adaptation/供应商/DeepSeek.md`） |
| Base URL | `https://api.deepseek.com` |
| 认证 | `Authorization: Bearer <DeepSeek API Key>` |
| 登录 | 文档与价格页公开，无需登录；调用需要 API Key |
| 发布 | 2026-11-13「全家桶应用 API」：Search、Fetch、OCR、ASR、TTS 可单独调用 |

## 接口与 SDK 落点

| 接口 | 端点 | 协议 | 价格（刊例） | SDK 入口 |
|---|---|---|---|---|
| 语音合成 | `POST /v1/tools/tts` | 同步，响应体流式返回 WAV | 3 元/万计费字符（汉字算 2），限时 5 折 | 生成模型 `deepseek-tts`（`catalog/deepseek/`，执行器 `providers/deepseek.ts`） |
| 语音识别 | `POST /v1/tools/asr` | multipart 同步 | 0.78 元/小时，按秒、不足 1 秒按 1 秒，限时 5 折 | `capabilities/speech-recognition/deepseek` |
| 网页搜索 | `POST /v1/tools/search` | JSON 同步 | 5 元/千次成功请求 | `capabilities/deepseek` 的 `createDeepSeekWebSearchModule` |
| 网页抓取 | `POST /v1/tools/fetch` | JSON 同步 | 5 元/千次成功请求 | `createDeepSeekWebFetchModule` |
| OCR | `POST /v1/tools/ocr` | multipart，识别期间换行保活 | 1.5 元/千页 | `createDeepSeekDocumentOcrModule` |
| 文件 | `POST/GET /files`、`GET/DELETE /files/{id}` | multipart / JSON | 解析按页计 OCR 价，`user_data` 不计费 | `createDeepSeekFilesClient` |

限时折扣不写进基础单价；估价一律按刊例价。

## 语音合成

- 请求：`text`（必填，≤10,000 计费字符、请求体 ≤64 KiB）、`voice_id`（`stella` 海星女声默认 / `tide` 暗潮男声）、`format`（`wav` 默认 / `pcm` 24 kHz 16 位单声道）、`filter_markdown`（默认 true）。
- 语种按文本自动识别：普通话、粤语、英语、日语、韩语、马来语、阿拉伯语、印尼语、泰语、越南语。不支持调语速、不支持中断续传。
- 错误：400 无可朗读文本或未过内容审核（`Content Exists Risk`）、429 并发超限、503 繁忙、504 超时。音频开始返回后合成失败时连接会提前断开，视为失败。
- 项目策略：只暴露音色；`format` 按项目约定不显示、不发送（默认 wav）；`filter_markdown` 用默认值不发送。WebSocket 流式合成（`wss://api.deepseek.com/v1/tools/tts`，分段发送文本）暂不接：宿主没有边生成边播放的消费方。
- 限速：每账号 50 并发。

## 语音识别

- multipart 只有 `file` 一个字段；16 位 PCM WAV（8000–48000 Hz 七档）或 Ogg Opus，按内容判断；单/双声道，双声道只识别左声道；≤8 MiB、≤120 秒、上传须 10 分钟内完成。
- 语种自动识别（中、粤、英、日、韩、德、法、西、葡、意、俄、阿、印地、印尼、越、泰、土、马来、菲律宾、波兰、匈牙利）。
- 响应 `{request_id, text, duration_ms}`；**没有时间戳**，不支持流式。错误 400/408/413/429/503/504。每账号 50 并发。
- 项目落点：音频编辑只用带时间戳的识别，DeepSeek 识别只进 SDK 与开发者面板。

## 网页搜索与抓取

- Search 请求：`query`（1–128 字符，支持 `site:`、`-site:`、`-词`、`-"短语"`、`"精确"`、`lang:zh,en`、`after:`、`before:`）、`count`（1–50，默认 10）、`ori_question`（≤128）、`localization`（本地化 IP，项目不发送）、`need_content`（默认 false）。暂不支持图片搜索。
- Search 结果字段：`rerank_score`（0–3，≥1.5 优质）、`title`、`url`、`snippet`（100–200 字）、`summary`（600–800 字）、`content`、`site_name`、`site_icon`、`date`（UTC RFC 3339 或 null）、`authority`（0–4，-1 未知）。
- Fetch 请求 `url`（≤8192、HTTP(S)、带 host、不得含用户名密码），响应 `{title, content}`（Markdown）。
- 错误为 OpenAI 兼容格式，`param` 恒为 null：400/401/402/403（Fetch 安全策略拒绝）/404（Fetch 没取到正文）/408/413/429/500/504。只读请求，408、429、5xx 可等待重试。
- 只有 HTTP 200 且有结果才计费（Search 非空、Fetch 有正文）。QPS：Search 100、Fetch 25，账号级；Fetch 另有目标域名限速。

## OCR 与文件解析

- OCR multipart 两个必填字段：`file`（带文件名；PDF、DOC/DOCX、PPT/PPTX、PNG/JPEG/WebP/GIF/BMP/TIFF）与 `purpose`（`text_recognition` / `rich_layout_recognition`）；传其他字段返回 400。
- 限制：100 MiB、1000 页；上传 120 秒内完成且中途停顿不超过 30 秒；总时长 180 秒。每账号 15 个并发识别，客户端断开后仍占名额且照常计费。
- 响应：识别期间持续发送换行保活，完成后返回 `{id, object, created, purpose, page_count, pages[{index, text, finish_reason}], usage}`。`finish_reason=length` 表示该页不完整。`rich_layout` 文本保留 `<｜ref｜>…<｜box｜>[[x1,y1,x2,y2]]`，坐标按页宽高归一化到 0–1000。
- **识别开始后状态码已是 200，失败时响应体是 `error` 对象**，必须检查 `error`。
- 文件上传 `POST /files` 时 `purpose` 必须写在 `file` 之前；解析完成后才返回文件对象 `{id, object, bytes, created_at, filename, purpose}`。对话中用 `file_id` 引用：Chat 为 `{"type":"file","file_id"}`，Responses 为 `{"type":"input_file","file_id"}`；每请求最多 20 个文档、文字合计 ≤8 MiB；只支持 `deepseek-flash`。原文件与解析结果都不能下载。
- `user_data`：纯文本、表格（XLSX/XLS）、电子书（EPUB/MOBI）转 Markdown，原文件 ≤32 MiB，不计费。
- 项目落点：助手能力 `recognize_document_text`（素材领域）按本机路径识别；图片默认本地内置 PP-OCR，PDF/Office 走 DeepSeek OCR 并走付费策略（按 1000 页上限估价 1.5 元）。助手附件暂不支持 PDF/Office，文件 `file_id` 引用暂无宿主消费方。

## 原始链接索引（均无需登录，2026-11-14 读取）

- [更新日志](https://api-docs.deepseek.com/zh-cn/updates)、[全家桶应用 API 发布](https://api-docs.deepseek.com/zh-cn/news/news261113)、[模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)
- [语音合成指南](https://api-docs.deepseek.com/zh-cn/guides/tts)、[语音合成 API](https://api-docs.deepseek.com/zh-cn/api/tts)
- [语音识别指南](https://api-docs.deepseek.com/zh-cn/guides/asr)、[语音识别 API](https://api-docs.deepseek.com/zh-cn/api/asr)
- [网页搜索与抓取](https://api-docs.deepseek.com/zh-cn/guides/search)、[Search API](https://api-docs.deepseek.com/zh-cn/api/search)、[Fetch API](https://api-docs.deepseek.com/zh-cn/api/fetch)
- [OCR 指南](https://api-docs.deepseek.com/zh-cn/guides/ocr)、[OCR API](https://api-docs.deepseek.com/zh-cn/api/ocr)
- [文件解析](https://api-docs.deepseek.com/zh-cn/guides/document_parsing)、[Files API 指南](https://api-docs.deepseek.com/zh-cn/guides/files_api)、[上传文件](https://api-docs.deepseek.com/zh-cn/api/create-file)、[列出文件](https://api-docs.deepseek.com/zh-cn/api/list-files)、[删除文件](https://api-docs.deepseek.com/zh-cn/api/delete-file)
- 每个页面加 `.md` 后缀可直接取 Markdown 原文（如 `https://api-docs.deepseek.com/zh-cn/guides/asr.md`）。
