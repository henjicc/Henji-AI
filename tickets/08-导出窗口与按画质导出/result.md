A 段功能已实现：画质压制、完整编码快照、本机导出记忆、能力缓存与助手接口；未改任何界面。
10 秒 4K/60fps 实测：视觉无损 H.264 NVENC 为 VMAF 99.18 / 24.43 Mbps，软件回退为 99.00 / 28.14 Mbps。
全部 A 段验证通过，提交 2bcf94fe1（仅任务分支，未推送）；接口清单与证据见下方；未运行 Reality、未连接 9334。

## 开工判断与设计落实
- 典型输入为 1080p/4K、30/60 fps，工程支持到 8K；正式导出队列与 FFmpeg 压制都顺序执行。沿用 mediabunny/WebCodecs 合成、内置 FFmpeg 编码，不增加依赖或自研编解码。
- 唯一业务状态仍由现有导出设置、任务与队列维护；助手共用设置 schema 和正式导出执行器。预设已有 update，直接复用。
- NVIDIA two_pass 使用编码器内部 full-resolution multipass；x264/x265 使用真正的文件两遍分析，二者参数不可混用。依据 FFmpeg 编码器帮助与 NVIDIA 官方指南。
- NVIDIA 最新指南建议空间 AQ 与时间 AQ 二选一，因此模板默认只开空间 AQ，组合冲突明确报字段错误。
- 记忆采用版本化本机 JSON。设计的“例如 200 条”不是必要上限；按项目与序列覆盖保存，无条目数硬限制，避免静默丢失记忆。
- 取消与渲染页退出由主进程终止压制后清理临时目录，最终文件沿用独占登记与文件身份核对。成功发布后才写记忆，读取不改写原数据。
- 验证按 testing.md L2：跨进程契约、取消、文件 I/O 与持久格式；执行计划要求的精确测试、双 tsc、专项门禁及 FFmpeg 短片实测，不运行窗口验收。
- 压制进程复用仓库内置 FFmpeg，不加依赖。已有音频进程工具在 abort 时可早于子进程 close 返回，不能保证视频文件已解占用；本次视频进程执行器等待 close 后才结束取消，临时文件再清理。

## 实现范围
- `encoding` 可选，旧文件/旧预设缺字段时保持 WebCodecs/mediabunny 直接导出。新视频设置先按同格式生成高码率 MP4，再按 CQ/CRF 或目标码率压制，声音 `copy`、MP4 `faststart`。中间码率由像素与帧率计算，80–200 Mbps；1080p30 为 186.624 Mbps，4K60 为 200 Mbps。
- 编码支持 NVIDIA H.264/H.265、libx264/libx265；quality、VBR、CBR、两遍分析；GOP、B 帧、lookahead、AQ、Profile/Level、矩阵/范围、8/10 位。参数组合由同一 schema 校验。
- 内置视频预设默认视觉无损；高质量母版为 HEVC 80 Mbps；仅音频不变。未记录独立画质档，完整参数模板匹配得到档位，否则为 custom。
- 能力通过真实编码器初始化探测 8/10 位和 CUDA，并发共享结果、缓存至主进程结束；探测整体失败可以重试。所选高级编码器不支持时明确失败，选用预设/画质档时才允许同格式硬件与软件适配。
- 主进程按发送窗口与页面管理临时文件，压制串行；同目录 staging 成功后原子替换正式登记的占位文件，更新文件身份。失败、取消、页面离开、页面重载均经同一会话清理。排队取消无需等待其他页面的长任务，同时不会让后续任务越过前驱。
- 成功发布才保存本机记忆；失败/取消不覆盖；读取不写盘；损坏记录保持原样并报错，避免把损坏数据静默覆盖为空。记忆保存失败保留成片并给 notice/日志。
- 助手继续使用现有导出能力、设置实体和任务查询。新增 quality 意图参数（单项、批量），encoding 全字段经原设置 schema 可读写；任务查询包括两段进度。未新增专用 Agent 工具。

## 持久格式
| 格式 | 版本 | 最低读者 | 处理 |
| --- | --- | --- | --- |
| export-presets | 3 → 4 | 1 | 保留无 encoding 的旧快照，逐版本迁移 |
| document.video_edit | 45 → 46 | 45 | 可选 encoding，旧工程不注入新行为 |
| document.screen_recording | 48 → 49 | 48 | 录屏文档共用嵌入导出 schema，随之登记 |
| export-memory | 新增 1 | 1 | 本机版本化 JSON，不写进工程 |

已新增上述四个当前版本黄金样本，更新指纹基线和兼容快照，未修改任何已提交的历史黄金样本。内置模板校准完成后才固化本次新样本。

## VMAF 与体积
来源为《元宝搜索》已有高码率预览缓存，只读读取 `E:\文档\痕迹AI\.痕迹AI缓存\render`。缓存 profile 为 `v4:avc:standard:200`，取时间顺序中互不重叠的窗口拼成 10 秒参考；3840×2160、60fps，共 600 帧。参考文件 311,468,937 bytes，实际平均 249.18 Mbps（profile 的 200 是目标码率）。没有重新导出或修改工程。

使用内置 FFmpeg `n9.0.2-17-g2a571b6068`、libvmaf `vmaf_4k_v0.6.1`，完整 4K、每帧计算 mean。编码、指标解码均在 CUDA 可用时带 `-hwaccel cuda`，全部顺序执行。MB 按 1,000,000 bytes 计算；Mbps 为文件大小折算，包含容器开销。

| 编码器 / 档位 | 最终参数 | 10 秒大小 MB | 平均 Mbps | VMAF mean | 相对参考体积 |
| --- | --- | ---: | ---: | ---: | ---: |
| H.264 NVENC / 视觉无损 | CQ 28, p6 | 30.54 | 24.43 | 99.1850 | 9.80% |
| H.264 NVENC / 高 | CQ 32, p6 | 16.30 | 13.04 | 97.8669 | 5.23% |
| H.264 NVENC / 标准 | CQ 36, p6 | 10.29 | 8.23 | 95.0061 | 3.30% |
| H.264 NVENC / 指定码率 | VBR 50 Mbps, p6 | 66.83 | 53.46 | 99.6507 | 21.46% |
| libx264 / 视觉无损回退 | CRF 20, medium | 35.17 | 28.14 | 99.0037 | 11.29% |
| HEVC NVENC / 视觉无损 | CQ 28, p6 | 26.17 | 20.94 | 99.2151 | 8.40% |
| libx265 / 视觉无损回退 | CRF 20, medium | 20.69 | 16.55 | 98.9602 | 6.64% |

视觉无损四种编码均超过 VMAF 95，平均码率明显低于 50 Mbps。模板最终 NVENC CQ 28/32/36、软件 CRF 20/24/28；各档完整实测为 H.264 NVENC，软件和 HEVC 补测视觉无损回退。软件高/标准与 HEVC 高/标准未另跑矩阵。短片结果是本片段的证据，不保证任何内容的固定体积；指定码率是 VBR，不是文件大小上限。

初始 CQ 16/20/24 的平均码率分别为 115.63/73.34/44.38 Mbps，视觉无损不满足体积目标，故未采用。临时参考、源清单、编码文件和逐帧 VMAF JSON 均位于本 worktree 忽略的 `.tmp/t08/`；`calibration-final.json` 为最终画质数据，`calibration.json` 含初始探索及 50 Mbps 对照。

## B 段界面接口
| 用途 | 文件 / 接口 | 调用约定 |
| --- | --- | --- |
| 参数 schema 与类型 | `src/core/videoEdit/exportEncoding.ts` 的 `videoEditExportEncodingSchema`、`VideoEditExportEncoding`、`VideoEditExportCapabilities`；`exportPresets.ts` 的 settings schema | encoding 为可选完整对象；无需另存 tier |
| 选择画质 | `applyVideoEditExportQuality(settings, tier, capabilities)`（也由 `exportPresets.ts` 导出） | 返回新 settings；按 codec 优先 NVENC、否则同格式软件；指定码率从 settings.videoBitrateMbps 取值 |
| 显示档位 | `videoEditExportQualityOf(settings)` | 返回四档或 custom，完整 encoding 与模板比较 |
| 高级修改计数 | `videoEditExportChangedFields(settings, preset)` | 返回 `keyof VideoEditExportEncoding` 列表；逐项恢复用基线 `preset.settings.encoding[field]` |
| 预设“已修改” | `videoEditExportPresetModified(settings, preset)` | 全设置规范化深比较；基线必须先与当前值经过相同的序列解析和设备适配，不能把原始 builtin 快照直接与 NVENC 解析结果比较 |
| 序列解析与适配 | `resolveVideoEditExportSettings`、`videoEditSequenceExportSettings`；engine `adaptVideoEditExportPreset` | 与序列一致使用 sequence helper；其他预设先 resolve 再 adapt；同一结果既作为编辑初值，也作为比较/恢复基线，不在每次用户编辑后重建基线 |
| 本机预设库 | application `videoEditExportPresets.ts` 的 `videoEditExportPresetLibrary.list/custom/save/update/remove` | 原有 update 已支持 `{ settings }` 与 `{ name }`，更新当前只用于自建预设；内置保持只读 |
| 可用编码器 | `getPlatform().videoEditExport.capabilities()` | 异步，主进程缓存；返回 cuda 和四个 encoder 的 supported/tenBit/reason。字段组合仍按 schema 限制；用既有 probe/assert 检查完整输出规格 |
| 读取上次导出 | application `videoEditExportMemory.ts` 的 `videoEditExportMemory.read(projectId, sequenceId)` | projectId 沿现有导出约定是剪辑文档 ID；返回 undefined 时用“与序列一致”；read 失败走正式错误提示，不覆盖数据 |
| 记忆内容 | `VideoEditExportMemoryEntry` | presetId/settings/directory/fileName/range/rangeSource/completedAt；预设被删时仍能用完整 settings 作为自定义值；具体窗口恢复由 B 段消费 |
| 发起导出 | `enqueueVideoEditExports(requests, signal?)` | 沿现有入口；支持 presetId、settings、quality（四档）、range、path。保留所选 presetId 时与 settings 一起传；设置已在面板确定时无需再传 quality |
| 两段进度与取消 | `VideoEditExportTask.phase/compositionProgress/compressionProgress`；队列 `job.task`；既有取消入口 | phase 为 composition/compression；两段均 0–1，总进度合成占 80%、压制占 20%；旧直出仅合成阶段；UI 自行映射用户文案 |
| 主进程压制平台 | `prepareCompression/compress/compressionProgress/cancelCompression` | 正式导出管线内部调用，B 段不应另写 FFmpeg 路径；同页所有权经 preload 固定传递 |

`videoEditExportEstimatedBytes` 仍为目标码率估算；quality 模式是内容自适应码率，不应在 B 段把该值呈现为精确预期大小。8/10 位探测不是 HDR 承诺：中间渲染仍为既有画面精度，10 位不会凭空恢复源色彩信息。

## 验证与审查
- 按 testing.md L2 执行，显式列出本次 42 个文件；不扫描其他任务改动。新增 `*.ffmpeg.test.ts` 已归入唯一 FFmpeg CLI 专项清单，普通单测不隐式执行真实 FFmpeg。
- 真实 FFmpeg 10 秒测试覆盖 libx264 画质压制、libx265 文件两遍分析、可用 NVENC、AAC 复制、时长与视频 codec、原子发布、运行中取消及中间目录/未发布成片清理。
- 公共助手/队列集成测试只替换进程边界：quality 经正式导出执行器进入 compression，双段进度可查询，成功前不写记忆，成功保存实际设置和范围，取消不写记忆且清理输出。不是实际 GPU 画面合成/窗口验收。
- 核查根因范围：共用队列、直接导出、IPC 页面退出/恢复、串行等待、文件身份账本、音频直出、旧预设与旧工程、共享录屏嵌入 schema、助手读写查询。两轮独立只读审查；第一轮发现 1 项重要问题（排队取消等待前驱），已修复并增加定向回归；第二轮未发现新问题。比较基线小问题通过接口契约与本表明确。
- `npm run verify:changed -- --level L2 <本次 42 个显式文件> --test <直接消费者测试...>`：通过。命令完整文件清单在本 worktree `.tmp/t08/verify.ps1`，结果在 `.tmp/t08/verify-final.log`。精确 Node 7 项、Vitest 12 文件 349 项通过；本次文件 ESLint、渲染层/主进程双 tsc、依赖图、主进程传递导入、IPC 对账、持久基线均通过。
- `npm run check:persistence-compat`：65 种格式通过，`.tmp/t08/persistence-final.log`。
- `npm run check:assistant-capabilities`：结构检查及应用能力覆盖通过，31 文件 237 项通过，`.tmp/t08/assistant-final.log`。
- 真实 FFmpeg 专项在上述精确测试中实际执行，1 项通过，9.62 秒；排队取消的普通定向测试另 1 项通过。
- 最终提交：`2bcf94fe1` — `feat(video-edit): 新增按画质压制与本机导出记忆`，42 文件。提交后核对工作树干净；按用户要求不 push、不 merge、不切分支、不维护 9334 实例。

## 边界与交付
- 无 UI `.tsx` 组件修改；唯一 `.tsx` 改动是既有队列测试夹具和新增技术集成用例。
- 未运行 Reality、未启动/连接/导出于 9334，未触碰用户工程文件；Windows 本机实测，未做其他 GPU/操作系统矩阵。
- 本 worktree 缺内置 FFmpeg 时，只在本 worktree 的忽略目录建立只读消费用途的目录联接，指向主仓库已有随包 FFmpeg；未改主仓库文件。node_modules 联接未删除、未重装。
- 仅在 `task/08-导出窗口与按画质导出` 提交；不 push、不 merge、不改 main。B 段可直接在同一 worktree 接续。

## 官方依据
- https://ffmpeg.org/ffmpeg-codecs.html
- https://ffmpeg.org/ffmpeg.html
- https://docs.nvidia.com/video-technologies/video-codec-sdk/13.1/ffmpeg-with-nvidia-gpu/
- https://docs.nvidia.com/video-technologies/video-codec-sdk/13.1/nvenc-video-encoder-api-prog-guide/index.html

## B 段（界面，Opus 子代理，63a7c01a9）
- 新增 VideoEditExportPresetMenu（预设下拉 + 底部竖排操作）、VideoEditExportEncodingFields（高级分组、灰掉原因、逐项恢复）、videoEditExportUi（参数连带、画质档文案、两段进度）；改 Dialog/Fields/Progress/QueueList 与队列测试。L1（含 check:surface 严格、colors、icons、ui-residue、ui-design）与 52 项队列测试通过。
- 与设计的偏离（Claude 认可）：高级分组 7 并 5（码率控制与画质码率合并、10 位并入色彩）；Profile/Level 标为“规格/级别”；选目录时由队列取不重名文件名；“入点到出点”记为范围来源；按画质压制不显示预计大小、摘要写档名；仅音频切回视频自动套视觉无损；无 encoding 的旧预设显示“自定义”、原参数进高级。
- A 段接口缺口：记忆存的是落盘文件名（界面靠正则去 “ (N)”），应在 remember 处传请求文件名；任务开始前无“是否有压制段”字段（靠 settings.encoding 判断）；两套 Reality 脚本的确认导出步骤断言预设为“与序列一致”，有上次记忆时会挂。
- 交叉审查：A 段 Opus xhigh、B 段 Codex 只读审查进行中；视觉由 Claude 合并后在开发版目视验收。

## A 段修复 1

续接 11e4afba9 上的未提交修改；开工实际为 32 个 tracked 修改和 1 个新增测试，已在其基础上继续。只修改本 worktree 和本 result，未切分支、未合并、未 push，未启动或连接 Electron/9334，未运行 Reality、GPU/Dawn/基准/NVENC 探测，未触碰用户工程、node_modules 联接或 FFmpeg 联接。唯一 .tsx 改动为既有队列测试，未改 .tsx 界面。

### 13 条处理结果

| 条目 | 处理与边界 |
| --- | --- |
| 1 | NVENC 初始化探测使用 256×256；普通单测断言实际传入的尺寸。硬件专项支持 HENJI_EXPORT_REQUIRE_NVENC=1，明确断言 H.264/HEVC NVENC 可用且两个分支都执行，不能静默跳过。真机部分待显卡恢复。 |
| 2 | 指定码率移除 encoding，qualityOf(无 encoding) 返回 bitrate；母版保持无 encoding 的 WebCodecs 直出。三种画质模板才走压制；自定义高级压制仍可用 VBR/CBR/两遍。发送到画布复用母版路径，无额外 FFmpeg 依赖。 |
| 3 | 请求、队列、恢复数据和直接导出 options 共用显式 rememberExport，只有 true 且成功完成才写记忆；助手/内部导出默认不写。窗口尚需传 true，按禁止修改 .tsx 界面的约束留给界面跟进。 |
| 4 | 临时目录 rm 使用重试，失败只写正式日志，不能让已发布成片变失败；registry 原子替换复用 renameWithRetry 的 EPERM/EBUSY/EACCES 重试。回归覆盖发布后清理失败，既有原子发布测试覆盖重试。 |
| 5 | AVC/HEVC 级别分别枚举，HEVC 拒绝 3.2/4.2；公共 patch 和界面纯逻辑 helper 在切换格式时把非法级别设为 auto。下拉菜单还需按 codec 使用枚举。 |
| 6 | 缓冲为 0 时，按实际最大码率的两倍设置 VBV；CBR 按目标码率计算。schema 说明与参数生成一致。 |
| 7 | 删除 encoding.bitrateMbps，FFmpeg 的 VBR/CBR/两遍、IPC 和渲染层只传顶层 videoBitrateMbps。历史字段经正式迁移读取，保留原实际压制码率，包含 0.05/300 Mbps 等旧合法值；不截断。界面旧字段引用待跟进。 |
| 8 | 中间编码独立于最终编码，按完整规格探测 H.264 优先、不支持才 HEVC；无 encoding 时保持原直出。测试覆盖 HEVC 成片使用 AVC 中间文件和超大画幅的 HEVC 回退。真实 WebCodecs 设备路径未在暂停期间验证。 |
| 9 | FFmpeg 探测只保留成功或明确不支持结论；忙、超时和未知初始化失败允许重新探测。能力原因和压制失败带实际 FFmpeg 摘要；单测验证忙后恢复，未做真机 NVENC 探测。 |
| 10 | 记忆未知字段按 projectId+sequenceId 恢复；共享数组优先独立 id，避免同项目同序列多条有 id 的记录串位。覆盖插入、重排与替换，无条目数上限。 |
| 11 | 响度预读同步 compositionProgress，并对压制任务按 0.8 折算总进度；正式队列测试在响度测量边界验证 0.1 / 0.08。 |
| 12 | 合成开始前清理同目录非活动残留并按中间文件估算检查可用磁盘空间，不足时报告预计/可用 GB。临时目录携带 PID，模块共享活动目录，跳过存活外进程；覆盖旧残留、活动任务、双服务、存活/已退出 PID 和空间不足不开始合成。 |
| 13 | 删除无调用的 watchVideoEditExportSender，测试走真实 IPC 注册后的 render-process-gone/destroyed 清理和恢复屏障；单次导出等待登记完成，拒绝登记不写文件。去掉 NVENC 空间/时间 AQ 互斥，默认仍只开空间 AQ；双 AQ 真机编码待跑。 |

### 持久兼容

先前未完成修改改写了受保护历史指纹与样本，check:persistence-compat 明确拒绝；本次保留所有历史版本/样本，只追加以下新版本和纯迁移：document.video_edit 46→47（最低读者 47）、document.screen_recording 49→50（最低读者 50）、export-presets 4→5（最低读者 5）、export-memory 2→3（最低读者 3）。删除旧程序依赖的字段，故提高最低读者。使用正式生成器增加当前样本，未修改受保护的历史样本；发布快照只追加。迁移覆盖预设、记忆、剪辑导出历史和录制基线中的剪辑历史，保留无 encoding 的旧直出。旧高级 VBR/CBR/两遍保持原压制行为，不把已保存的高级设置静默改成 WebCodecs。

### 需要界面跟进的点（本次未改 .tsx 界面）

- VideoEditExportDialog.tsx 的 enqueueVideoEditExports 请求传 rememberExport: true；该意图已贯穿队列恢复和重试。否则窗口导出不写上次记忆。
- VideoEditExportFields.tsx:55 的“指定码率”输入必须在没有 encoding 时也显示，只读写 videoBitrateMbps；:59 删除高级设置到顶层的双码率同步。
- VideoEditExportEncodingFields.tsx:71 的“目标码率”行改用顶层 videoBitrateMbps，不能写 encoding.bitrateMbps；VideoEditExportDialog.tsx:243 摘要同样读顶层。迁移后的旧码率可能超出 0.1–200，界面不要在恢复/保存时静默截断。
- Level 下拉按 videoEditExportLevels(codec) 取项；缓冲为 0 的悬停说明与 schema 一致；去掉任何 AQ 互斥呈现；指定码率档不依赖 FFmpeg 能力查询，切入/恢复时使用新无 encoding 语义。
- 渲染层 tsc 仍有 9 条错误，全部位于上述 3 个旧字段消费文件；未添加兼容假字段或屏蔽类型错误。完整队列测试中“重新打开恢复上次导出的预设改动与文件名；恢复为预设回到预设基线”仍失败（期望 output.mp4，实际序列 1.mp4），根因是窗口未传 rememberExport。

### 验证与限制

按 testing.md L2 的共享契约、文件 I/O、异步状态与持久格式风险执行等价的精确测试、显式文件 ESLint、双 tsc 和对应专项；未执行会扩展到 GPU 的自动测试选择。

- 精确普通单测最终 13 文件 157 项通过，1 项上述界面依赖用例在复验命令中以 testNamePattern 排除；完整队列单独运行已记录为 55 项通过、1 项失败，没有删除测试或永久 skip。命令包括 IPC、compression、ffmpeg、jobRegistry、exportEncoding、exportEncodingMigration、exportPresets、forwardCompat、ExportEncoder/Config、Memory、Queue 和既有 atomic-file 测试；日志 .tmp/t08a-unit-final.log。
- 前向兼容最后增量单独 7 项通过，日志 .tmp/t08a-forward.log；历史迁移覆盖全部 5 份受影响已登记旧样本及 0.05/300 Mbps。
- CPU FFmpeg 专项通过，1 秒 640×360、libx264 画质压制、libx265 真两遍、声音复制、发布和取消；CPU_ONLY 分支不调用能力探测，注入 cuda=false，FFmpeg 参数不加硬件加速。日志 .tmp/t08a-ffmpeg-cpu.log。
- 本次 TS/测试文件 ESLint 通过（初轮两处测试 console 已改成标准输出并定向复验）；日志 .tmp/t08a-lint-recheck.log、.tmp/t08a-lint-test.log、.tmp/t08a-lint-forward.log。
- 主进程 tsc 通过，.tmp/t08a-tsc-electron.log。渲染层 tsc 未通过，9 条界面字段错误，.tmp/t08a-tsc-renderer-final.log。因此不能声称双 tsc 或 L2 整体验收通过；需要界面跟进后补齐。
- check:persistence-compat 通过（65 种格式），.tmp/t08a-persistence.log；check:dependency-graph、check:main-imports、check:ipc-contract 通过，对应 .tmp/t08a-dependency.log、t08a-imports.log、t08a-ipc.log。
- 独立只读审查三轮：第一轮 1 项重要问题（旧合法码率迁移被顶层范围拒绝）已修复并补边界测试；第二轮 1 项小问题（新增测试缺 options 必需字段）已修复；第三轮仅核对该修复及 ID 优先增量，无新问题。审查未运行任何程序。
- 实际排查范围包括共用预设/直出/画质压制、队列/直接导出/重试恢复、IPC 页面离开、原子发布/清理、前向字段身份与嵌入录制迁移；检查后未发现其他确定同源缺陷。真实 WebCodecs/NVENC、窗口交互和 GPU 画面不在本次通过结论内。

### 待显卡恢复后跑

在本 worktree、确认 GPU 已可用后再执行；以下命令本轮没有运行：

```powershell
Remove-Item Env:HENJI_EXPORT_CPU_ONLY -ErrorAction SilentlyContinue
$env:HENJI_EXPORT_REQUIRE_NVENC = '1'
npx vitest run --mode ffmpeg-cli electron/main/services/video-edit-export/compression.ffmpeg.test.ts --maxWorkers 1 --minWorkers 1
Remove-Item Env:HENJI_EXPORT_REQUIRE_NVENC -ErrorAction SilentlyContinue
```

这条专项会真实初始化 H.264/HEVC NVENC、检查 256×256 探测是否可用，并实际执行两个 NVENC 编码分支及空间+时间 AQ 同开；没有可用 NVENC 会失败而非跳过。运行时按已有 CUDA 能力决定解码加速。

界面修复后重跑（纯 CPU 验证，不必等待显卡）：

```powershell
npx vitest run --mode unit src/features/videoEdit/application/videoEditExportQueue.test.tsx --maxWorkers 1 --minWorkers 1
$env:NODE_OPTIONS = '--max-old-space-size=12288'
npx tsc -p tsconfig.json --noEmit
```

最终回报：
- check:assistant-capabilities 全命令通过，包含结构检查、覆盖检查和 31 文件 237 项不变量测试；日志 .tmp/t08a-assistant-final.log。最终主进程 tsc 再验通过。
- 修复提交：e28b0fc5b — fix(video-edit): 修复导出压制、记忆与临时文件生命周期（43 文件），仅在 task/08-导出窗口与按画质导出；提交正文已写明 NVENC 真机测试待跑、界面 tsc/记忆用例未闭环。未 push、未合并。
- 提交后本 worktree 工作区干净。完成状态为“A 段允许范围内已修复并提交；界面跟进与 GPU 恢复后验收待完成”，不报告双 tsc / L2 全通过。

## A 段修复 2

续接 `5c9829505`，修复 review.md 末尾 `/code-review` 的第 1–10 条技术部分。提交：`55b1d6ea5` — `fix(video-edit): 修复导出能力回退与持久兼容声明`，33 个文件。仅在 `task/08-导出窗口与按画质导出` 追加提交，未 push、未合并、未切分支；本 worktree 已恢复干净。主工作区仅追加本 result，未修改 .tsx、用户工程、node_modules 联接或 FFmpeg 联接。

### 10 条处理结果

| 条目 | 处理与实际边界 |
| --- | --- |
| 1 | 画质模板按输出宽和高选择编码器：H.264 NVENC 最大 4096、HEVC NVENC 最大 8192，超出时回退同格式 x264/x265；严格提交预检也复用尺寸判断，显式超限 NVENC 在合成前拒绝。测试覆盖横竖屏、上限与超限。未做真机 NVENC。 |
| 2 | 预设适配显式捕获 FFmpeg 能力查询异常，移除 encoding，复用 videoEditSequenceExportSettings 的默认码率规则走 WebCodecs 直出；同次连续故障只通知一次并保留正式日志，探测恢复后允许下一次故障再通知。自定义编码预设也能回退；显式 settings 的严格校验仍按原约定处理，不静默替换。共享入口覆盖默认队列、直接导出、助手无 settings 及窗口预设适配。 |
| 3 | 空间需求按中间文件估算 × 1.25 + 1 GB；即中间文件 + 按四分之一估算的成片 + 1 GB 余量。测试证明 4 GB 中间文件需要 6 GB，空间恰好满足时可开始准备。 |
| 4 | export-memory 条目新增可选 loudnessRequested，成功导出写入请求时的布尔值，显式 false 不被预设推断覆盖；缺省保持旧行为。黄金样本覆盖 false，记忆重开测试覆盖 true/false/缺省。恢复 UI 一行按分工留给 Claude。 |
| 5 | 新页面的登记、准备、压制及其余导出 IPC 都先等旧清理屏障；退出事件立即调用 release 捕获当时已存在的会话，避免延迟匹配新会话。准备跨越崩溃边界时按页面代次取消晚到会话。真实 IPC 注册测试覆盖清理未完成期间的新 register/prepareCompression/compress 和旧 prepare 晚完成。 |
| 6 | 输出 BT.709 保持原标签；BT.601 的原色和传递函数均为 smpte170m；BT.2020 的原色为 bt2020、传递为 bt2020-10。参数测试覆盖三种矩阵。 |
| 7 | unknown device type 归为确定不支持并缓存，避免无 CUDA 平台不断重试；忙、超时等临时故障仍可重探。测试使用替身，不初始化 CUDA。 |
| 8 | 编码器探测并行，连同 CUDA 检查最多四个子进程；每个编码器的 8/10 位初始化依次执行。替身测试证明实际并发达到 4 且不超出，成功/确定失败缓存与合并并发保持有效。 |
| 9 | 对照分支起点 05c5d683a 的 releasedCompatibility.json，恢复真正已发布的最低可读版本；本分支中间版本、迁移与黄金样本整理为下表。已发布的 589 项 versions/readers/samples 承诺及历史样本哈希全部保留。 |
| 10 | schema 拒绝 NVENC quality < 1，软件 CRF 0 仍合法；切换硬件编码的纯逻辑 helper 同步下限，初版记忆里的 NVENC 0 迁为 1。界面输入 min 写死在 .tsx，按分工列在下方交 Claude，未越界修改。 |

### 第 9 条：版本与最低可读版本前后对比

| 格式 | 分支起点已发布版本 / 最低可读 | 本轮开始版本 / 最低可读 | 本轮整理后版本 / 最低可读 |
| --- | --- | --- | --- |
| document.video_edit | 45 / 45 | 47 / 47 | 46 / 45 |
| document.screen_recording | 48 / 48 | 50 / 50 | 49 / 48 |
| export-presets | 3 / 1 | 5 / 5 | 4 / 1 |
| export-memory | 尚未发布 | 3 / 3 | 2 / 1 |

剪辑 45→46、录屏 48→49、预设 3→4 都只新增可选 encoding，旧内容原样迁移，最低可读保持 45/48/1。导出记忆按用户明确要求保留 v2，新增可选 loudnessRequested 与 requestedFileName，最低可读保持 1；v1 黄金样本与精确迁移仍保留，迁移兼容初版重复码率、HEVC 非法 level 和 NVENC CQ 0。删除仅本分支未发布的 v47/v50/v5/v3 样本及中间迁移，当前样本由正式生成器重建；没有改写分支起点的已发布样本，也没有修改门禁脚本。

本轮提交前检查显式使用 `HENJI_PERSISTENCE_RELEASE_REF=05c5d683a`，防止将分支内误登记的未发布快照当成发布承诺；提交后去掉该变量，再运行普通 `npm run check:persistence-compat`，同样通过（65 种格式）。

### Claude 需要跟进的 .tsx 两处

- `src/features/videoEdit/panels/VideoEditExportDialog.tsx:117`：初始化响度请求时优先读取 `memory.loudnessRequested ?? presetRequestsLoudness(memory.presetId, memory.settings)`，必须使用 `??` 保留显式 false。
- `src/features/videoEdit/panels/VideoEditExportEncodingFields.tsx:73`：“画质数值”的输入范围仍为 `{ min: 0, max: 51 }`，请改为 `{ min: nvenc ? 1 : 0, max: 51 }`。schema 和非 .tsx 的关联调整已完成。

### 验证、排查范围与审查

本轮按 testing.md L2 的共享契约、持久迁移、文件 I/O、异步取消/恢复风险验证，未升级到应用或 GPU 验收。

- `npm run verify:changed -- --level L2 <本次 33 个显式文件> --test <直接消费者>` 全部通过：14 文件 385 项、精确文件 ESLint、渲染层/主进程双 tsc、依赖图、主进程传递导入、IPC 对账、持久基线。完整显式命令清单为本 worktree `.tmp/t08a2-verify.ps1`，dry-run 先核对无 GPU/FFmpeg 专项；结果 `.tmp/t08a2-verify.log`。
- `check:persistence-compat`：提交前对照真实发布基线通过，`.tmp/t08a2-persistence.log`；提交后不带基线覆盖变量的普通命令再次通过，`.tmp/t08a2-persistence-head.log`，均为 65 种格式。
- `check:assistant-capabilities` 全命令通过：结构、覆盖及 31 文件 237 项不变量，`.tmp/t08a2-assistant.log`。本轮修复共享导出入口与已有 schema，不新增同义助手工具，也不改变既有能力覆盖结论。
- 真实 CPU FFmpeg 专项通过：`HENJI_EXPORT_CPU_ONLY=1`，`compression.ffmpeg.test.ts`，`--mode ffmpeg-cli --maxWorkers 1 --minWorkers 1`，1 秒 640×360；实际执行 libx264 与 libx265（两遍）、声音复制、发布和取消清理。全程 cuda=false，不调用硬件探测，`.tmp/t08a2-ffmpeg-cpu.log`。
- 实际排查范围：共用画质模板与严格提交、窗口/队列/直接导出/助手默认预设、IPC 页面退出与恢复及晚到准备、磁盘估算、FFmpeg 色彩参数、编码器缓存/并发、记忆写入/重开、剪辑导出历史与录屏嵌入历史、发布快照和黄金样本。上述已修复路径由精确测试与静态检查覆盖；检查后未发现其他确定同源缺陷。未验证真实 WebCodecs 设备、窗口视觉、macOS 真机和 NVENC 硬件行为。
- 独立只读审查 1 轮：未发现新增重要问题或小问题；确认响度恢复 UI 属于明确留给 Claude 的范围，并确认 05c5d683a 的已发布承诺未被改写。

### 待显卡恢复后跑

本轮未运行 NVENC 探测/编码、`-hwaccel cuda`、test:gpu、任何 *.gpu.test.ts、Electron/开发版或 Reality。沿用上节已列的 `HENJI_EXPORT_REQUIRE_NVENC=1` 真机专项，显卡恢复后再验证 H.264/HEVC NVENC 初始化与编码、双 AQ；另需核对尺寸回退在真实设备上的提交行为。提交正文已明确写入“NVENC 真机测试待显卡恢复后跑”。
