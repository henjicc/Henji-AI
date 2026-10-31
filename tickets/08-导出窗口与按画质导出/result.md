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
