# 9e 音频编辑：处理后读回声音、杂音检测、重新定位原素材

没碰 git，没启动、重启或关闭应用，没跑 bundle 或 build，没做付费调用。重命令都经 heavy.sh 排队。没动音频编辑界面面板、剪辑片段 schema、主进程数据库与启动、录制收尾；i18n 没改。

## 一、现状（改之前）

- 已有分析：主进程 `audioEdit:matchLoudness`（渲染不含响度补偿的成品，FFmpeg ebur128 测积分响度，只回 integratedLufs 与 gainDb）、`audioEdit:silence`（原素材时间的停顿与逐帧电平，给粗剪用）、`audioEdit:breaths`、`audioEdit:detectMouthClicks`、频谱金字塔（audio-worker）、波形峰值。助手能拿到的只有匹配响度回执里那一个“补偿前积分响度”，补偿与末尾限幅之后到没到目标、真峰值多少、有没有削波都读不回。
- 剪辑侧 `measure_video_edit_loudness` 只接剪辑片段；它的口径在 `electron/main/services/audio/loudness.ts`（FFmpeg：4 倍重采样后 ebur128 peak=sample，即 4 倍重建真峰值）。这次直接复用这份实现，没写第二份响度测量。
- audio-worker（`native/audio-worker`）只有频谱、修复画笔、去爆音、语音预处理降噪，没有嗡声、削波、底噪检测；内置效果里的“去嗡声”和基本声音的 hum 修复是处理，不是检测。
- 重新定位：界面有“重新定位”（`AudioEditApp.tsx` 标题栏的源素材报错旁、文件菜单），走 `relinkAudioEdit` → 主进程 `relinkAudioEditSource`（核对指纹或整文件摘要与原素材相同）。助手没有入口，导入失败的报错却叫它“重新定位”。

## 二、覆盖分级结论

| 需求 | 级别与形态 | 理由 |
|---|---|---|
| 读回“现在听起来怎样” | 能力增量，**专用只读能力** `check_audio_edit_sound` | 要先渲染成品、跑 FFmpeg 与逐采样统计，几十秒、可取消，是算法型读回；放进实体属性会让每次普通读取都触发渲染 |
| 回执补关键数字 | 扩展已有能力的输出（向后兼容的可选字段） | 不新增工具 |
| 嗡声、爆音（削波）、底噪 | 并进同一条读回 | 有现成基础（成品渲染 + 效果工作线程），算法简单、可精确测试，半天内做稳 |
| 重新定位原素材 | **属性**：`audio_edit.document.source_path` 可写 | “把素材换到新路径”就是设置一个值，按规则走通用写入；不新增 `relink_audio_edit_source` |
| 原素材能不能用 | **只读属性** `audio_edit.document.source_problem` | 读取时向主进程核对一次，只在点名或整实体读取时做 |

## 三、做了什么

### 1. 读回能力 `check_audio_edit_sound`

- 测的是剪好的成品（`renderAudioEditProject`，剪切、修复、效果控件、输出都生效，与导出 WAV 同一份、走同一缓存），所以时间轴天然就是剪后作品时间（秒），与 `audio_edit.caption.start_ms ÷ 1000`、`insert_audio_edit_file.positionSeconds` 同一坐标。可给 `startSeconds/endSeconds` 只测一段，返回的所有位置都已加上起点偏移。
- 两路并行，主进程只汇总：
  - 响度：`measureAudioFileLoudnessTimeline`（`loudness.ts`，原 `measureAudioFileLoudness` 改为调用它，滤镜参数一字未改），同一次 FFmpeg 顺带取 LRA 与逐 100 毫秒的 400 毫秒块响度（ebur128 的 M）。整体积分、真峰值与剪辑同一口径；分段响度用这些块按 BS.1770（-70 绝对门限、-10 相对门限）积分，真实 FFmpeg 测试里与“FFmpeg 只测这一段”相差 ≤0.2 LU。
  - 采样级统计：效果工作线程新增任务 `sound-stats`（`pcm-jobs.ts`），算法在 `src/core/audioEdit/soundCheck.ts` 的 `AudioEditSoundStatsCollector`：每 10 毫秒电平与峰值；每 10 毫秒全频与 2.5 kHz 以上两个电平；削波 = 同一声道连续至少 3 个采样达到 -0.1 dBFS 以上，或一串里有采样超过满刻度，相距 <50 毫秒算一处；工作线程读两遍，第二遍只把非语音帧里的采样凑成整秒，算 50/100/150 与 60/120/180 Hz 的能量占比（判据与依据见第十一节）。
- 汇总（`summarizeAudioEditSound`）：
  - loudness：integratedLufs、loudnessRangeLu、truePeakDbtp、samplePeakDbfs；输出一节打开自动匹配时带 targetLufs。
  - clipping：处数、采样数、位置。
  - silence：停顿用粗剪停顿检测的同一判据（`speechEnergy.ts` 的直方图与低谷：全频低于第 80 百分位减 22 dB，且 2.5 kHz 以上低于其第 80 百分位减 16 dB），thresholdDbfs 给出这次算出的全频门限；过长停顿用批量设置的检测时长；合计、开头结尾静音、过长停顿处数、最长一段与位置。
  - noise：底噪 = 非语音且不是数字静音的 50 毫秒片段电平的中位数，这样的片段不足 2 秒时 floorDbfs 为 null、rating 为 unknown；rating clean ≤-60、audible -60～-50、high >-50 dBFS；嗡声只用非语音片段凑出的整秒，电源频率族占比中位数 ≥0.2 判 suspected，不足 2 秒为 unknown。
  - keyWindows：最响、最轻、比整体响或轻 4 LU 以上（最多 6 段）、有削波（最多 3 段）的分段，windowSeconds 默认 10。
  - issues：用户语言的一句话问题清单（离目标 >1 LU、削波、真峰值高于 -1 dBTP、底噪、嗡声、过长停顿）。
- 细节按需：项目通用的 includeDetails 在主进程投影层就被剥掉、到不了处理器，所以用业务参数 `includeWindows`：默认不给逐段数组，削波与停顿位置各最多 8 处；true 时给全部分段与全部位置。
- 处理前后对比：渲染层 `audioEditSoundCheck.ts` 按（口播、范围）记住上一次读回（本次运行内，最多 64 条，口播实例释放时清掉）；口播保存修订变了再测同一范围时给 `sinceLastCheck`（本次减上次：响度、LRA、真峰值、底噪、时长、削波处数、过长停顿处数）。
- 消息一句话：整体数字 + 问题 + 与上次相比变了什么。
- 主进程入口 `audioEdit:checkSound`（`runAudioEditTask` 只读任务，可取消，同一 requestId 重试取回已存结果），日志 `audio_edit.sound_check.start/completed/failed`（只记口播 ID、耗时与汇总数字）。

### 2. 回执补数字

- `match_audio_edit_loudness`：补偿后再读回一次整条成品，回执新增 `sound { integratedLufs, truePeakDbtp, beforeLufs }`，消息里写“补偿后实测 …”。读回失败只记 warn、不影响匹配本身。
- 所有可撤销的口播操作（插入、修复、还原、字幕、快速处理、停顿、语气词、重念、呼吸、响度、口水音）回执新增 `editedSeconds`（处理后剪后时长，现算，不渲染）。去重念、呼吸、停顿原有的 shortenedMs、各处数保持不变。其余处理不为回执再渲染一次成品（太慢），完整结果用读回能力。

### 3. 重新定位原素材

- `audio_edit.document.source_path`：读为当前原素材路径；写入由 `AudioEditMutationExecutor` 先交给 `relinkAudioEdit`（与界面“重新定位”同一个渲染层服务与主进程核对，内容不同就拒绝并原样给出原因），同一事务里的其他属性照常走草稿写入。素材按设计不随普通编辑与撤销改变（`IMMUTABLE_SOURCE`、撤销快照保留当前素材），所以重新定位不进撤销，属性说明里写明了。`verificationStrategy: 'execution'`：主进程会把路径规范化（如正斜杠变反斜杠），不能按写入值等值核对。
- `audio_edit.document.source_problem`：空字符串表示素材在且没变；否则是主进程 `verifySource` 的原话（找不到 → 写 source_path；内容已改变 → 新建口播）。
- `import_audio_edit_source` 的报错改为指向 source_path。

### 4. 技能文档

`resources/assistant-skills/audio-edit-workbench/SKILL.md`：第一步补“找不到原素材读 source_problem、写 source_path”；第三节回读核对加一次 `check_audio_edit_sound`；第五节声音处理新增“处理之后先读回再继续”（先读一次、每步处理后读回看 sinceLastCheck、常见判断阈值、只测一段与逐段的用法）。只写通用做法。

## 四、改动文件

新增：
- `src/core/audioEdit/soundCheck.ts`（统计、汇总、对比、请求与结果 schema）
- `src/core/audioEdit/soundCheck.test.ts`
- `src/core/application-control/domains/audioEdit/audioEditSoundCheckCapability.ts`
- `src/features/audioEdit/application/audioEditSoundCheck.ts`
- `src/features/audioEdit/application/audioEditSoundCheck.test.ts`
- `electron/main/services/audio-edit/sound-check.ts`
- `electron/main/services/audio-edit/sound-check.ffmpeg.test.ts`
- `tickets/46-正式使用链路/result-音频读回.md`（本文件）

修改：
- `src/core/application-control/domains/audioEdit/audioEditApplicationCapabilities.ts`（输出加 editedSeconds、sound；匹配响度说明；能力列表拆出 AUDIO_EDIT_OPERATION_CAPABILITIES 并入读回能力）
- `src/features/audioEdit/application/registerAudioEditCapabilityHandlers.ts`（读回处理器、匹配响度回执、editedSeconds、导入报错文案）
- `src/features/audioEdit/application/audioEditFields.ts`（source_path、source_problem）
- `src/features/audioEdit/application/audioEditReflection.ts`（读 source_problem 时核对素材）
- `src/features/audioEdit/application/audioEditMutationExecutor.ts`（source_path 走 relinkAudioEdit）
- `src/platform/contracts/audioEdit.ts`、`src/platform/adapters/electron/audioEdit.ts`（checkSound）
- `electron/preload/index.ts`、`electron/preload/api-media.d.ts`（checkAudioEditSound，只是多一个 nativeInvoke 通道，隔离设置未动）
- `electron/main/ipc/audio.ts`（`audioEdit:checkSound`）
- `electron/main/services/audio-edit/pcm-jobs.ts`（sound-stats 任务）
- `electron/main/services/audio/loudness.ts`（measureAudioFileLoudnessTimeline，原函数改为调用它）
- `electron/main/services/application-runtime/outputContract.test.ts`（新能力与新回执字段的公共输出样例；这个门禁要求每个有 outputSchema 的工具都有样例）
- `resources/assistant-skills/audio-edit-workbench/SKILL.md`
- `electron/main/services/audio-edit/media.test.ts`（审查后补：重新定位到内容不同的文件被拒绝）
- `docs/rules/assistant-status.md`（台账：新增一条，三节补“未真实走过”）

## 五、契约变化（只有向后兼容的新增）

- 新工具 `check_audio_edit_sound` v1（只读、免费、可取消）。
- 口播操作公共输出新增可选字段 `editedSeconds`、`sound`。
- 实体 `audio_edit.document` 新增可写属性 `source_path`、只读属性 `source_problem`。
- 新 IPC `audioEdit:checkSound`。没有落盘格式变化。内置助手与 MCP 都从同一份能力声明与反射注册表投影，没有手写名单。

## 六、验证

- 渲染层 tsc（heavy.sh，`tsconfig.json`）、主进程 tsc（`tsconfig.electron.json`）：都通过（退出码 0）。
- eslint（本次改到的全部 ts 文件）：通过。`check:skill-sync`：通过。
- `check:assistant-capabilities:structure`：失败，只有一条，不是本次文件：“store 未建账且未登记原因：src/workspaces/GenerationWorkspace/hooks/resultSelection.ts”（生成工作区，11-11 的文件）。本次新增的能力、属性、执行器在这项检查与 applicationControlCoverage、属性/集合/账本覆盖测试里都没有报错。
- 精确测试 15 个文件 385 项通过（新增 `soundCheck.test.ts` 9 项、`audioEditSoundCheck.test.ts` 3 项，以及受影响的口播反射、快速处理、助手步骤、loudness.ffmpeg、效果线程、公共输出契约、工具目录、外部能力清单、属性/集合/结果/账本覆盖、applicationControlCoverage），另 `sound-check.ffmpeg.test.ts` 1 项（真实 FFmpeg）通过。断言内容：
  - 削波：接近满刻度的连续采样与超过满刻度的采样都识别、相距近的合一处、分块大小不影响结果；普通正弦、离满刻度有余量的平坦段不误报。
  - 纯 50 Hz 的电源频率占比接近 1、宽带噪声接近 0；安静处有 50 Hz 报 suspected，安静秒数不够为 unknown；底噪百分位与 rating。
  - BS.1770 门限积分；分段响度与 FFmpeg 只测该段的积分 ≤0.2 LU。
  - 位置换算：分析起点偏移加到全部位置上（剪后作品时间）；过长停顿按检测时长、结尾静音单列。
  - 细节按需：默认不给 windows、includeWindows 时给；关键段标注。
  - 差值：口播改过后同一范围再测才给 sinceLastCheck，没改过不给；读回前先落盘。
  - 回执：匹配响度带补偿后实测响度、真峰值、补偿前响度与 editedSeconds。
  - 重新定位：source_problem 读出主进程原因；写 source_path 调用同一核对服务、读回规范化后的新路径并保存；内容不同被拒绝时口播不变、错误原样给出。

## 七、待真实验证（这次做不了）

1. `npm run electron:bundle` 后启动开发版，打开一份已粗剪的口播。
2. 外部助手（MCP）或内置助手调用 `check_audio_edit_sound`，记录长口播（10 分钟、1 小时）的耗时；对照界面播放核对 longPauses、clipping 给出的剪后时间是否落在对应处。
3. 调 `match_audio_edit_loudness`（目标 -16），看回执 sound 是否在 -16±0.5、真峰值 ≤ -1；再调一次读回，sinceLastCheck 的响度差应与补偿量一致。
4. 在效果控件加基本声音的降噪或去嗡声后读回，看 noise.floorDbfs、hum 是否变化（要用停顿还没被清成静音的口播，否则 floorDbfs 为 null）；拿一段已知有电源嗡声的录音确认 suspected，拿干净录音看是否误报。
5. 把原素材移到别处，读 source_problem 应报找不到；写 source_path 为新位置后标题栏报错是否消失（界面只在 source.audioPath 变化时重新核对，若外部素材的 audioPath 不变，报错可能残留到重开，见第八节）。写一份内容不同的文件应被拒绝。

## 八、没做的与原因

- **按秒的逐段数组默认不给**：按要求只在 includeWindows 时给；逐秒（1 秒窗）可通过 windowSeconds=1 加 includeWindows 得到。
- **逐段真峰值**：ebur128 逐帧只打印累计采样峰值，逐段给的是采样峰值 dBFS；真峰值只给整体（与剪辑同口径）。要逐段真峰值需要每段各跑一次 FFmpeg，代价不值。
- **爆音（非削波的瞬态咔嗒）**：口水音检测已覆盖口腔咔嗒（`detect_audio_edit_mouth_clicks`）；这次只把削波类爆音并进读回，没有另做通用瞬态检测。
- **嗡声检测返回“可直接修复的范围”**：嗡声通常整段都有，修法是基本声音的 hum 修复（整段），所以只给频率、电平与占比，不给区间；底噪同理。
- **处理前测量跨重启保留**：sinceLastCheck 只在本次运行内（不改落盘格式）。
- **其他处理的回执不带响度**：除匹配响度外，各处理回执不为此再渲染整条成品（长口播要几十秒），只补了 editedSeconds。
- **界面残留（不在本次文件范围，交界面那位）**：`AudioEditApp.tsx` 的素材报错只在 `source.audioPath` 变化时重新核对；助手重新定位外部引用素材后若 audioPath 未变，标题栏“找不到原素材”可能要重开口播才消失。建议界面订阅素材路径（sourcePath）变化重新核对。

## 九、独立审查（1 轮）与处理

重要问题 2 条，都已修并补测试：

1. 匹配响度后的那次测量取消不掉（测量任务号是 `<请求号>:check`，取消只发了原请求号）。改为取消时一并取消 `:check`，开始测量前已取消就跳过。测试：匹配过程中取消，断言 `cancelTask('match-1:check')` 被调用且不再测量。
2. 回执里的测量顶替了“上一次读回”，导致“先读回 → 匹配响度 → 再读回”拿不到 sinceLastCheck。`checkAudioEditProjectSound` 加 `remember` 选项，回执那次传 false，不写进记录。测试：三步之后第三步 sinceLastCheck.integratedLufs = 6。

顺手改：
- 读回能力说明里“削波处可用 repair_audio_edit_region 的 declick”不准确（去爆音单段上限 128 毫秒，修不了成段削波；修复区域用原素材帧，读回给剪后秒）。改为先查输出音量与效果控件里加增益的项，并写明坐标不同。
- 补主进程测试：重新定位到内容不同的文件被拒绝（`media.test.ts`）。

重跑：soundCheck、audioEditSoundCheck（5 项）、media（10 项）、outputContract 共 296 项通过；两套 tsc（渲染层经 heavy.sh）与改到文件的 eslint 均通过。

## 十、已知问题（记录，不在本次修）

- 停顿都被清成静音的成品估不出底噪（floorDbfs 为 null、rating 为 unknown），这是如实返回，不是缺陷；要知道底噪得在清理呼吸与停顿之前读回，或读原素材还留着停顿的范围。这类成品的嗡声只靠几秒零碎的非语音帧判断，证据少。
- 录音时削过、之后整体衰减的平顶认不出来（实测：真削波样本整体降 6 dB 后报 0 处）。按“信号自身峰值处的平顶”去找（FFmpeg astats 的 Flat factor 思路）会把限幅后的成品报出来：那份匹配响度后的成品在自身峰值 0.1 dB 内有 78 个采样、5 串连续 3 个以上。
- 停顿判据与粗剪相同，也带着它的前提：说话占多数。大半是空白的长录音里第 80 百分位会落在底噪上，停顿会漏报。
- 读回与粗剪的停顿不是逐帧相同：粗剪在 16 kHz、按声道分开测，读回在成品采样率、混成单声道后测。原素材上实测门限同为 -62 dBFS，停顿 238 对 239 段，过长停顿 17 对 19 处（差的两处是 0.81 与 0.84 秒，卡在 0.8 秒线上）。
- 重新定位与其他属性同一次写入不是原子的：先重新定位并保存，其余属性写入若失败，重新定位不会回滚（素材本就不进撤销）。
- 匹配响度现在多一次成品渲染与测量（补偿改了输出，末尾效果要重跑），长口播会明显变慢。

## 十一、三处读数偏差的修正（2026-11-13，第五轮真实验证之后）

用的是第五轮那份口播（测试项目“主链路走查 11-13”的“口播走查-带重念”，16 位原素材 579.6 秒，剪后 370.25 秒）在缓存里的三份文件：原素材解码、补偿前成品、匹配响度到 -16 后的成品；另用原素材前 60 秒加 30 dB 做了真削波样本。只读分析，脚本在会话临时目录，没进仓库。

| | 改前 | 改后 | 查实的原因 |
|---|---|---|---|
| 匹配响度后的削波 | 146 处、1028 个采样 | 0 处 | 不是限幅器压出的平顶。原素材是 16 位，波峰波谷处本来就有 3–4 个量化值相同的相邻采样（补偿前成品里有 173 串，如 -854、-785 个量化单位）；加 23.1 dB（×14.29）后幅度过了 0.3 的门限，共 334 串，幅度 -10～-4 dBFS，没有一个采样到 -0.1 dBFS，采样峰值 -1.00 dBFS |
| 真削波样本（加 30 dB 后存 16 位） | 259 处、25414 个采样（含上面那类误报） | 96 处、23018 个采样 | 达到 -0.1 dBFS 的采样共 23516 个，连续 3 个以上的 2444 串 |
| 补偿前成品的过长停顿 | 28 处，“静音”合计 183 秒（一半时长） | 0 处，最长停顿 0.35 秒（正是粗剪保留的气口长度），合计 0.62 秒 | 固定 -40 dBFS 门限，而这段录音的 10 毫秒电平中位数是 -43 dBFS、第 80 百分位 -39 dBFS，一半的说话都在门限下。改后门限 -61.2 dBFS |
| 原素材的过长停顿 | 104 处 | 17 处（粗剪自己的检测 19 处） | 同上 |
| 补偿前成品的底噪 | -53.9 dBFS“听得到” | null、unknown | 成品里 18.7 秒是数字静音，非语音且不是数字静音的帧只有 3.1 秒，凑不出 2 秒完整的 50 毫秒片段；旧值是说话电平的第 10 百分位 |
| 匹配响度后成品的底噪 | -30.9 dBFS“明显” | null、unknown | 同上 |
| 原素材的底噪 | -67.9 dBFS | -72.4 dBFS（68.4 秒非语音） | 改为只在非语音片段里取中位数 |
| 嗡声（三份都是） | none | none（非语音秒的 50 Hz 族占比中位数 0.005–0.009） | 没有误报 |

判据的依据：

- 削波：Audacity“查找削波”是连续若干个（默认 3 个）达到满刻度的采样才算一处；这里把门限放在 -0.1 dBFS，并把超过满刻度的采样单独算上（浮点成品存成整数格式时一定被削）。FFmpeg astats 没有“削波采样数”，相近的是 Flat factor 与 Peak count，都是看信号自身最大最小值处的连续相同采样；iZotope RX De-clip 同样是在直方图上找峰值处堆起来的电平。两者都以“平顶在信号的峰值上”为前提，离峰值有余量的相同采样不算；而按自身峰值找又会把限幅后的成品报出来（见第十节），所以只认接近满刻度的。
- 停顿与语音 / 非语音：直接用粗剪的 `SpeechEnergyHistogram` 与 `SpeechEnergyValleys`，参数（22、16、-110）与 `speech-energy.ts` 相同，没有第二套标准；批量设置里的 noiseDb 不再用于读回。
- 底噪与嗡声：只取上面判为非语音、且高于 -90 dBFS 的帧；不足 2 秒返回估不出。

顺带修了一处：含有超过满刻度采样的一串里，前两个采样会被重复计数。读回消息在底噪或嗡声估不出时会说明，不再笼统说“没发现底噪问题”。

改动文件：`src/core/audioEdit/soundCheck.ts`、`src/core/audioEdit/soundCheck.test.ts`、`electron/main/services/audio-edit/pcm-jobs.ts`（两遍）、`electron/main/services/audio-edit/sound-check.ts`、`electron/main/services/audio-edit/sound-check.ffmpeg.test.ts`、`src/core/application-control/domains/audioEdit/audioEditSoundCheckCapability.ts`（说明）、`src/features/audioEdit/application/registerAudioEditCapabilityHandlers.ts`（消息）。契约：字段与类型都没变，只改了说明；`AudioEditSoundSummaryOptions` 去掉 silenceDb（内部）。

验证：两套 tsc 通过（渲染层经 heavy.sh）；改到文件的 eslint 通过；`soundCheck.test.ts` 12 项、`audioEditSoundCheck.test.ts` 5 项、`sound-check.ffmpeg.test.ts` 1 项、`outputContract.test.ts` 272 项通过。新增断言：量化重复值与压到 -1 dBFS 的峰不算削波；超过满刻度的采样每个只计一次；整体约 -40 dBFS 的录音里更轻的说话不算停顿；停顿都被静音掉时底噪与嗡声为估不出；嗡声只在非语音帧里累计、隔着说话拼起来仍同相。

还需真实窗口确认（要先 `electron:bundle`）：

1. 打开同一份口播，匹配响度到 -16 后读回：clipping.count 应为 0，issues 里没有削波。
2. 补偿前读回：longPauseCount 应为 0，silence.thresholdDbfs 在 -61 左右；308.45–310.18 秒不再出现在 longPauses 里。
3. 这份成品的 noise.floorDbfs 应为 null、rating 为 unknown，消息里写明估不出；换一份只去了重念、没清呼吸与停顿的口播，底噪应接近原素材（约 -72 dBFS）。
4. 读回现在读两遍成品，记录 370 秒与更长口播的耗时（此前 1.4–1.6 秒）。

