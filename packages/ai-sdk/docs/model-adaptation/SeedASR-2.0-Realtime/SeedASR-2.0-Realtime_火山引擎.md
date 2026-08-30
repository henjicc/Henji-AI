# SeedASR 2.0 Realtime · 火山引擎

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-31 |
| 能力 | 双向实时语音识别（二进制 WebSocket） |
| SDK `modelId` | `seedasr-2.0-realtime` |
| 火山请求模型 | `request.model_name="bigmodel"` + 2.0 资源 ID `volc.seedasr.sauc.duration` |
| P0 音频 | PCM S16LE、16 kHz、16 bit、单声道 |
| 文档/价格 | 公开；API Key、开通和用量需登录 |

## 1. 端点与新版鉴权

P0 使用官方双向流式优化端点：

```text
wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async
```

握手头：

```text
X-Api-Key: <API Key>
X-Api-Resource-Id: volc.seedasr.sauc.duration
X-Api-Request-Id: <客户端生成的 UUID>
X-Api-Sequence: -1
```

只支持新版 `X-Api-Key`。同一官方页面同时列出 1.0 的 `volc.bigasr.sauc.*` 与 2.0 的 `volc.seedasr.sauc.*`；本模型固定 2.0 小时版资源 ID。并发版 `volc.seedasr.sauc.concurrent` 属于另一计费形态，不在 P0 中静默切换。

## 2. 首帧与音频规格

首帧 JSON 经 UTF-8 + gzip 后装入二进制帧：

```json
{
  "user": { "uid": "<request UUID>" },
  "audio": {
    "format": "pcm",
    "codec": "raw",
    "rate": 16000,
    "bits": 16,
    "channel": 1
  },
  "request": {
    "model_name": "bigmodel",
    "enable_itn": true,
    "enable_punc": true,
    "enable_ddc": false,
    "show_utterances": true,
    "enable_nonstream": false,
    "result_type": "full"
  }
}
```

P0 不在 SDK 内转码：输入不符合 PCM S16LE/16 kHz/mono 时，在建立付费连接前失败。每个 PCM16 音频块的字节数必须为偶数。官方示例建议每 200 ms 一包，即 6400 字节；分块节奏由宿主负责。

`bigmodel_async` 当前契约不发送 `audio.language`；传入 `language` 或热词 `hints` 会明确报不支持，避免静默丢参数。

## 3. 二进制帧契约

### 3.1 4 字节头

| 位置 | 高 4 bit | 低 4 bit |
|---|---|---|
| byte 0 | version=`1` | header size=`1`（4 字节） |
| byte 1 | message type | flags |
| byte 2 | serialization | compression |
| byte 3 | reserved | reserved |

消息与标志：

| 值 | 含义 |
|---|---|
| message type `1` | client full request |
| message type `2` | client audio-only request |
| message type `9` | server full response |
| message type `15` | server error response |
| flag bit `1` | 帧含 4 字节大端有符号 sequence |
| flag bit `2` | 最后一包 |
| flag bit `4` | 帧含 4 字节大端 event |
| serialization `0/1` | none / JSON |
| compression `0/1` | none / gzip |

完整响应布局为 `header → [sequence] → [event] → uint32 payload_size → payload`；错误响应为 `header → [sequence] → [event] → uint32 error_code → uint32 payload_size → payload`。解析器要求声明长度与实际剩余字节完全一致，断牙和尾随字节都报 `invalid_response`。服务端 payload 同时接受 `compression=none/gzip`，其他压缩或序列化值拒绝。

### 3.2 当前官方附件的客户端帧

| 帧 | 头 hex | sequence | payload |
|---|---|---|---|
| 首帧 | `11 11 11 00` | `1` | JSON UTF-8 + gzip |
| 普通音频 | `11 21 11 00` | 正数，从 `2` 递增 | 原始 PCM + gzip |
| 最后一块真实音频 | `11 23 11 00` | 当前序号取负数 | 原始 PCM + gzip |

协议字段表把原始音频描述为 `serialization=none`，但 2026-08-08 当前官方 Python 附件对音频帧实际写入 `serialization=JSON` 标志（第三字节 `0x11`），附件自带成功 `run.log` 也使用这一结构。P0 以可复现的当前官方附件为准锁定 `0x11`；这是已记录的官方资料内部差异，后续若官方修正文档或附件需重新验证，而不是同时猜两套发送协议。

SDK 对音频保留一块延迟：收到下一块时才把上一块以正 sequence 发出；`finish()` 把最后一块真实音频以负 sequence 发送。不会制造空终止音频包。无任何真实音频就 `finish()` 会报 `invalid_audio`。

## 4. 服务端事件矩阵

| 服务端帧/字段 | Capability 事件 | 终态 | 行为 |
|---|---|---|---|
| 首个合法 type `9` full response | `started` | 否 | 官方附件该帧 `result.text=""`；SDK 不要求必须为空，也不产生空 partial |
| type `9`，非空 `result.text` | `partial` | 否 | 文本变化才发，重复内容去重 |
| `result.utterances[].definite=true` | `final` | 否 | 表示句段已确定，不等于整个连接结束；按时间范围/文本去重 |
| flag bit `2`（last） | `completed` | 是 | 只有客户端已 `finish()` 后才合法；输出 `result.text/utterances/audio_info.duration` |
| type `15` | 无 | 是（错误） | 读取 uint32 错误码；错误 payload 可为 JSON 或安全 UTF-8 文本 |
| 未知 `event` 数字 | 无 | 否 | 只记脱敏 warning，仍按 type/payload 处理 |
| WebSocket 提前断开 | 无 | 是（错误） | `provider_connection_closed`，不误报完成 |
| text WebSocket frame | 无 | 是（错误） | 协议要求二进制，报 `invalid_response` |

`utterances[].definite=true` 只能判断句段 final，整个会话终态必须看帧头 last 标志。整个终帧仍无有效文本时严格报 `invalid_response`。

用户主动取消只关闭连接，不发送负 sequence 终帧，也不把取消伪装成正常完成。full request 默认在 15 秒内必须收到首个服务端响应，可用 `openTimeoutMs` 显式调整；超时会关闭半开连接。`finish()`、连接释放和显式 `close()` 都幂等；发送失败、服务端错误、断线、超时和取消都走同一个释放边界。

## 5. 价格与免费额度

| 项目 | 官方公开值 |
|---|---|
| 后付费（小时版） | 1 元/小时 |
| 免费试用 | 20 小时 |
| 有效期 | 开通后 6 个月 |

20 小时为需在豆包语音控制台开通的试用额度，不是每月自动刷新。并发版的资源与计费方式不同，不应把本页小时版单价套到并发版。

## 6. Fixture 与验证来源

| Fixture | 分类 | 用途 |
|---|---|---|
| `asr-seedasr-official.json` | `official-redacted` | 官方附件成功 `run.log` 的握手/空进度/终帧；仅 `log_id` 脱敏 |
| `asr-seedasr-field-construction.json` | `field-construction` | 按官方当前附件构造三类客户端帧与首帧字段 |
| `asr-seedasr-synthetic.json` | `synthetic-negative` | 未知 event、错误码、断牙/尾随字节等负例 |

## 7. 原始链接索引

| 信息 | 链接 | 登录 |
|---|---|---|
| 流式 API/二进制协议 | https://docs.volcengine.com/docs/6561/1354869?lang=zh | 否 |
| 双向流式优化端点与当前附件 | https://docs.volcengine.com/docs/6561/2630027?lang=zh | 否 |
| 流式调用示例/资源 ID | https://docs.volcengine.com/docs/6561/2628951?lang=zh | 否 |
| 计费与免费试用 | https://docs.volcengine.com/docs/6561/1359369?lang=zh | 否 |
| 豆包语音控制台 | https://console.volcengine.com/speech/new/overview | **是** |
