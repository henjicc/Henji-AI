# P3-1 / t148：剪辑录制讲解

日期：2026-10-11。工作分支 main。总管理者负责审查、Git 提交和共享验收；本任务未执行 Git 写操作、未修改 SDK 或图片/持久格式所有权文件。

**状态：剪辑采集、受控转写、审阅与 JSONL 已接入；尚不能登记 P3-1 完整验收完成。** 真实 Electron 截图/逐帧序列、物理采集时钟 P95、历史标注完整快照和部分公共能力仍有下述缺口。用户通用规则禁止 Reality/启动开发实例，验收又要求真实 Electron；已提出冲突澄清，未收到额外执行许可，因此没有伪造截图或以浏览器代替 Electron。

## 实现与设计决定

- 节目监视器提供知情开始、永久录制状态/秒数、暂停、继续、结束、已封页恢复、词稿校正、回听、逐批 JSONL 预览和明确确认的彻底删除。录制不自动播放；播放暂停仍采音，录制暂停释放麦克风并形成 gap。
- 采集核位于 `src/features/creativeIntent/recording/`，不依赖剪辑文档、供应商或 IPC。宿主提供真实呈现回执和页写入；静态宿主可使用明确的 null 时间轴。图片宿主尚未接入。
- AudioWorklet 使用 `currentFrame` 和 AudioContext 的实际采样率，4096 样本工作批；不以消息/chunk 到达时间生成采样时间。通过 `getOutputTimestamp` 或夹取的 context/performance 时钟关联计算 offset，记录输入延迟未知时的保守不确定度；不冒称该 API 测出了物理输入延迟。
- 10 秒 PCM 封成独立 WAV，保留每块采样起点与墙钟 offset，不自行重采样；设备/采样率/采样连续性改变会分块并暂停。音频输出为静音，不监听麦克风，不采集摄像头/系统音频。
- 每条事件保存 seq、单调微秒、实际 timeline 或明确不可用原因、clockSegmentRef；有时间轴时保存 visit。seek 不插值，同帧重访不去重。header 仅留时钟首尾锚点，完整呈现回执在分页 timeline 中。
- 渲染器把实际提交且确认呈现的 composition 传给录制，迟到回执不会读取新文档代替旧画面；requested 不作为 presented。指向记录与异步摘要计算之间先冻结双时间和 seq。
- 指针采集限本应用，敏感控件、输入框与编辑正文不采；保留画幅坐标、视口/文档映射、实际 hover/pointed/selected 引用。时间指针默认 navigate；已有 P1 示范模式/属性切换另记 control，只有明确示范中的节目指向才标 demonstrate。
- JSONL保留control的示范属性、geometry的window/DPI/crop/orientation/ancestorAffine和pointer的不确定度，防止投影丢失已有结构化证据；只输出真实正式workspace引用，画面外指向q=null。
- 正式命令、提交、失败、手势取消、undo/redo 共享视频服务的事实订阅。operation 来自正式历史身份；变换差分关联原操作。命令摘要覆盖作品结构，失败/取消 before=after；JSONL 标 alreadyApplied，不执行、不重放。录制头更新不增加作品撤销项，结束记录相关目标的正式末态。
- 每种事件单页 256 条，页写入串行；失败页和音频块保留可重试，4 个待写音频批次或8项未完成的摘要/命令工作触发背压暂停。以上是内存/IPC/I/O 工作预算，不是会话、素材、元素或时长上限。8 MiB PCM IPC 批次和受控 WAV ZIP 单条目大小是技术约束。
- 结束后经 P3-0 默认模型解析 → 正式 platform/preload/IPC → `timestampedAsrService.prepare/execute`。不复制 provider/parser；模型在一次转写中冻结。独立确认音频上传/费用，仅向选定 ASR 外发音频，不调用意图模型。
- SDK 毫秒词/字/句粒度原样保留；句级标粗时间，不均分成词。缺时间文本保留为整块待人工确认。按每块采样 offset 对齐墙钟，再用涉及区间的真实呈现页恢复多 timelineSpans，不跨 seek 插值。
- 校正是不可变新增原稿页并引用 originalEvent；审阅/serializer 投影覆盖原词，不重复发送旧文和校正文。回听用临时 Blob，换行/离开即撤销 Object URL。
- 默认 WAV 位于受管临时目录，关闭审阅/宿主、开始下一次或切换已封讲解时释放，词稿保留；启动及运行期间清理24h过期缓存。原音失效的recoverable会话可以重新开始，但不能假装继续原录音。明确保留时复用已有ZIP管线，流式打包为所属文档audio单资源，经既有importFile进入materials，按摘要恢复。
- 清除临时原音保留转写提交回执，防止未知提交恢复后重新收费；彻底删除才删除对应任务账本及缓存结果。内容 SHA-256 参与请求身份，同字节数但内容变化也拒绝。未确定提交且没有可恢复 provider task ID 时拒绝重发；SDK session ID 不冒充 provider task ID。
- 删除同步清除当前文档、past/future 和正在进行的 gesture 中的私密头及资源引用；原音/页文件/任务副本随之擦除。删除中迟到写入和转写结果不能复活。文件擦除失败保留待删路径，允许重试。
- 麦克风拒绝、设备 ended、context suspended、窗口失焦、取消和关闭均有释放路径；权限请求晚到仍释放 stream。正常关闭先等最终 worklet 样本再 abort；并发 stop 共用同一 drain Promise。
- 权限处理拒绝地理位置、通知、设备与未知权限；为既有复制/粘贴保留明确clipboard白名单，不以录音授权放行其他权限。音频/clipboard请求仅可信主frame；检查和请求处理器都测试，未在真实Electron现场验证。
- 日志只写生命周期及非私密定位信息，不写音频、词稿、指针、任意命令载荷或 SDK 原始错误。SDK 失败缓存使用固定提示。

## 对外接口

| 使用方 | 接口 | 契约 |
|---|---|---|
| 图片/其他宿主 | `RecordingCollector(session, writePage, pressure)` | `start/presented/record/reserve/append/pause/resume/stop/flush`；页发布由宿主注入，只有真实回执才能填 timeline。 |
| 采音宿主 | `captureMicrophone(originMs,onBlock,onInterrupt,signal)` | 返回幂等且可等待尾样本的 stop；block 含 firstFrame/samples/sampleRate/monoStartUs/uncertaintyUs。 |
| P3-2 | `alignRecordingTranscript`、`recordingTimelineSpans` | 输入 P3-0 规范 DTO、音频块、展开的真实锚点；输出真实粒度、多跨度和对齐质量。 |
| P3-2/意图输入 | `serializeRecordingInput` | async JSONL 流；固定 w/t/cs/visit/s、共享引用字典、words 或句 span、末态、alreadyApplied；仅数据投影。 |
| P3-2 附图 | `selectRecordingFrames` | structured=0、appearance 默认1、change 默认前/当时/后3；同帧不同 visit/state 不合并。调用方提供可靠 stateDigest 和实际历史图来源。 |
| 剪辑宿主 | `videoEditExplanation.ts` | start/pause/resume/stop/reopen/transcribe/cancel/retrySave/readPage/correctText/readAudio/retainAudio/clearTemporaryAudio/erase/JSONL。 |
| 平台 | `audioEdit.recording` | microphone/write/read/erase/release/archive/restore/transcribe/cancel，经一个 `audioEdit:explanation` 合法桥，不新增日志通道。 |
| Pi/MCP | `video_edit.explanation_session` | C1 只读 stage/retention/audioUpload 元数据，实时 heads 分页；不暴露私密正文、路径、指向或可伪造的 consent 写入。 |

公共采集出口在 `src/features/creativeIntent/index.ts`；默认转写服务出口在 `src/features/settings/index.ts`，避免跨 feature 内部导入。命令事实监听/close preparation 为视频服务正式入口，多个准备回调可共存，不覆盖 P1 的关闭处理。

## JSONL 示例

以下是脱敏结构示例，UUID/摘要省略为占位，不是现场录音或真实模型成绩；实际生成器会补出完整摘要及引用字典。句级不含 words，真实词级使用 `words=[wordId,startW,endW,text,timelineSpans]`。

```jsonl
{"kind":"header","v":"explanation-input/1","mode":"animated","clockUnit":"ms","timelineUnit":"presented-frame","size":[1920,1080]}
{"kind":"dictionary","refs":{"r0":{"kind":"video_edit.sequence","id":"doc:sequence"}}}
{"kind":"clocks","segments":[{"id":"c0","spanW":[0,3000],"mode":"hold","start":{"sequence":"r0","frame":120,"fps":[30,1],"visit":"v0"},"end":{"sequence":"r0","frame":120,"fps":[30,1],"visit":"v0"},"pointsWT":[[0,120],[3000,120]],"visit":"v0"}]}
{"kind":"event","s":1,"id":"p0","w":200,"t":120,"cs":"c0","visit":"v0","type":"playhead","action":"present","requestedFrame":180,"intent":"navigate","rate":1}
{"kind":"event","s":2,"id":"u0","w":300,"t":120,"cs":"c0","visit":"v0","type":"speech","utterance":"utterance0","text":"从这里移动","source":"asr","spanW":[300,1200],"granularity":"segment","alignment":"coarse","timelineSpans":[[300,1200,120,120,"c0","v0"]]}
{"kind":"dictionary","refs":{"r1":{"kind":"video_edit.operation","id":"formal-operation"},"r2":{"kind":"video_edit.clip","id":"doc:clip"}}}
{"kind":"event","s":3,"id":"op0","w":1500,"t":120,"cs":"c0","visit":"v0","type":"command","operation":"r1","phase":"committed","related":null,"targets":["r2"],"alreadyApplied":true,"before":"sha256:BEFORE","after":"sha256:AFTER"}
{"kind":"event","s":4,"id":"d0","w":1500,"t":120,"cs":"c0","visit":"v0","type":"delta","command":"r1","changes":[["r2","position",[0.25,0.4],[0.75,0.4]]]}
{"kind":"request","text":"","bindings":[],"finalState":{"r2":{"position":[0.75,0.4],"rotationTurns":0,"scaleXY":[1,1],"pivot":[0.5,0.5],"atFrame":120}},"missing":[],"imageAttachments":[],"execution":"preview-only; recorded commands already happened"}
```

本轮不提交该投影给任何模型。标注当前仅输出稳定引用/角色/摘要，完整几何/文本的契约缺口见下。

## 验收矩阵与实测边界

| 项 | 实际已覆盖 | 尚未覆盖 |
|---|---|---|
| E01 | 独立 collector 的 hold120→play180→hold讲话→倒退150→继续180，录制不停止；开始不自动播放、pause才 gap；正式剪辑 service 联测 | 真实 Electron 顺序截图/逐帧序列和物理音画同步 |
| E02 | navigate 不造姿态；P1 模式/属性独立 control，显式示范指向；正式提交四属性差分 | P1 草稿示范姿态与 ExplanationSession 的稳定关联，路径语义属于 P3-2 |
| E03 | requested180/presented120，句跨 seek，多跨度、音频晚到独立 offset、静态 null、迟到 composition 回执 | 真实 GPU 呈现与真实麦克风同时采样证据 |
| E04 | 倒退和同帧 visit 不合并；既有 P1 编译/冲突测试包含在指定回归范围 | P3-2 同帧语义校正/take选择联合 UI |
| E05 | move→undo→redo→失败，operation 链、差分、真实末态、JSONL alreadyApplied；删除后 undo 不复活 | 未跑真实 Pi/MCP 创作；没有实现口述执行 |
| E06 | P3-0 共用入口/默认模型；本地 PCM+预置 SDK DTO，词字句/缺时刻/非法时间，冻结模型、未知任务禁重发、原任务恢复、取消 | 真实中文 CER、真实词边界/云延迟和实际费用，全部未付费 |
| E09 | 100000事件分页尾部、背压、保存重试、sealed恢复、权限拒绝/设备断开/晚到权限/尾样本、ZIP留存摘要、临时清除保留回执、历史/任务/文件删除及擦除重试 | 打包后的设备权限/异常退出、真实宿主截图与长期运行 TTL现场验收 |

### 软件性能与时钟数据

受控 48kHz 样本时钟真值和 1 小时墙钟模拟；采集页流在本机测量，不调用供应商：

| 指标 | 结果及限制 |
|---|---|
| 事件/页/尾部 | 100002条（100000+开始/结束），392页；单页≤256；末尾 seq=100001 |
| 结构化字节 | 24164006 bytes，无截尾 |
| 首次合成基准耗时/吞吐 | 673.6598ms / 148445.8476事件每秒；只测 collector，不代表磁盘导入、UI或麦克风性能 |
| 首次基准 RSS | 183296000→245694464 bytes；不作为持续增长/真实应用峰值证明 |
| 采样量化误差 P95 | 0.5µs（相对于软件真值），与消息到达无关 |
| 声明延迟估计不确定度 P95 | 32767µs；夹具声明 inputLatency=20ms、baseLatency=10ms；不是物理输入实测 |
| 物理采集/显示 P95 | **未测，null；不能宣布≤50ms门槛通过** |

末次独立复验为529.6735ms、188799.3264事件/秒，RSS89202688→157192192 bytes；最终范围回归复测549.0863ms、182124.3764事件/秒，RSS89862144→157655040 bytes，页数/字节/量化P95相同。基准每次在OS temp写 `henji-t148-recording-metrics.json`；不向仓库写录音/截图/临时日志。硬件未声明输入延迟时采用100ms保守项，因此按粗对齐处理；长期设备漂移还未实测。

### 截图与序列清单

**实际截图=0，实际逐帧序列=0，目视结论=未验。** 以下是总管理者的待验场景清单，不是已经存在的文件：

1. 开始说明/授权 → 拖时间指针 → 自主播放 → 播放暂停讲话 → 倒退 → 继续 → 结束，逐帧比对实际呈现与双时间。
2. 预置句级词稿、词/字级标签、回听、校正和 JSONL 预览，逐张检查。
3. 假设备断开、gap、恢复、设备释放和 sealed 页读回。
4. 删除确认、词稿/原音/任务副本消失、undo/redo 不复活。

不得把 jsdom/软件 benchmark 当 Electron 截图。后续获准 Reality 时才获取截图锁，结束立即释放；本任务未运行 Reality，未持锁，未启动开发实例。

## 验证记录

本改动涉及共享契约、权限、文件 I/O 和异步状态，按 testing.md L2；指定九目录完整回归由用户明确要求，属于 L3 的“用户明确要求”条件。没有运行全仓测试、完整构建或付费 Reality。

- 新增测试共30项，均经精确复验：core audio2、core recording4、collector3、benchmark1、worklet1、microphone2、native audio5、IPC1、宿主9、UI2。另有原音频效果7项通过。末次宿主9项覆盖并发开始/切换会话清临时原音且保留词稿；UI2项覆盖旧私密预览不能复活和原音失效会话的新录制入口；core4项确认不会拿未来帧替代当时画面且JSONL不丢示范属性/几何信息。
- 中间精确复验一次因本机提交内存紧张 V8 OOM退出，不能算通过。随后验证改为 `--pool forks --poolOptions.forks.maxForks=1 --poolOptions.forks.minForks=1`，同时保留 `--silent --poolOptions.threads.maxThreads=3 --poolOptions.threads.minThreads=1`。
- 渲染层tsc中途仅在t147 `imageEditLayoutDraft.test.ts:90`（六元组断言）与 `imageEditLayoutDraft.ts:177`（readonly Affine）报错，没有修改这些非本任务文件；并行负责人修正后，本任务最终静态ASR/隐私生命周期源码的复验通过。
- Electron tsc最终静态ASR/附图manifest及权限白名单补丁后的复验通过。
- 全部本任务38个TS/TSX/JS文件的 ESLint 末次通过。
- main-imports、IPC contract、dependency graph、dead-code、UI residue、surface、colors、icons、assistant capabilities、persistence compat 均已通过；dependency graph 末次42.09秒、2静态SCC、0冻结跨层边。dead-code 为仓库现有2104出口报告，不是零存量报告。
- assistant-capabilities 脚本自身执行的原覆盖/不变量测试通过（13+206项）；脚本内部固定调用未传本任务线程/静音选项，不宣称它使用了受限参数。
- 首次指定九目录完整回归：325文件通过、1文件/1测试失败、3文件跳过，2472测试通过、7跳过、10 worker异常退出（1185.44秒），**不能算零失败**。失败定位原音频效果断言对长数组 `Math.max(...samples)` 展开导致调用栈上限；本任务改用逐样本reduce求峰值，精确7测试已通过，未改音频DSP行为。检查该文件两个同类断言，一并修复。
- 首轮10个GPU worker都在Electron Node的Dawn路径退出。官方 [VGPU Node adapter](https://github.com/vercel-labs/vgpu/blob/main/packages/adapter-node/README.md) 定义Node.js22+环境；后按仓库 `scripts/lib/testSuites.cjs` 的unit/gpu/native清单分层，保持指定九目录范围复验：正常Node GPU11文件57测试通过/4存量跳过/0失败；Electron Node SQLite原生1文件3测试通过/0失败；最终正常Node unit326文件2478测试通过、3文件/3存量测试跳过、0失败，exit=0，1150.65秒。**同一指定范围的分层全集合计338文件/2538测试通过、3文件/7测试跳过、0失败**。不是宣称原混合运行时单命令已返回0。
- 两轮普通Node unit复验因运行期间补隐私断言/界面入口，混用了旧转换缓存/新测试，旧JSONL流或新录制入口断言失败；分别只停止经命令行核实属于本任务的PID156/PID70036进程树，没有关闭用户程序。当前源码独立宿主9项/UI2项通过，随后全部本任务生产和测试源码停止修改，再完整执行指定范围unit，最终零失败。有效GPU/原生证据未重复运行。
- 三层均使用 `--silent --pool forks --poolOptions.forks.maxForks=1 --poolOptions.forks.minForks=1 --poolOptions.threads.maxThreads=3 --poolOptions.threads.minThreads=1`；unit/GPU用本地Node的Vitest入口，SQLite用Electron的 `ELECTRON_RUN_AS_NODE=1`（无窗口）。范围为用户指定的九目录，按正式清单过滤，未跑全仓；内部assistant-capabilities脚本原测试的参数差异见上，不掩盖。
- 原完整日志：OS temp `henji-t148-verification-b460f220-cb5e-4056-8c62-af3c6ef47a01/{stdout,stderr}.log`；停止轮日志：`henji-t148-final-46edeb41-244d-4b61-9dbd-e1da9acc342a/{stdout,stderr}.log`、`henji-t148-frozen-1c41a7ed-9e41-434c-a4fa-8be6e21cac7b/{stdout,stderr}.log`；最终稳定unit日志：`henji-t148-stable-2febeaba-c950-4b09-8904-81c0d7f6e6f9/{stdout,stderr}.log`；原生日志：`henji-t148-native-8f2b558b-8a99-478d-8075-49ea285011dc/{stdout,stderr}.log`。均无应用窗口、未运行Reality。

## 选型依据

不新增媒体处理依赖。采集使用 [AudioWorklet currentFrame](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletGlobalScope/currentFrame) 与 [getOutputTimestamp](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/getOutputTimestamp)，保留 SDK 的真实采样/时间戳契约；MediaRecorder 事件到达时间不能充当采样原点。音频留存复用仓库已有 archiver/yauzl ZIP封装和受管文件导入，不自研 ZIP/附件渲染。ASR复用 t146；UI复用 Ui*/PanelTrigger/Virtuoso。权限参考 [Electron Session permission handlers](https://www.electronjs.org/docs/latest/api/session)，仅可信已armed主frame单音频请求，不允许相机/混合请求。

## 未完成项与总管理者注意

1. **完整历史标注/一般元素状态差分**：P1 annotation event仅有ref/digest/role，无不可变几何/文本 resourceRef；delta property仅四种姿态。当前记录四属性差分及完整作品摘要/受影响 clip identity，标注只保引用/摘要。删改标注后不能凭摘要恢复原文字/向量；不得读当前标注冒充过去。需要总管理者扩正式契约、资源 live set/导入导出，随后补历史标注投影；本任务没有绕过持久所有权。
2. **示范稿关联**：已有 P1 独立动作稿可以使用，但 ExplanationSession 尚缺绑定该 draft/take 的正式字段；本轮只记录模式控制和真实指向，不把 navigate 当示范，也不把未应用预览伪装已执行 command。
3. **私密正文公共能力**：仅C1元数据可通用实体读回。词稿/绑定/排除段/留存设置的C2授权读写须 P3-2/总管理者接正式隐私权限，不能通过新增普通布尔 consent 开洞。
4. **历史图像**：选帧函数产出 manifest，未持久化历史像素/作品快照，未生成 contact sheet；P3-2必须提供真实历史来源再调用既有截帧/合成。结构化证据足够时不附图；图像未授权外发。
5. **真实环境**：Electron截图/动态序列/目视、物理输入与显示同步、长时钟漂移、打包权限/崩溃清理待验。不运行开发环境；合入主进程/预加载桥后，总管理者需重新生成运行产物并按授权重启。
6. **恢复和规模**：同进程恢复保留原墙钟；跨进程从sealed末尾续记，不用UTC估算精确停机时长。词稿校正/JSONL投影按页扫校正引用，内存有界但大规模多页校正有重复I/O，尚未做端到端转写/磁盘/UI压力实测。
7. **并行共享**：`electron/preload/index.ts`、`api-media.d.ts`、creativeIntent根index、02总览及SDK/图片门禁输入可能由其他任务同时变更；审查只整合本任务增量，不还原并行内容。t147先前阻塞tsc的错误已由并行任务消失，本任务两条tsc通过。
8. **费用/原音**：UI如实显示估价未知和供应商/模型，不代替实际计费验证。原音留存沿项目audio资源打包，用户已在留存确认中看到随保存/导出说明；独立导出前移除原音选择仍待总管理者完善。

## 设计自查

1. **助手只凭名称和说明能否用对？** 已发现只读录制会话实体明确说明授权、留存和状态；采集/外发授权只能真实用户给出。私密校正/意图执行尚不开放，不能宣称全稿可用；P3-2按正式授权后接通用实体，不新增设置值专用工具。
2. **能否 AI 先做、人只确认？** 时间戳转写和对齐走SDK共用入口，默认选定模型；句级/缺证据明确，用户校正。自动意图解析/应用属于P3-2，本轮不调用意图模型、不擅自改作品。
3. **产物能否直接流进其他工作区？** 私有会话/pages/audio沿剪辑既有creativeIntents和受管材料路径保存，纯采集与serializer可被图片宿主复用；跨宿主语义/图像消费及完整标注快照仍有明确未接项，未把JSONL假称已经完成下游创作。

## 本任务文件清单

- `src/core/audioEdit/recordingAudio.ts`：定义录音IPC请求schema和PCM16 WAV编码。
- `src/core/audioEdit/recordingClock.ts`：计算采样时钟与单调墙钟的关联及估计不确定度。
- `src/core/audioEdit/recordingAudio.test.ts`：验证PCM编码和采样时钟数据。
- `src/core/creativeIntent/recordingAlignment.ts`：按音频块offset对齐SDK转写并保留真实粒度/多时间跨度。
- `src/core/creativeIntent/recordingSerializer.ts`：流式生成引用字典、双时间和已执行命令的JSONL。
- `src/core/creativeIntent/recordingEvidence.ts`：生成有真实呈现依据的单帧/变化附图manifest。
- `src/core/creativeIntent/recordingEvents.ts`：构建符合正式schema的命令事件。
- `src/core/creativeIntent/recording.test.ts`：验证对齐、静态时间、serializer和选帧契约。
- `src/core/creativeIntent/fixtures/recordingFixtures.ts`：提供不含真实录音的合成会话夹具。
- `src/features/creativeIntent/recording/RecordingCollector.ts`：实现宿主无关双时钟采集、visit、分页与背压。
- `src/features/creativeIntent/recording/RecordingCollector.test.ts`：验证hold/gap/seek及封页恢复和尾部。
- `src/features/creativeIntent/recording/RecordingCollector.benchmark.test.ts`：测量十万事件和软件时钟P95，写OS临时结果。
- `src/features/creativeIntent/recording/captureWorklet.js`：以AudioWorklet currentFrame分批采集真实采样帧。
- `src/features/creativeIntent/recording/captureWorklet.test.ts`：注入合成PCM验证worklet停止和尾样本。
- `src/features/creativeIntent/recording/microphone.ts`：管理知情麦克风采集、设备断开和幂等释放。
- `src/features/creativeIntent/recording/microphone.test.ts`：验证权限晚到、采样关联和释放。
- `src/features/creativeIntent/index.ts`：公开宿主无关采集入口。
- `src/features/settings/index.ts`：公开已有默认转写模型管理服务。
- `src/features/videoEdit/application/videoEditExplanation.ts`：接入剪辑采集、转写、审阅、保存、恢复及隐私擦除。
- `src/features/videoEdit/application/videoEditExplanation.test.ts`：联测剪辑双时钟、正式历史、故障恢复和删除不复活。
- `src/features/videoEdit/application/videoEditExplanationReflection.ts`：注册只读会话元数据实体并隔离私密正文。
- `src/features/videoEdit/application/videoEditReflection.ts`：将会话实体接入既有视频反射注册。
- `src/features/videoEdit/application/videoEditService.ts`：增加正式命令事实和多关闭准备回调，隐私头更新不造撤销。
- `src/features/videoEdit/panels/VideoEditExplanationControls.tsx`：呈现知情录制、词稿审阅、原音确认和流式JSONL预览。
- `src/features/videoEdit/panels/VideoEditExplanationControls.test.tsx`：验证旧私密UI缓存清除和失效录音的新录制入口。
- `src/features/videoEdit/VideoEditPreview.tsx`：把录制接入实际节目监视器及真实呈现回执。
- `src/features/videoEdit/engine/videoEditRendererAudioEffects.test.ts`：修复两处长音频测试数组展开导致的调用栈失败。
- `electron/main/services/audio-edit/explanation-audio.ts`：管理临时音频、受管ZIP、SDK共用转写和提交回执。
- `electron/main/services/audio-edit/explanation-audio.test.ts`：验证本地音频留存/恢复、内容身份、取消和擦除。
- `electron/main/services/audio-edit/task-store.ts`：提供对应音频任务账本的受控查询。
- `electron/main/services/audio-edit/timestamped-asr.ts`：避免ASR日志记录私密原始SDK错误。
- `electron/main/ipc/explanation-audio.ts`：注册可信麦克风权限及单一录音IPC桥。
- `electron/main/ipc/explanation-audio.test.ts`：验证可信主frame的单音频授权边界。
- `electron/main/ipc/audio.ts`：接入录音IPC注册。
- `electron/preload/index.ts`：暴露录音平台桥，保留并行预加载增量。
- `electron/preload/api-media.d.ts`：补充录音预加载契约类型。
- `src/platform/contracts/audioEdit.ts`：定义音频平台的录音能力。
- `src/platform/adapters/electron/audioEdit.ts`：将录音能力转发给正式Electron桥。
- `docs/task/超级关键帧/任务/P3-1-recording.md`：记录实现、接口、JSONL、实测与未完成验收。
- `docs/task/超级关键帧/02-实施拆分.md`：仅追加本任务P3-1状态行。
- `docs/rules/assistant-status.md`：登记会话C1可读及私密正文C2的实际欠账。
