# Qwen Audio 3.1 TTS Plus · 百炼

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-07 |
| 模态 | 音频（语音合成） |
| 供应商 | 阿里云百炼（官方） |
| 项目模型 ID | `bailian-qwen-audio-3.1-tts-plus`（通用标识 `qwen-audio-3.1-tts-plus`） |
| 平台模型 ID | `qwen-audio-3.1-tts-plus` |
| 接口形态 | 同步 HTTP（非流式） |
| 文档 / 价格可见性 | 公开，无需登录 |

## 1. 接入协议

- `POST /api/v1/services/audio/tts/SpeechSynthesizer`，与 Qwen Audio 3.1 TTS Flash 同一端点与请求结构；项目沿用 `https://dashscope.aliyuncs.com`，北京地域 API Key
- 成功：`output.finish_reason: "stop"`，`output.audio.url` 为完整音频，24 小时有效；`usage` 返回 `input_tokens` / `output_tokens` / `characters`

## 2. 请求参数（项目使用部分）

| 字段 | 取值 | 项目处理 |
|---|---|---|
| `model` | `qwen-audio-3.1-tts-plus` | 固定 |
| `input.text` | 待合成文本，支持 SSML / LaTeX | 提示词全文 |
| `input.voice` | 本模型支持的系统音色或复刻 / 设计音色；**音色不能跨模型混用**，不匹配报 `InvalidParameter` | 4 个旗舰系统音色，默认 `longanlingxin_v3.1`；允许填自定义 ID |
| `input.format` | `mp3`（默认）/ `pcm` / `wav` / `opus` | 固定 mp3 |
| `input.rate` | 0.5–2.0，默认 1.0 | 「语速」 |
| `input.instruction` | 方言、情感、角色指令 | 「演绎指令」，空时不发 |
| `sample_rate`、`volume`、`pitch`、`seed`、`language_hints`、`hot_fix`、`enable_ssml`、AIGC 标识 | 可选 | 不显示、不发送 |

系统音色（[音色列表](https://help.aliyun.com/zh/model-studio/qwen-audio-tts-voice-list)「qwen-audio-3.1-tts-plus 旗舰音色」）：

| voice | 名称 | 性别 |
|---|---|---|
| `longanlingxin_v3.1` | 龙安灵心_v3.1 | 女 |
| `xunanchuan_v3.1` | 许南川 | 男 |
| `longanhuan_v3.1` | 龙安欢_v3.1 | 女 |
| `longanfengyue_v3.1` | 龙安风悦_v3.1 | 女 |

四个音色均支持 SSML、指令控制、时间戳。

## 3. 价格

来源：[模型价格](https://help.aliyun.com/zh/model-studio/model-pricing)「Qwen-Audio-TTS」（2026-11-07 读取，无需登录），华北2（北京）：**¥1.4 / 万字符**，只按输入文本计费，输出不计费；北京地域有 1 万字符免费额度（90 天）。新加坡 ¥2.19 / 万字符，项目不用。

字符规则：汉字（含繁体、日文汉字、韩文汉字）记 2 个字符，其余字符（字母、数字、标点、空格、假名、韩文字母）记 1 个；SSML 标签不计。官方示例“中A文123”为 8 个字符。项目按此规则估价（未扣除 SSML 标签，略偏高）。

## 4. 项目适配

- **单独建模型，不并入 Flash 的版本选项**：Plus 只支持 4 个旗舰音色，Flash 有 68 个，音色不能跨模型混用；音色选择器按模型配置，并成版本会让用户在 Plus 下选到不可用音色。两者计费方式也不同（Plus 按字符，Flash 按 token）。
- 复刻音色列表（`remoteModelId`）未对 Plus 开放：现有列表接口按 `qwen-audio-3.1-tts-flash-` 前缀筛选，Plus 复刻音色的前缀与可用性官方页面未说明；用户可直接填写已有音色 ID。
- 请求构建与价格测试：`packages/ai-sdk/tests/catalog/official-videos.test.ts`「百炼 Qwen Audio 3.1 TTS Plus」。同步结果解析沿用 `providers/bailian.ts` 的 `/SpeechSynthesizer` 分支（已有 TTS 测试覆盖）。未做真实付费调用。

## 5. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| Qwen-Audio-TTS HTTP API | https://help.aliyun.com/zh/model-studio/qwen-audio-tts-http-api | 否 |
| Qwen-Audio-TTS 音色列表 | https://help.aliyun.com/zh/model-studio/qwen-audio-tts-voice-list | 否 |
| 模型价格 | https://help.aliyun.com/zh/model-studio/model-pricing | 否 |
