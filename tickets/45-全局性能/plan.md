摘要：2026-11-12 用户要求把全软件性能彻底完善，内存显存预算参照成熟商业软件放开。
排查结果在同目录四份“排查-*.md”，共 38 条；本文件是分批计划与状态，主会话维护。
所有执行者共用主工作区、按文件划分所有权、不碰 git 暂存区；主会话审查、真实窗口验收、提交。

# 通用约束（每个执行者都要遵守）
- 只改分给自己的文件；需要改别的文件就在回报里说明，不要动手。
- 不执行 git add / commit / stash / checkout / restore / reset；不启动 Electron、开发服务器、electron:bundle/build。
- 重命令（tsc、vitest、cargo、eslint 多文件）一律 `bash tickets/45-全局性能/heavy.sh <命令>` 排队；vitest 只跑列出的具体测试文件。
- tsc 报错出在不属于自己的文件上时不要修，等一会儿重跑（别的执行者正在改）。
- 预算原则：只当缓存淘汰目标和降画质阈值，不当准入门槛；数值按机器能力取；放开就删掉旧的拒绝分支，不留替代机制。
- 测试：只为修掉的真实缺陷和稳定契约写一两条；因正常改动变红的旧断言，先问它保护什么，钉死旧上限的就改或删。
- 结果写 `tickets/45-全局性能/result-<任务号>.md`（开头 3 行摘要），回复按：状态／改动文件／验证／偏离／遗留，≤15 行。

# 第一批（并行）
| 任务 | 内容（见排查文件对应编号） | 文件所有权 | 模型 | 状态 |
|---|---|---|---|---|
| W1-A | 图-3 图-4 图-5 图-7：导出预算、内存总账、点选缓存、小缓存 | `src/core/imageEdit/v3/resourceBudget.ts`、`src/features/imageEdit/v3/execution/**`（除 GpuBridge）、`export/**`、`editor/useImageEditorLayerPickingV3.ts`、`gpu/imageEditorGpuSceneExportRuntimeV3.ts`、`gpu/imageEditorGpuSceneTileAdmissionV3.ts`、`tools/**`、`panels/thumbnails.ts` | 中 | 进行中 |
| W1-B | 剪辑 1：解码会话与显存预算 | `native/video-decoder/**`、`electron/main/services/video-decoder/**`、`videoEditNativeFrameSource.ts`、`videoEditNativeFailure.ts` | 超高 | 进行中 |
| W1-C | 画布 P2 P4 P5 P6 P7 P8 | `src/features/canvas/**`、`src/features/application-control/useApplicationHost.ts`、`electron/main/services/documents/**`、`src/features/documents/documentSessionRegistry.ts`、缩略图相关主进程服务与 `src/platform` 契约 | 中 | 进行中 |
| W1-D | 音频 A3 A4 A5 C1：超时、排队、硬上限、缓存预算 | `electron/main/services/audio/**`（除 preview.ts、render.ts、project-store.ts、pcm-wav.ts、splice.ts）、`audio-separation/runtime.ts`、`native/audio-worker/**`、`src/features/audioEdit/**/spectralTiles.ts`、`waveformDataService.ts`、`media-import/concurrency.ts` | 中 | 进行中 |

# 第二批
- W2-A 图-1 图-2 图-6：GPU 出错不整条退回、渲染线程预热（超高）
- W2-B 剪辑 3 5 6 10 11：图片、文字、代码素材预算与帧缓存索引（中）
- W2-C 剪辑 2 9：首帧、字体重复扫描、节目会话保留（中）
- W2-D 音频 B2 B3 B6：试听取块、每次编辑的整份序列化、主进程搬运 PCM（中）
- W2-E 通用 P1：启动时重复复核账本（超高，持久格式，必须审查）

# 第三批
- 剪辑 7 导出流水线（超高）、剪辑 4 多机位（超高）、剪辑 8 代理硬解与排队（中）
- 音频 A1 A2 局部改动增量重算（超高）、B1 B4 指纹与导入（超高，持久格式）

# 暂不做与原因
- 修 CI：main 上已红的 19 个测试文件与界面规则检查，另一个会话在处理（提交 db9cb746b 登记了进展），不重复。
- 通用 P3 媒体回收：另一个会话正在做 tickets/44-媒体回收后台化，避免冲突，等它落地再看。
- 音频 B5 转写上传格式：验证要真实付费转写对比，等用户同意。
- 剪辑“导入时默认自动建代理”：会占磁盘，商业软件默认也不自动建，保持默认关，只把生成做快、超并发排队。

# 进度（主会话维护，2026-11-12 晚）
- 已提交并推送（14 项）：图片 GPU 预览不退回 CPU（07b2510db）、W1-C 画布与通用、W1-A 图片预算、W1-D 音频上限与缓存、W2-D 音频试听与编辑开销、W1-B 剪辑解码预算、W2-C 首帧/字体/会话复用、W2-E 账本复核、W3-B 代理与缩略帧硬解、W2-B 剪辑 GPU 预算、W3-A 音频增量重算、窗口自恢复（界面进程退出后自动重载）、W2-A 图片 GPU 韧性与预热、W3-C 导出流水线。
- 实施中：W3-D 音频指纹与导入、补录拼接（持久格式，提交前必审）；W3-E 多机位视图。
- 已做的真实窗口实测：启动时账本核对 0 次读取、字体扫描 1 次；剪辑打开首帧 6.9s（原记录 15.8s）、播放 178 帧 0 丢帧；图片点开到首帧 0.46–0.72s（原 1.4–1.9s）、带调色层输入到呈现 2–6ms；1080p30 600 帧导出 14.4s、拷贝 16ms、成片 ffprobe 核对无误。
- 未做的真实窗口验收：各 result 文件里“需主会话验证”的其余步骤——一小时音频素材（增量重算、试听首块、频谱续算）、超大图拼贴与 40 条字幕同屏、8 轨 4K 加多机位、代理开启后的拖动、4K60 导出前后对比、HEVC 导出、画布大工程拉远。
- 暂不做：媒体回收（另一会话在做）、修 CI（另一会话在做）、转写上传格式（需付费验证）、导入时默认自动建代理、P8 记住读不了的旧文档。
