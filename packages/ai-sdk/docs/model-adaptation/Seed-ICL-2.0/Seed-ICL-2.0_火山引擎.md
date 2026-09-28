# Seed-ICL 2.0 · 火山引擎

最后更新：2026-09-28。官方文档公开可读；控制台、实际 API 需要账号与权限。

## 产品与接入

同一 Seed-ICL 2.0 模型提供“语音合成”和“克隆声音”模式；已有模型 ID 与语音密钥槽保持兼容。界面按火山引擎品牌归组，方舟和豆包语音分别配置凭据。

新接入采用 V3：`POST https://openspeech.bytedance.com/api/v3/tts/voice_clone` 训练，`POST /api/v3/tts/get_voice` 查询，`POST /api/v3/tts/unidirectional` 合成。训练、查询使用 `X-Api-Key`、UUID `X-Api-Request-Id` 和 JSON Content-Type；合成还带 `X-Api-Resource-Id: seed-icl-2.0`。旧 V1 训练不再迭代，不复用旧协议。

## 输入

- 预付费音色传已有 `speaker_id`；后付费传 `speaker_id: custom_speaker_id` 和唯一的 `custom_speaker_id`。应用自动生成后者，无需手填。
- 自定义代号长 8–256，仅字母、数字、横线、下划线；字母开头，不以横线/下划线结尾，不使用官方保留前后缀。SDK 自动值使用 `henji` 加 UUID。
- `audio.data` 为 Base64 原始字节，单文件不超过 10 MB；支持 wav/mp3/ogg/m4a/aac/pcm，PCM 仅 24k 单声道。应用上传复用受管文件，SDK 通过媒体读取器取字节，直接发官方 JSON 接口，不要求公网 URL。应用优先接受可识别容器格式，不接受没有采样元信息的裸 PCM。
- `audio.format` 总是显式填写（文档字段标必填，正文又说部分格式可省略，显式传递满足两者）。可选 `text` 是录音原文。
- `language` 数字枚举 0–17、19–21；默认 0 中文。
- `extra_params.demo_text` 为试听文本，4–300 字，语言应匹配录音；`enable_audio_denoise` 默认 false；`disable_volume_normalization` 默认 false。
- 合成用真实音色代号作为 `req_params.speaker`，`model: seed-tts-2.0-standard`。

## 状态、错误与恢复

| 状态 | 响应约束 | 行为 | 终态 |
|---|---|---|---|
| 0 NotFound | `speaker_id` 字符串、`status` 整数 | 未训练/找不到音色，明确报错 | 是 |
| 1 Training | 同上 | 保留任务身份，只查询同一个音色 | 否 |
| 2 Success | 同上；`speaker_status[]` 中 `model_type=5` 对应复刻 2.0，`demo_audio` 为可选试听 URL | 音色可用，保存到音色库；有试听则返回试听 | 是 |
| 3 Failed | 同上，可选 message | 明确训练失败 | 是 |
| 4 Active | 同上 | 音色可合成，已激活不可再训练 | 是 |
| HTTP 失败 / 非成功 code | 可带 `code/message` | 报供应商错误，不把错误当成空音色或成功 | 是 |
| 缺失/非法 speaker_id 或 status | 不符合字段表 | 拒绝响应 | 是 |

官方字面成功响应没有 `code`，不能强制要求 code 存在。成功必须同时具备有效音色与合法状态；不因为 HTTP 200 就判成功。`available_training_times/create_time/language` 可选；试听 URL 有效一小时，不作为永久音色身份。

训练没有公开幂等保证，不自动重放；取消只终止本地等待，不能声称撤销远端训练。任务身份包含音色代号和名称，继续/恢复只调用查询接口。训练响应为处理中时返回 pending；提交后网络结果不确定时保留可查询身份并标记 submissionUnconfirmed，不假定已训练成功。查询复用现有轮询，正常处理中持续等待，取消或明确终态结束，连续查询失败最多 20 次。未知状态、空响应不会当成成功。官方未说明乱序、重复、远端取消、连接复用保证。普通 HTTP 由 transport 管理，响应完整消费，轮询计时器在取消时释放。

## 费用

公开刊例：Seed-TTS 2.0 / Seed-ICL 2.0 后付费合成均为 **3 元/万字符**；资源包另有折扣。后付费克隆音色 **138 元/音色**，首次正式语音合成时收费并固定音色；训练试听按复刻 2.0 字符费收取，七天未正式调用会删除。预付费槽位按购买数量分档，基础档 138 元/音色，每槽位可训练 15 次。客户端不自动购买或激活槽位。训练与正式合成必须分别显示其费用后果，不把训练试听当成免费，不把槽位费用隐藏在字符估价里。

## 音色列表

2026-09-28 复核：产品入口命名为“豆包语音 2.0”，语音合成模式同时提供系统音色和本地克隆音色。官方在线音色表的两个“豆包语音合成模型2.0”章节共 431 个去重音色（包含 `ICL_uranus_*` 命名的官方系统音色）；不采集后续 S2S 专用与 1.0 章节。旧清单 230 个漏掉了大小写不同的 ID，本次补齐。系统音色必须使用 `seed-tts-2.0` 资源；用户克隆音色使用 `seed-icl-2.0`，不能根据 ID 是否以 ICL 开头推断为收费克隆音色。

官方确有控制面 `ListSpeakers`（2025-05-20）接口，`ResourceIDs: ["seed-tts-2.0"]`、Page、Limit；响应 Speakers 包含 VoiceType、Name 等。官方示例要求 `Authorization: HMAC-SHA256` AK/SK 签名，并非当前配置的语音 `X-Api-Key`。因此本次使用官方文档内置列表，不要求用户为音色选择额外配置控制面凭据。

克隆提交前宿主必须弹出费用二次确认：训练试听 3 元/万字符，新建后付费音色首次正式合成另收 138 元且锁定，7 天未正式使用会删除；使用已有预付费音色会覆盖旧效果并消耗训练次数。取消、关闭或任务中止均不上传样本、不发训练请求；确认仅对本次提交有效。

新版按 ID 查询不提供目录。控制面分页接口 `BatchListMegaTTSTrainStatus`（2025-05-21）要求 ProjectName，官方示例使用 HMAC AK/SK；本次不假定语音 Key 能代替控制面签名。已有槽位可导入一次，应用自动保存之后无需重复输入；新建后付费音色自动产生 ID。本地记录与语音密钥的 provider 隔离，不能混入方舟或派欧云音色。

## Fixture

`tests/fixtures/volcengine-speech/voice-clone.json` 保存训练/查询页面嵌入 API 示例的原样成功响应（仅替换 ID/URL 为不可联网值），以及字段表构造的各状态。负例由测试单独构造。验收覆盖无 code 的官方响应、训练→成功、错误、缺失字段、超限音频、取消与不重放。

## 原始链接

- [系统音色表](https://docs.volcengine.com/docs/DoubaoVoice/Tonelist-1?lang=zh)：2.0 中文与外语章节；公开。
- [ListSpeakers](https://www.volcengine.com/docs/6561/2160690)：系统音色分页、资源筛选、HMAC 签名示例；公开。
- [V3 训练](https://docs.volcengine.com/docs/DoubaoVoice/tone-training-http?lang=zh)：请求、状态、后付费 ID 规则；公开。
- [V3 查询](https://docs.volcengine.com/docs/DoubaoVoice/tone-query-http?lang=zh)：状态、试听有效期；公开。
- [合成](https://docs.volcengine.com/docs/DoubaoVoice/unidirectional-streaming-text-to-speech-http?lang=zh)：合成请求；公开。
- [购买与使用](https://docs.volcengine.com/docs/DoubaoVoice/Soundreplicationorderingandusageguide?lang=zh)：激活、训练次数、有效期；公开。
- [价格](https://docs.volcengine.com/docs/DoubaoVoice/Billinginstructions-21?lang=zh)：正式后付费、槽位与试听计费；公开。
- [分页音色查询](https://www.volcengine.com/docs/6561/1801953)：控制面签名、项目与分页；公开。
- [错误](https://www.volcengine.com/docs/6561/2534853)：供应商错误码；公开。
