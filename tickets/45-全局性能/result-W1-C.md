摘要 1：P2 P4 P5 P6 P7 完成并各补精确测试或日志字段；P8 核实后只剩“跨重启”这一段，需改范围外文件，未动手。
摘要 2：两个 tsc 通过，改动文件 eslint、check:main-imports、check:surface、check:colors 通过，12 个相关测试文件全绿。
摘要 3：pan-bench 与真实窗口验证未跑，步骤见“遗留”。

# 逐条

## P2 宿主上下文发布节流（已做）
- `src/features/application-control/useApplicationHost.ts`：新增 `createHostContextPublishScheduler`。画布 `dragHistorySnapshot` 非空（拖动/缩放节点中）时尾随节流，最多 250ms 发一次；手势外的变化立即发（同轮微任务合并不变），并清掉挂起的节流计时器，所以松手那次 nodes 变化当场补发最终快照。修订号仍由 `bumpScope` 同步推进，没动 hostContext.ts。
- 测试 `useApplicationHost.test.ts`：拖动中 60 次变化（240ms 内）发布 ≤2 次；松手立即补发且快照是最终值；之后 1s 不再多发。

## P4 微缩略图改由主进程生成并落盘（已做）
- 复用已有缩略图服务：`electron/main/services/asset-library/thumbnailService.ts` 新增 `ensureLocalImageThumbnail(source)`，把本机路径、`henji-media://local/`、图片编辑资源库地址解成真实路径后走现有 `ensureAssetThumbnail(…, 'image', mtime)`，按文件身份落进 Thumbnails 目录，与素材库共用同一份缓存（320 边长，sharp 在线程池里做）。
- 没新建 IPC 通道：`image:generateThumbnailBytes` 加可选 `cache: true`（与 `video:generateThumbnailBytes` 同形），返回 `cachePath`；preload 类型 `api-media.d.ts` 同步；`ImagePlatform` 契约与 electron 适配器新增 `getCachedThumbnail(source)`。
- `src/features/canvas/application/microThumbnail.ts`：删掉渲染层 loadImageElement + canvas + WebP 编码 + data URL；本地地址向主进程要缓存路径，渲染层只拿 `henji-media://` 显示地址；远程、data、blob 地址直接用源图。内存缓存只存短地址，删掉 32MB 字符串字节限额，保留 1024 项淘汰。并发由固定 2 改为核数一半（至少 2）：保留排队是为了限住主进程同时读入内存的原图份数、并让离开视口的节点撤掉未开始任务。
- 测试：`microThumbnail.test.ts` 重写（主进程路径/远程直用/LRU/失败回退/在途共享与撤队）；`thumbnailService.test.ts` 补 henji-media 解码落盘一条。`npm run check:main-imports` 通过。
- 取舍：小图（≤320）现在也会生成一张缩略图（原来直接用源图），在拉远倍率下看不出差别。

## P5 参数行视频缩略图不再挂 <video>（已做）
- VideoNode 没有可复用的 hook（它靠节点数据里的 previewImageUrl）；视频编辑项目缩略图用的是 `getPlatform().video.getCachedThumbnail`（主进程 ffmpeg 抽帧、磁盘缓存、可取消）。新增 `src/features/canvas/params/useVideoInputThumbnail.ts` 复用这条通道，`MediaInputRow.tsx` 改为 `<CanvasNodeImage>`，取不到时显示空底（角标视频图标仍在）。
- 测试：`MediaInputRow.test.tsx` 补“没有 video 元素、显示缓存首帧图”。

## P6 续查扫描只在需要时做（已做）
- `src/features/canvas/hooks/useCanvasResumePolling.ts`：不再用 React 依赖 `nodes`。工程切换时整体扫一次，之后订阅画布 store，只把 data 引用变了（含新增）的节点 ID 传给现有 `nodeIds` 参数；拖动、缩放只换位置不触发。比较按下标对齐、对不上才建 Map，拖动时是 O(n) 指针比较。
- 测试：新增 `useCanvasResumePolling.scan.test.tsx`（60 次只改位置不调用；改 data + 新增节点只交出这两个 ID）；原三份续查测试仍全过。

## P7 日志补耗时与规模（已做）
- `repository.ts`：`documents.read.completed` 加 `bytes`、`durationMs`；`documents.save.completed` 加 `bytes`（写后文件大小）、`durationMs`；`logged()` 包的各动作 completed 加 `durationMs`。
- `documentSessionRegistry.ts`：`documents.session.open.completed` 加 `durationMs`（读取耗时；直接 adopt 的不带）。
- 画布：`canvasProjectInstances.ts` 新增 `canvas.document.bind.completed`（与已有 bind.failed 成对）带 nodeCount、edgeCount、durationMs；`canvasApplicationService.ts` 的 `canvas.document.open.completed` 加同样三项。
- 未做：`documents.operations.open.completed` 在 `src/features/documents/documentOperations.ts`，不在所有权内；“到首帧”需要在 Canvas.tsx 挂 rAF，本次只到“内容载入完成”。

## P8 索引扫描重复读失败文件（核实后未改，需授权范围外文件）
- 进程内已经去重：扫描器构造时建的 `DocumentReadFailures` 跨轮保留“路径 + 大小 + 修改时间”的失败，同一次运行里第二轮起不重读也不再记 document_invalid。日志里 45 = 3 份文件 × 约 15 次启动，重复来自“每次启动”。
- 跨重启记住需要落盘：要么在作品索引 SQLite 加一张失败表（改 `electron/main/services/db-migrations.ts` 迁移账本 + `index-schema.ts`），要么在程序目录放一个可重建缓存文件（需要在 `src/core/persistence/formats.ts` 登记排除理由）。两者都超出本任务所有权，且属于持久格式变更，需要主会话决定。收益很小（每次启动 3 次小文件读 + 3 条告警）。
- 三份录制读不了的原因（screen_recording v5/v8 unsupported-version）是否迁移缺口，建议另立问题。

# 验证
- `heavy.sh tsc -p tsconfig.json`（需 `node --max-old-space-size=8192`，默认堆会 OOM）通过；`tsc -p tsconfig.electron.json` 通过。
- vitest：useApplicationHost.test.ts、microThumbnail.test.ts、useMicroThumbnail.test.ts、MediaInputRow.test.tsx、NodeInputRows.test.tsx、useCanvasResumePolling.scan.test.tsx、useCanvasResumePolling.test.tsx、.outputs.test.tsx、.localRedraw.test.tsx、documentSession.test.ts、canvasApplicationService.test.ts、electron/main/services/documents/repository.test.ts、electron/main/services/asset-library/thumbnailService.test.ts 全过。
- eslint（改动文件）通过；check:main-imports、check:surface（无本次文件命中）、check:colors 通过。

# 偏离
- 改了所有权外但属于“P4 缩略图通道”的 `electron/main/ipc/image.ts`（只给现有 handler 加 cache 分支与参数解析）。
- 微缩略图边长用素材库现有的 320 而非 256，为了与素材库共用同一份磁盘缓存。

# 遗留：需主会话真实窗口验证
1. P2：开发版打开大画布连续拖动节点 3 秒，`npm run logs:query` 或主进程日志看 `application:host:context` 调用频率应约 4 次/秒，松手后助手 `get_current_application_context` 读到的位置是最终位置。
2. P4：放 40 张 4K 图的画布，缩小越过 LOD 阈值，Performance 面板对比长任务；Thumbnails 目录出现对应 webp；重启后再拉远应立即命中（无主进程 sharp 调用）。图片编辑多图层节点的预览拉远也要能出微缩略图。
3. P5：50 个带视频输入的生成节点，参数行显示首帧图，任务管理器看 GPU 进程内存对比改前。
4. P6：有进行中服务端任务的画布重开后应恢复续查；拖动节点时不应出现 `canvas.resume_polling.*` 日志。
5. P7：打开/保存一份大画布后 `npm run logs:query` 能看到 durationMs、bytes、nodeCount、edgeCount。
6. 跑 `npm run electron:pan-bench` 确认平移无回归。

# 审查后小修（第 1 轮）
- `useVideoInputThumbnail.ts` / `MediaInputRow.tsx`：非本机视频地址（http/https 等）不请求主进程，退回 `<video preload="metadata">` 显示首帧；本机地址仍走缓存缩略图。`MediaInputRow.test.tsx` 补“远程地址有可见首帧 video、不调主进程”。
- `microThumbnail.ts`：并发固定为 4，不随核数放大，注释同步说明原因（主进程每个任务整张读入原图）。
- 原有问题顺手修：生成失败不再把源图写进缓存，本次显示源图，下次进入视口重试；测试改为断言失败后缓存为空、第二次请求重试成功；排队测试改为 4 并发。
- 验证：microThumbnail.test.ts、MediaInputRow.test.tsx、NodeInputRows.test.tsx 全过（10 条）；5 个改动文件 eslint 通过。
