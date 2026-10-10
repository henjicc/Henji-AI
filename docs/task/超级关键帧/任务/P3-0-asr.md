# P3-0 SDK 时间戳 ASR 与默认转写模型

任务 t146，2026-10-11。实现已进入工作区；持久格式登记与数值费用仍须总管理者接收，不能视为完整发布验收。无 Git 写操作、无真实付费调用、无 SDK 源码改动、无开发实例启动/重启。

## 实现与选型

- 扩展原 `ModelDefaultsManager.models.transcription`，沿原 localStorage 键、订阅、默认模型分区和 `Dropdown`。生成用 `DefaultModelMediaType` 保持原含义，设置用途扩为 `DefaultModelPurpose`，不把 ASR 当作 TTS。
- 通用设置属性 `transcription.default_model`：空字符串为自动，显式值为 SDK 完整 moduleId。沿正式 describe/change/read、级联、失败恢复、撤销入口，不增加 Store、默认管理器或专用助手工具。覆盖分级为既有设置实体的属性扩展。
- 凭据撤销后的显式失效值仍须能内部回滚/撤销。设置定义增加可选 restore 钩子，仅恢复原值；正常 write 与执行继续检查可用性。原通用设置事务和计划撤销共用恢复入口，其他设置保持原 write 行为。未新增助手操作，也未放开正常无效模型写入。
- SDK speech-recognition descriptor 是能力事实来源；宿主只补本地录音媒体准备路径和字/词粒度。已配置、非实时、带时间戳且本地可准备的模型才进入设置候选。自动优先主供应商，继而优先 long-audio；显示实际选定项。主供应商改变清空显式转写选择并提示，失效显式选择拒绝执行，不替换收费模型。
- 共用 `timestamped-asr.ts` 复用 SDK client、官方上传、parser、取消、恢复查询；原 `audio-edit/asr.ts` 改为委托，不创建口播工程作为讲解的前置条件。口播/视频字幕共享的 ASR 清单也只列本地时间戳模型。
- 输出保留词/字/句真实粒度与毫秒。缺端时间保留文本、标 missing；仅文本标 none；句级标 coarse。非有限、负数、倒序、零长、超录音或超所属句的时间拒绝，不均分句子、不夹断。循环归集词条，避免对大数组展开参数触发 JS 调用参数上限。
- 成熟方案选择：使用仓内已接入 SDK 的百炼/Groq 模块与 fixture，不自研 ASR、供应商请求或 parser。01 §3 已比较 whisper.cpp、faster-whisper、sherpa-onnx；它们是可选离线探针，本任务不新增下载、依赖、原生进程或分发义务。

## 对外接口：供 P3-1 使用

主进程入口 `electron/main/services/audio-edit/timestamped-asr.ts`：

```ts
const plan = timestampedAsrService.prepare({
  modelId,       // 从原默认管理器 resolveTranscriptionModelId() 取得并通过正式桥传递
  audioPath,     // owner 已验证、受管的本地录音；不提供手工 URL 输入框
  durationMs,    // 对应这一块录音的实际时长
  language: 'zh',
})
const transcript = await timestampedAsrService.execute(plan, {
  requestId, signal, resumeTaskId, onEvent,
})
```

`prepare` 同步校验并冻结 `TimestampedTranscriptionPlan`，含 modelId/providerId/audioPath/durationMs/language/cost；`execute` 不读取新的默认值，也不换模型。Groq 明确 `timestampGranularities: ['word', 'segment']`、verbose_json；Qwen3 filetrans 由 SDK `timestamps:true` 映射 `enable_words:true`。配置撤销后拒绝执行。

`TimestampedTranscript` 定义在 `src/core/audioEdit/timestampedTranscript.ts`：text、unit:'ms'、words、segments（保留所属 words）、granularity:'word'|'character'|'segment'|'mixed'|'none'。条目含 text/startMs/endMs/confidence?/granularity/timing；缺时间使用 null。这是纯 DTO，不含录制墙钟，不冒充绝对时间。P3-1 负责分块 offset、双时钟/gap、受管引用验证、音频外发授权、operationId/任务账本、取消/关闭释放、未知提交记录、查询恢复及音频/文本隐私删除。恢复只查询既有 SDK 任务；模型不支持 resume 时拒绝重新提交。没有新增开放原始路径的 IPC。

原口播入口仍保留已提交任务、sourceDigest、互斥、取消及正式文档会话接收。音频编辑当前只支持 word/segment，所以 character 结果在这个旧消费者中使用整句粗窗口；共用 DTO 给 P3-1 保留 character，不能将字伪称为中文词。

## 候选模型表

以下均需原凭据状态已配置后才显示；实际 moduleId 是 `供应商.speech-recognition.模型名`。时间戳声明表示可返回，输出仍按实际时间校验。

| 供应商 / 模型名 | 本地准备 | 输出粒度 / 证据 |
| --- | --- | --- |
| bailian / fun-asr | SDK 官方流式文件上传，异步查询 | 句/词，现有文件结果 fixture |
| bailian / qwen3-asr-flash-filetrans | SDK 官方流式文件上传，enable_words | 句/字，共用文件 parser/字段 fixture；不是专属实测成绩 |
| bailian / fun-asr-flash-2026-06-15 | SDK 本地媒体读取、短音频 SSE | 句/词，SDK short-SSE 契约；受 SDK 短音频技术约束 |
| bailian / qwen-audio-3.1-asr-flash | SDK 本地媒体读取、短音频 SSE | descriptor 声明时间戳；已有官方短音频 fixture，未实调 |
| bailian / qwen-audio-3.1-asr-flash-filetrans | SDK 官方文件上传，异步查询 | descriptor/共用文件 parser，非专属模型实测 |
| groq / whisper-large-v3-turbo | SDK multipart 本地媒体读取 | word+segment，秒→毫秒；SDK 字段构造 fixture |
| groq / whisper-large-v3 | 同上 | 同上 |

排除 qwen3 两个短文本 preset、SiliconFlow 两个无时间戳 preset、TTS、实时模块、未配置项；Volcengine file 有时间戳但只有远端 URL 路径，缺已确认官方本地上传路径，排除。未增加产品数量上限。

契约参考：[Groq 参数表](https://console.groq.com/docs/speech-to-text)、[Qwen ASR API](https://help.aliyun.com/zh/model-studio/qwen-asr-api-reference)，SDK fixture 来源级别沿 01 §3.3，不以夹具宣称真实精度。

## 截图结论

- 正式命令：`npm run test:reality -- --suite ui --build --only settings-default-models --out .reality/t146-settings`，正式 Electron 42，隔离临时数据，副屏 DISPLAY1（本机 Windows 查询坐标 2560,0），单次环境变量 `HENJI_DEV_DISPLAY_POINT=2561,1`。
- 首轮轻量构建因本机 MSVC INCLUDE 未加载，ffmpeg-sys-next 报缺 stdio.h；仅在第二轮进程加载已安装 VsDevCmd 环境后构建/场景通过，未改系统或源码配置。每轮原子创建 `.reality/ui-lock`，try/finally 删除；已确认锁不存在。
- 截图 `.reality/t146-settings/1440x900-settings-default-models.png`，只截默认模型分区，已实际打开目视检查。供应商、图片/视频/音频/转写五行控件齐全，自动选择/未配置提示可读，无内部状态、遮挡、溢出。临时配置未置凭据，所以截图证明未配置状态；已配置候选由正式组件夹具验证。
- 场景 1 个，失败 0；浏览器错误、应用日志错误均 0。证据在相邻 evidence.json/index.md。场景裁切修改仅影响巡检脚本；本轮脚本修改已出现在工作期间更新的 HEAD `6d148f3c`，本任务没有 Git 写操作，交接时避免重复覆盖。

## 检查记录

- 精确 fixture / 默认管理器 / 通用设置 / 默认模型组件 / DTO 测试：已通过。通用设置测试串起 describe→change→read→保存重开→实际 SDK 请求，并在执行前修改默认值确认冻结模型不变。
- 验证等级 L2：默认设置跨通用反射、存储、渲染/主进程与 SDK 客户端，因此用最短 fixture 整链覆盖；用户明确要求设置截图和 7 目录回归，不升级全仓或真实付费验收。两条 tsc 前轮通过，主进程最终复验通过。最终恢复补丁后改动文件 ESLint 及 5 设置测试文件（25 用例）复验通过；最后渲染层 tsc 被其他任务文件 `src/features/imageEdit/v3/editor/liveAnnotationDisplayV3.test.ts:16` 的 `Type '10' is not assignable to type '11'` 阻断，本任务文件没有类型诊断，不越权改该文件。
- check:main-imports、check:dependency-graph、check:dead-code、check:ui-residue、check:surface、check:assistant-capabilities、check:ipc-contract：通过。dead-code 现有诊断只报告，非本任务新增；dead-code/assistant 首次因进程内存不足失败，重跑通过。
- 巡检脚本 CJS 常规 ESLint 报现有 require/no-console 规则；关闭这两项 CJS 不适用规则后的改动文件 ESLint 通过，Node 精确巡检 44 用例通过；没有改动无关存量语句。
- 用户指定 7 目录完整命令已执行：首次/降并发线程池因 V8 虚拟内存不足中断；改 forks 单 worker 后完整报告为 119 文件通过、1 原生文件失败、1 存量文件跳过，527 用例通过、1 跳过。唯一失败是 `mcpWriteIntegration.test.ts` 明确要求 Electron，普通 Node 按设计拒绝。正式 Electron 原生运行器精确执行该文件 3 用例通过、0 跳过；没有删除断言或改为 skip。
- 同样 7 目录使用 Electron 的 Node 执行环境、forks 单 worker：**120 文件通过、530 用例通过、0 失败**，存量 benchmark 1 文件/1 用例按原配置跳过，耗时 397.10s。保留完整范围和断言；环境变量只作用本次子进程。日志 `.reality/t146-electron-vitest.log`。随后新增的凭据撤销回滚/撤销用例与受影响设置文件已精准复验 25 用例通过，没有重复整套已通过的其余范围。

## 未完成项与交接

1. **权威持久格式（禁止越权）**：当前管理器在原 schema 上组合 transcription 字段，实际写入/重开测试通过；总管理者必须把字段并入 `src/core/persistence/preferenceSchemas.ts` 的 `modelDefaultsSchema`，移除管理器局部组合，再同步 `formats.ts` / `schemaBaseline.json` / 当前黄金 fixture / 开发期 dev-break 审计，运行对应持久门禁。本任务未改 core/persistence 或 fixtures。不能用当前局部 schema 绕过权威格式登记宣称完整完成。
2. **数值费用缺口**：SDK capability descriptor 没有价格来源，冻结 cost 为 `{status:'unknown',amount:null,currency:null}`，不是 0、不是免费。主进程计划不会切换模型，但正式数值费用估算/上限授权未完成。由总管理者决定正式价格来源与授权契约；需要 SDK 扩展时另立 SDK 任务。P3-1 未获音频外发/付费授权不得调用 execute。
3. **Groq 配置入口**：SDK/keystore 可消费 Groq，但原 `API_KEY_PROVIDERS` 未登记 Groq UI 入口。筛选只在原状态已配置时显示，不自造配置或伪造可用；正式供应商入口是否扩展由总管理者接收。
4. **台账**：这是新的通用设置属性和共用入口，需总管理者按 assistant-status 第零节更新相关状态，公共文件由其串行接收；本任务不抢占台账所有权。
5. **未验证**：真实模型 CER/中文词边界/云延迟/实际费用、本地离线方案、录音设备/双时钟/跨块与gap、讲解宿主/隐私擦除链属于后续任务。零付费夹具不替代这些成绩。
6. **共享工作区类型门禁**：总管理者需协调上述 imageEdit 测试版本错误修复后取得最终渲染层 tsc 0 失败证据，不能把前轮通过声称为当前整个工作区通过。

## 设计自查

1. **助手只凭名称和说明能否用对？** 能通过既有通用 settings.registry 的 `transcription.default_model` 描述、enum、read/change 选择完整模型；说明明确自动、凭据、时间戳和任务冻结。未配置/无效明确拒绝；上传/付费授权由 owner 单独执行，不能因改设置自动发送音频。
2. **能否 AI 先做、人只确认？** 自动先筛合格供应商/模型并显示实际选项；转写给出真实词/字/句时间和缺失标记，人只校正粗时间/文本。不会用均分伪造对齐；收费或外发需要用户知情授权。
3. **产物能否直接流进其他工作区？** 共用毫秒 DTO 不依赖口播工程，P3-1 可直接接录制讲解；既有口播委托同一路径，字幕共享清单。流入作品仍由目标正式文档/撤销/持久操作完成，不另建产物 Store 或私有通道。
