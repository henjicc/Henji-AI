# t121-perf 大图保存性能

状态：**保存路径修复与测量已完成；整体性能目标未达成，不能验收为完成。** 4K ≤2 秒、8K ≤5 秒仍需优化完整 CPU 合成后备。已请求总管理者确认是否扩展到渲染执行器，当前没有扩展授权，未改历史、命令总线或面板。

## 范围与证据

- 在 main 共享工作区修改；未执行 Git 写操作、未修改 SDK、未启动/重启开发实例、未运行 Reality、未调用付费服务。
- 历史 117 秒是画布关闭后生成 **全尺寸栅格投影**，不是单文件包写入。`.reality/t119-A3-broad18.log` 记录 `117641ms`；`scripts/lib/uiInspectionSceneCatalogGpuRaster.cjs` 在五层 8192 场景注入 GPU 恢复失败后调用 `closeLargeCpuFallbackDocument`。
- 执行过 `npm run logs:query -- --date 2026-10-09 --domain main.image_editor_v3 --tail 8`，以及 render completed / session started 的事件查询。默认日志目录没有这次隔离 Reality 的完整 8K 链路，不伪造历史各阶段数字。
- 本机：Windows / Ryzen 9 5900X（12 核、24 逻辑处理器）；真实文件位于 `os.tmpdir()` 的独立目录，测试结束清理。不是用户工程或真实 Electron 窗口。
- 可复现样本：4096×4096、8192×8192 RGBA PNG；两个共享原图的栅格层、一个曝光调整层、非空 Float32 稀疏蒙版、带独立蒙版与强度的曝光滤镜。图像包含逐像素生成的纹理；原图、实际合成输出和包均走正式服务。与历史五层场景不同，不能把两者当同一输入。

## 改前与改后（毫秒）

基线保持临时 BigTIFF 的原 `level: 6`；此时包资源流串行修复已存在。因此该对照直接证明临时文件压缩的影响，不代表所有文件都处于原始 HEAD。最终数据来自 `final-phase-trace`，真实 CPU 渲染、真实编码/刷盘/打包，每个尺寸一轮；期间共享工作区也有其他检查，不能把总耗时差全部归因于某一改动。

| 阶段 | 4K 基线 | 4K 最终 | 8K 基线 | 8K 最终 |
|---|---:|---:|---:|---:|
| 小文档 JSON 序列化 | 0.030 | 0.033 | 0.023 | 0.050 |
| 源瓦片读取/解码/缓存 | 2765.07 | 2916.06 | 20094.20 | 20764.76 |
| 渲染与分块写入总计（包含上一行及下一行） | 18893.68 | 18148.27 | 82624.67 | 77836.36 |
| 临时 BigTIFF 分块写入（包含编码） | 1100.47 | 454.70 | 4278.80 | 1589.86 |
| 最终编码、校验与刷盘/发布 | 144.11 | 118.60 | 469.03 | 251.18 |
| SHA-256 与内容寻址资源写入 | 26.18 | 25.93 | 51.97 | 54.08 |
| 打包与文件写入/刷盘 | 83.76 | 101.64 | 132.49 | 139.54 |
| 完整渲染后保存总计 | **19147.73** | **18394.44** | **83278.17** | **78281.16** |
| 未改动正式文档写回 | 未测 | **3.98** | 未测 | **3.13** |
| 仅改图层名称、复用不可变像素资源写回 | 未测 | 77.13 | 未测 | 132.79 |

最终额外阶段分解（沿现有结构化日志捕获）：

| 阶段 | 4K | 8K |
|---|---:|---:|
| 临时 TIFF 写入内核 | 434.91 | 1512.82 |
| 临时 TIFF fsync/关闭 | 13.13 | 16.19 |
| 最终 libvips PNG 编码 | 89.90 | 195.68 |
| 最终栅格 fsync/关闭 | 5.68 | 8.22 |
| 栅格原子发布 | 1.28 | 1.87 |
| 包资源描述/清单校验 | 3.50 | 2.85 |
| 包清单 JSON 序列化 | 0.023 | 0.019 |
| 流式 ZIP（包含逐资源完整性 hash 与 CRC） | 62.05 | 103.02 |
| 包 fsync/关闭 | 7.19 | 15.06 |
| 保存 I/O 阶段 Node 事件循环最大延迟 | 4.02 | 2.29 |
| 同进程 CPU 渲染阶段事件循环最大延迟 | 305.55 | 289.92 |

说明：读取耗时是各正式 SourceProvider 调用累计；渲染总计还包含 Float32 颜色转换、求值、内存复制和调度。hash 与资源写入尚未独立拆开，ZIP hash 与写入亦包含在同一流式阶段。IPC 本次明确未测；性能夹具将 renderer 与服务放在一个 Node 测试进程，不能据此宣称真实 Electron 主进程或界面已验收。没有额外缩略图重渲染，正式文档封面生成端口在夹具中替换为空；历史关闭的预览是全尺寸输出，不能偷偷降分辨率达标。

## 已实施方案与选型

1. 继续使用已有 **sharp/libvips、Node zlib、archiver/yauzl、内容寻址资源库**。临时 TIFF 采用 Deflate level 0，保留无损 TIFF 契约，避免先压缩、随后为最终 PNG 再解压；最终导出压缩参数不变。效果由逐像素回环验证。代价是临时文件更大（8K RGBA8 原始像素约 256 MiB），慢磁盘还需实测。
2. ZIP 一次只打开一个受保护资源流，不随瓦片数量累积文件句柄与输入缓冲；资源按哈希去重，已编码像素保持 `store: true`，缩略图同样不重复 ZIP 压缩。新增内部资源进度回调，但**尚未接到正式界面的百分比进度**。
3. 导出流错误或取消时关闭 archive、输出及当前输入，等待输出句柄关闭才删除暂存文件；资源验证流关闭也销毁底层文件流。最后一个资源完成后、刷盘后和发布前均检查取消。
4. 同目标包导出、同图片文档提交、同画布内嵌包提交排队；保留工作版本校验与已有未改动快速路径，排队后加载实际工作副本，避免重复打包或旧请求倒序覆盖。
5. 通过原有 `runRequest` 将取消信号传入图片文档与画布保存，不新增 IPC 通道。图像/包分别仍先暂存、fsync，再沿已有原子替换入口发布。取消时未提交修改留在工作副本。
6. 本轮**没有实现新的脏瓦片包格式、增量 ZIP、Worker 渲染器或 hash 信任缓存**。不可变资源已经只在编辑时编码，证据显示打包不是瓶颈；自包含单文件原子替换仍须复制包的完整资源字节，未经证据不能把它宣传为“只写脏瓦片”。完整性 hash 保留。

官方依据：[sharp 输出参数](https://sharp.pixelplumbing.com/api-output/)、[Node zlib 文档源码](https://github.com/nodejs/node/blob/main/doc/api/zlib.md)。比较过现有 streamed ZIP / tiled TIFF 与另引入自研包、PNG 编码器及 Worker；现有成熟库已经满足格式与原子边界，瓶颈在上游求值，不新增第二套保存实现。下一步应由渲染执行器所有者优化 CPU 颜色转换/合成和冷源重复解码；保留 GPU 后备正确性，不能仅恢复 GPU 路径而删除失败场景。

## 复现

PowerShell：

```powershell
$env:HENJI_IMAGE_SAVE_BENCH = '1'
$env:HENJI_IMAGE_SAVE_BENCH_LABEL = 'local'
npx vitest run src/tests/imageEditSavePerformance.benchmark.test.ts --pool forks --silent
Remove-Item Env:HENJI_IMAGE_SAVE_BENCH
Remove-Item Env:HENJI_IMAGE_SAVE_BENCH_LABEL
```

不开启变量或存在 `CI` 时跳过重型基准。基准单测只要求模型与像素正确回环，不用放宽阈值制造性能通过；本记录明确对比目标。8K 全像素输出 SHA-256 与重开后的逐瓦片像素 SHA-256 一致，文档层/滤镜/蒙版结构一致。

正式日志沿原入口查询：`image_editor_v3.export.transcode.completed`、`image_editor_v3.output.completed`、`image_editor_v3.package.staged.completed`、`image_document.commit.confirmed`。阶段信息只进日志，没有暴露内部 ID/计时状态到产品界面。

## 验证与剩余风险

- 精确普通单测：9 个文件共 70 项通过；PNG/TIFF/JPEG/WebP/整数 AVIF 转码测试只选本次共享中间 TIFF 影响的 20 项，另外 9 项 HDR FFmpeg 分支按 `-t` 不运行，未计入通过。
- 显式 4K/8K 基准：两尺寸像素/模型回环通过；首次两次夹具因缺少小端声明、蒙版描述失败，已修正。最终阶段捕获也有非空断言。
- 改动文件 ESLint：通过。
- `tsconfig.electron.json`：通过；首次本任务基准跨层位置与测试 `this` 注解错误已修正。
- `tsconfig.json`：尚未通过，共享 t121-05 修改仍有 `imageEditHistoryTimeline.test.ts` 的 `this` 注解、三个 preview/display/viewport 测试残留 `maxCommands` 和 `ImageEditorHistoryPanelV3.tsx` 的 `selected` 属性错误；最终输出没有本任务文件错误。没有修改其他任务文件来掩盖失败。
- `check:main-imports`、`check:dependency-graph`、`check:dead-code`、`check:persistence-compat`、`check:ipc-contract`：通过。dead-code 有现有报告项，退出码 0；持久格式 36 种、IPC 347 请求/2 端口/25 订阅。
- `npx electron-vite build`：通过，main/preload/renderer 均产出；存在依赖 unused import 与动态/静态混用的构建警告，退出码 0。没有启动开发实例，构建成功不能替代仍失败的 renderer 类型检查。
- 取消、损坏资源和发布失败的精确回归覆盖原文件不变、暂存清理、资源流释放与并发顺序。**没有杀进程/断电实验**；Windows 原子替换兼容后备仍沿现有公共原语，不声明已完成崩溃注入验收。
- 真实 Electron IPC 传输、真实窗口冻结与进度呈现、正式封面生成均未测，遵守本次不运行 Reality 的限制；目标仍未达到，不可关闭性能任务。
- 未指定本任务对应的总览文件与已有行，未改共享总览；总管理者应在收口时登记本任务的未完成性能状态。

## 实际文件清单

| 文件 | 本轮修改 |
|---|---|
| `electron/main/services/image-editor-v3/package-export.ts` | 串行资源流、取消/错误收尾、资源进度、按目标排队和阶段计时。 |
| `electron/main/services/image-editor-v3/package-export.test.ts` | 去重/有界资源流、末尾及中途取消、损坏资源和并发顺序回归。 |
| `electron/main/services/image-editor-v3/resource-store.ts` | 取消验证流时关闭底层资源文件。 |
| `electron/main/services/image-editor-v3/export/transcoding-output-sink.ts` | 临时 TIFF level 0 与编码/刷盘计时。 |
| `electron/main/services/image-editor-v3/tile-output-sink.ts` | 最终 fsync 与原子发布计时。 |
| `electron/main/services/image-editor-v3/image-document/image-document-service.ts` | 文档提交排队、取消边界、保存确认计时。 |
| `electron/main/services/image-editor-v3/image-document/image-document.test.ts` | 无变化快速路径、并发版本复核、发布前取消。 |
| `electron/main/services/image-editor-v3/canvas-layers/canvas-layer-packages.ts` | 同画布包提交排队与取消。 |
| `electron/main/services/image-editor-v3/canvas-layers/canvas-layer-packages.test.ts` | 同画布并发/未改动与取消保存回归。 |
| `electron/main/ipc/image-editor-v3-package.ts` | 沿既有保存请求传递取消信号。 |
| `electron/main/ipc/image-editor-v3-package.test.ts` | 保存 IPC 的取消信号接线验证。 |
| `src/tests/imageEditSavePerformance.benchmark.test.ts` | 可显式复现的真实规模分阶段测量与逐像素回环。 |
| 本任务记录 | 证据、选型、未达目标与交接范围。 |

没有修改工作区里的 `history-persistence.ts`、历史面板或 SDK 改动；这些属于其他任务，不能混进本次文件清单。

## 设计自查

1. **助手只凭名称和说明能否用对？** 沿既有保存/确认操作，无新增同义能力；人和助手都委托原领域入口。资源进度属于内部保存端口，公开语义没有改变。
2. **能否 AI 先做、人只确认？** 自动保存、版本校验、不可变资源去重、排队及取消均由保存链执行；人不需要挑瓦片或压缩策略。当前 CPU 合成仍慢，不能声称手感目标已完成。
3. **产物能否直接流进其他工作区？** 保留相同 V3 文档、完整像素预览与 `.henjiimg`/`.henjilayer`，通过已有画布/剪辑投影消费；不新增私有格式或手动搬文件步骤。本轮证明模型/像素回环，跨工作区窗口未重新验收。
