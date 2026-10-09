# t104 / R09：媒体异步 I/O 与原子输出路径

状态：工作区实现及精确验证完成，交总管理者审查、提交。本任务未执行 Git 写操作；未修改体检报告、SDK、asset-library 或 documents 查询。

## 改动与契约

- SDK 本地媒体 reader 使用 `fs.promises.readFile`，仍返回原 `MediaBinary`：本地输入为 Buffer 字节、原 MIME 与文件名；内嵌媒体继续委托 SDK 原解析与命名函数。
- 图片加载、调试目录创建、内容寻址保存、显式路径写入、受管资源释放及回滚改成异步 I/O。MD5 继续保留，内容寻址文件名、扩展名、返回 DTO 与 lease 语义不变。
- 沿根因复查直接调用方后，分割/压缩输出的 base64 与图层栈的源层/合成/缩略图 SHA-256 也委托同一个分块字节实现，避免同源热点留在已经迁移的调用链中。
- `ensureUniquePath` 不再查询 exists 或在 9,999 个候选后回退原名，改为 `open(candidate, 'wx')` 独占创建，返回路径与仍打开的句柄。BigInt 序号从原名、`-1` 持续增长，无候选总量上限；只有真实文件系统错误才失败。
- 普通图片和全景的目录保存立即将预留交给 `writeReservedImage`；通过同一个句柄写入，成功关闭，失败或取消关闭并删除预留文件。清理失败记录日志，并继续抛原始写入/取消错误。
- 目录保存可接收服务内部 `AbortSignal`，支持冲突寻找期间、取得预留后及写入结束前的取消。图层栈在每次异步落盘之间和末尾检查取消；回滚等待完成后才抛错。
- 内容寻址保存也用独占创建。同路径写入、lease 取得与释放共用进程内异步屏障；并发调用不会因看见尚未写完的预留而提前返回，也不会因异步化丢失最后一个 lease 的删除规则。
- 显式指定文件路径的保存仍按既有契约写入该目标（允许替换目标）；自动目录保存的“唯一命名”契约绝不覆盖已有文件。没有把显式保存改成偷偷增加后缀。
- 日志统一走 `createMainLogger`；读写 start/completed 使用 debug，预留、写入、释放、回滚及补偿失败使用结构化 failed 事件；不记录媒体字节、base64 或密钥。

## 选型与性能证据

采用成熟的 Node 内置 `fs.promises`、`FileHandle`、`crypto`、`timers/promises`，没有新增依赖或新计算服务。官方依据：[fs API 与独占 flags](https://nodejs.org/api/fs.html#file-system-flags)、[Promise timers / setImmediate](https://nodejs.org/api/timers.html#timerspromisessetimmediatevalue-options)。`wx` 提供文件系统独占创建；清理须先关闭句柄，尤其 Windows 不能依赖删除仍打开的文件。

仓内已有线程/进程设施已检查：`image/registration/worker-client.ts` 与根 image-registration-worker 处理配准；image-color-lut-worker 处理 LUT；audio/worker-client 与 waveform-worker 处理音频；fonts/service 与 worker 处理字体；smart-regions/runtime / local-inference utility 处理本地推理；embedded-agent/service utility 处理助手。这些是各领域专用消息协议，没有可直接复用的通用字节编码/hash 作业入口。为本任务把媒体字节加入配准、推理或助手协议会混入无关职责和额外跨域依赖，因此未扩展这些设施，也未新建 Worker/utility 体系。

流式方案评估：SDK reader 公共 DTO 要求完整字节；loadImage 要返回完整 data URL；内容寻址的调用方已经持有 Buffer。因此本次保留完整结果，hash 按 1 MiB 分块，base64 按 768 KiB（3 的倍数）分块，每块之间用 setImmediate 让出事件循环。这些是工作粒度，不是素材数量或字节数上限。未引入额外 base64 流库，因为原生 Buffer 编码足以保持精确语义，外部流最后仍须收集为完整字符串。

2026-10-09，本机 Node v24.18.0 单次 67,108,866 字节诊断，读取当前 path-utils 源码并用 TypeScript transpile + VM 执行正式导出函数（目录和日志 mock，无真实文件写入）；setImmediate 采样最大事件循环间隔：

| 方案 | 总耗时 ms | 最大间隔 ms | 期间调度次数 |
| --- | ---: | ---: | ---: |
| 原生整块 MD5 | 69.72 | 69.85 | 1 |
| 正式分块 MD5 | 71.94 | 3.36 | 65 |
| 原生整块 base64 | 15.66 | 15.72 | 1 |
| 分块 base64 + 最后 join（放弃） | 45.40 | 19.51 | 86 |
| 正式分块 base64 + 字符串拼接 | 26.18 | 3.26 | 86 |

join 诊断证明最后的整串汇集仍集中占用主线程，因此正式实现使用字符串拼接。最终 base64 还通过完整反解码校验字节一致；这次消费解码耗时 42.41 ms。以上是单次 Node 调度诊断，不是 Electron 真实交互或长期性能基线；字符串消费/序列化可能展平字符串，完整 DTO 的内存和最终消费成本依然随输入增长。

## 调用方清单与影响范围

| 入口/调用方 | 迁移方式 |
| --- | --- |
| sdk-runtime electronMediaReader | readFileSync → await fs.promises.readFile；SDK DTO 不变 |
| image-file-ops loadImage | 异步读取 + 分块 base64 |
| image-file-ops persistImageSource / persistImageBinary | 返回异步内容寻址保存 Promise |
| image-file-ops persistImageSourceTracked | await 后再组成 DTO |
| image-file-ops 普通/全景目录保存 | 两处 ensureUniquePath 调用全部 await，持句柄独占写入/补偿 |
| image-file-ops 下载与调试目录保存 | 委托目录保存；debug getter 的唯一调用已 await |
| image-file-ops 普通/全景指定路径保存 | await writeBytesToPath，完成后才返回路径 |
| image/ops splitImageSource | 顺序 await 各帧落盘，避免同时打开任意多句柄 |
| image/ops splitImage / compressImageSource | 输出 base64 逐个 await 共享分块编码 |
| image/ops crop/embedStoryboard | 原函数已 async，直接返回落盘 Promise |
| image/ops embedPanorama/compress/mergeStoryboard | await 后再组装对象/完成日志 |
| image/ops prepareFromBytes | 原图与预览 await 保存，失败逐个 await 回滚 |
| image/local-redraw prepare | await tracked 裁剪落盘；已有 apply 的 await 保留 |
| image/layer-stack compose | 源层/合成/缩略图逐个 await，SHA-256 委托共享 hash；取消检查和回滚等待覆盖整个落盘阶段及最终摘要 |
| ipc/image 两处释放 handler | 返回释放 Promise，让 IPC 完成与失败跟随实际 I/O |
| path-utils.test / local-redraw.test / layer-stack.test / ops.crop.test / media-store.test | 同步调用与替身同步迁移异步；不增加类方法 |

检索 `ensureUniquePath`、`persistImageBytes`、`persistImageBytesTracked`、`rollbackPersistedImageBytes`、`writeBytesToPath`、`getDebugDir`、两种受管释放函数的所有调用方，没有残留同步 ensureUniquePath 调用方。其他只使用扩展名/目录 getter 的 source、panorama-metadata、video、media-import、media/shared、application-runtime/mediaResources、ai-runtime/media-store 等保持原契约，无需修改。

保留的同步设施：appPaths 的目录 getter/小配置与首次用户目录初始化不属于整文件媒体 I/O，体检报告 3.6 已明确其启动/配置原子性语义，本次没有扩大到共享配置初始化。image/ops 的 readImageInfo 存量小文件 stat/exists 不是本次 F-02 全文件热点，未顺带改写。目标三个文件中不再有 fs *Sync 调用。未修改 src/core，故只需要所属 Electron 工程 tsc。

## 设计自查

1. **助手只凭名称和说明能否用对？** 能。已有图片持久化、保存和受管释放的语义入口与 DTO 保持不变，原子命名、异步等待与回滚由同一主进程服务负责，不给助手增加路径预留细节。覆盖判断：内部实现修复，无新增用户可见实体、属性、算法操作或工具入口，不新增 MCP 能力。
2. **能否 AI 先做、人只确认？** 能。既有生成、裁剪、分割和图层栈链自动保存，冲突自动选名；人沿原保存入口确认目标与结果，无需手工枚举候选或处理预留。
3. **产物能否直接流进其他工作区？** 能。原路径、MIME、lease/createdFilePaths 与结果对象继续供共享媒体、画布、编辑器等消费，Promise 只有实际写入成功后才完成。

## 验证

按 testing.md L2：文件 I/O、共享异步调用链、并发/取消/回滚；没有升级到全量、Reality、构建或付费调用。

- 精确 Vitest（均带 `--silent`）：path-utils.test、image-file-ops.test、ops.test、ops.crop.test、layer-stack.test、local-redraw.test、sdk-runtime.test、media-store.test；共 8 文件、54 项通过。中途只重跑受更改影响的 6 文件 39 项；最后同源编码/hash 收口后重跑受影响的 5 文件 33 项通过，其他有效证据复用。
- 新测试包括超过 10,000 次碰撞继续寻找、所有候选碰撞时取消、普通/全景并发同名保存、写入失败/写入中取消/预留后取消清理、非碰撞失败日志、内容寻址失败后重试、并发内容寻址 lease 与完整字节、异步图层落盘中取消回滚、分块字节一致性与事件循环交错、SDK reader DTO 与读取失败日志。
- 首轮唯一失败是新增 SDK 内嵌媒体测试对既有 DTO 的错误预期（Buffer/固定 upload.png）；改为 SDK 实际 Uint8Array 与动态默认文件名契约后，3 项精确重跑通过。运行实现不为该错误预期做改变。
- `npx tsc -p tsconfig.electron.json --noEmit`：通过。未改 core 或渲染层，不跑 tsconfig.json。
- 对全部 14 个本次 TS 源码/测试运行文件级 ESLint，`--report-unused-disable-directives --max-warnings 0`：通过。中途修改的 7 个 TS 文件重新检查通过，最后同源收口的 4 个 TS 文件再次检查通过。
- `npm run check:main-imports`：通过，604 个 main/preload 文件。
- `npm run check:dependency-graph`：通过；11 个静态值 SCC、6 条冻结跨层边、430 条跨 feature 非 index 导入，未新增被冻结跨层边/环。失败日志使用同层既有 logging 入口，未引入新的跨域计算服务。

## 审查注意

- 原子保证是支持独占创建的文件系统上的命名预留与同进程内容寻址完成屏障，不承诺网络文件系统特殊行为、跨进程内容寻址完成屏障或进程崩溃后的全局事务恢复。进程异常退出可能遗留未完成的预留；本任务覆盖正常取消和失败补偿。
- 明确路径写入保持原覆盖语义，不是目录唯一命名；写入失败不删除已有目标文件，未增加完整文件替换的暂存/rename 协议。
- 受管释放 IPC 现在等待异步删除；主进程运行产物需要总管理者统一构建/重新加载才生效。本任务遵守指令，未启动或重启开发环境。
- 工作区开始时已有 SDK、core/documents 与 vitest 配置改动，全部保留；本次只修改本记录及以上服务、直接调用方和测试。体检报告由总管理者统一更新。
