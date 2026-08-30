# SeedASR 2.0 File · 火山引擎

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-31 |
| 能力 | 录音文件异步识别（submit/query） |
| SDK `modelId` | `seedasr-2.0-file` |
| 火山请求模型 | `request.model_name="bigmodel"` + 2.0 资源 ID `volc.seedasr.auc` |
| P0 输入 | 供应商可读取的 HTTP(S) 远端 URL |
| 文档/价格 | 公开；API Key、开通和用量需登录 |

## 1. 端点与新版鉴权

```text
POST https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit
POST https://openspeech.bytedance.com/api/v3/auc/bigmodel/query
```

P0 只实现新版控制台单 Key 鉴权：

```text
X-Api-Key: <API Key>
X-Api-Resource-Id: volc.seedasr.auc
X-Api-Request-Id: <客户端生成的 UUID，也是任务 ID>
Content-Type: application/json
```

提交还带 `X-Api-Sequence: -1`。查询沿用同一个 UUID；可把提交响应的 `X-Tt-Logid` 回传到查询头，便于服务定位。旧版 `X-Api-App-Key + X-Api-Access-Key` 没有进入 P0，也不得和 `X-Api-Key` 混发。

文档同页还列出 1.0 的 `volc.bigasr.auc`。本模型是 SeedASR 2.0，不能因为旧附件的默认值仍是 `volc.bigasr.auc` 就降级到 1.0。

## 2. 提交请求

```json
{
  "user": { "uid": "<request UUID>" },
  "audio": {
    "url": "https://audio.example/meeting.mp3",
    "format": "mp3",
    "language": "zh-CN"
  },
  "request": {
    "model_name": "bigmodel",
    "enable_itn": true,
    "enable_punc": true,
    "enable_ddc": false,
    "show_utterances": true
  }
}
```

| 字段 | P0 行为 |
|---|---|
| `audio.url` | 必填，只接受 HTTP(S)；本地 bytes 和 `media-ref` 明确报 `unsupported_media_source` |
| `audio.format` | 必填；只接受官方标准版枚举 `raw/wav/mp3/ogg`，可由 MIME、文件名或 URL 后缀推断 |
| `audio.language` | 可选，来自通用输入 `language`；不应误放进 `request` |
| `request.model_name` | 固定 `bigmodel`；2.0 由资源 ID 区分 |
| `enable_itn` | 默认 `true` |
| `enable_punc` | 默认 `true`，受通用 `punctuation` 控制 |
| `enable_ddc` | P0 默认 `false` |
| `show_utterances` | 默认 `true`，用于结构化句段/时间戳 |

提交成功时 Response body 为空，结果必须从响应头判断：`X-Api-Status-Code=20000000`、`X-Api-Message`、`X-Tt-Logid`。不能因为 HTTP 200 就假定任务已提交成功。

## 3. 查询状态与结果

查询 body 固定 `{}`。P0 状态矩阵：

| `X-Api-Status-Code` | 分类 | SDK 行为 |
|---|---|---|
| `20000000` | 成功终态 | 解析 JSON，发 `final/completed` |
| `20000001` | 处理中 | 发 `processing`，继续轮询 |
| `20000002` | 排队中 | 发 `processing`，继续轮询 |
| `20000003` | 静音终态 | `provider_task_failed`，不伪造空成功 |
| `45xxxxxx` | 请求/音频错误终态 | `provider_task_failed`，停止轮询 |
| `55xxxxxx` | 服务端错误终态 | `provider_task_failed`，停止轮询 |
| 缺少状态头 | 非法响应 | `invalid_response` |

成功 JSON 的稳定读取路径：

```text
result.text
result.utterances[].text/start_time/end_time/words[]
audio_info.duration
```

SDK 将毫秒字段归一到 `durationMs/segments[].startMs/endMs/words[]`。成功终态却没有非空 `result.text` 时严格报 `invalid_response`。

官方没有为该 submit/query 流程给出 P0 可依赖的远端取消端点。用户取消只中止当前 HTTP/等待和后续轮询，不再发送查询，也不声称已取消服务端任务。

## 4. 价格与免费额度

| 项目 | 官方公开值 |
|---|---|
| 后付费 | 0.8 元/小时 |
| 免费试用 | 20 小时 |
| 有效期 | 开通后 6 个月 |

20 小时是需要在豆包语音控制台开通的试用额度，不是每月自动刷新。创建应用、开通服务和免费试用均需用户在控制台操作；实际扣费以最新价格页和账单为准。

## 5. Fixture 与验证来源

| Fixture | 分类 | 用途 |
|---|---|---|
| `asr-seedasr-field-construction.json` | `field-construction` | 官方未给文件成功字面样例；按字段表构造状态头、成功结果与 SDK 出站请求 |
| `asr-seedasr-synthetic.json` | `synthetic-negative` | 静音/错误等断牙负例，不冒充真实返回 |

## 6. 原始链接索引

| 信息 | 链接 | 登录 |
|---|---|---|
| SeedASR 2.0 文件 API | https://docs.volcengine.com/docs/6561/1354868?lang=zh | 否 |
| 文件识别示例/附件 | https://docs.volcengine.com/docs/6561/2628951?lang=zh | 否 |
| 计费与免费试用 | https://docs.volcengine.com/docs/6561/1359369?lang=zh | 否 |
| 豆包语音控制台 | https://console.volcengine.com/speech/new/overview | **是** |
