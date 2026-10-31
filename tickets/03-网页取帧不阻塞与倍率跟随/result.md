# 03 网页取帧不阻塞与倍率跟随 · 结果

已验收（10-31）：未缓存网页段拖动第一帧 151–188ms、每步出画面（改前 3.4 秒、整段 1 帧）；播放热页面丢帧 14–28%（改前 32–39%），6150 不再报显存预算中断。
四轮修复、三轮交叉审查加 /code-review；L2 319 项通过；本地提交，未 push。
遗留：完整取帧流水线、按屏幕实际尺寸定倍率、占位宽高 1×1、硬剪点预开页面、冷页面首播丢帧高（见文末）。

## 完成标准对照

| 计划条目 | 实现与证据 | 状态 |
| --- | --- | --- |
| 预览一帧预算内交回 | 根渲染帧建立共享截止时间，嵌套网页共用预算；超时沿用本轨道上一幅。第一幅未到时给透明网页占位，保留取景、倍率和空 boxes。近似画面继续沿用既有 approximate 缓存排除规则 | 定向测试通过；实机待验 |
| 暂停、观察、导出精确 | 非节目顺序预览等待指定票据；暂停取消立即结束 Worker 等待；迟到帧归还，不提交旧节目画面 | 定向测试通过 |
| 排队旧目标丢弃 | Worker 播放队列保留进行中的读与最新目标；主进程 latest 丢弃未开始任务，cancelWeb 在 seek 后、快照前与送回前检查 | 定向测试覆盖目标 1/2/3 只执行 1/3、取消后不画、迟到释放 |
| 同源两时刻护栏 | 以渲染器、片段、参数标识稳定取样轨道；同一轨道在同一帧被要求两个时刻时再分槽，每槽独立页面 | 同帧两时刻、不同票据和乱序回执测试通过 |
| 倍率跟随且不重开 | 有效倍率 = 声明倍率 × 输出比例 ÷ 预览分辨率除数；导出比例复用正式缩放/裁切几何，letterbox 按实际内容尺寸计算。固定初始设备倍率，用 CDP viewport、窗口与快照 backing store 调整，保留页面 DOM/时间 | 测试覆盖 1/4 预览、放大、letterbox、换倍率不 loadURL；真实像素待验 |
| 取帧流水线 | 快照提交后可推进下一次 seek，取得上一幅不可变共享纹理后才能覆盖输出画布；传输可与后帧重叠；元数据含票据和 frameIndex；顺序精确渲染前视两帧 | 传输阻塞、先 seek 后绘制、乱序消费、回退测试通过；吞吐待验 |
| seek 超时 | 历史记录已核对，计时归属已确认；seek 与 boxes 分阶段计时，seek 记录上次完成时刻与方向，保留超时终止页面和重载恢复 | 宿主结论已给；具体页面 promise 挂起原因未确定 |
| 真片改前改后比较 | 本次约束不允许启动验收环境或读取片子目录 | 未执行，不能报告改后跳帧率或首帧延迟 |

## 根因与实现范围

预览原来直接等待网页精确取帧，慢页面把整帧合成与后续拖动串在一起；网页实例又只按来源与取景共享，同屏两个取样时刻会交替修改同一页面时间。声明倍率始终直接作为取帧倍率，低分辨率预览仍可能栅格整页四倍。

本次将“预览本帧愿意等多久”与“页面取帧执行到哪里”分开：预算只影响节目合成，页面仍串行推进自身时间；旧排队目标被取消，进行中的结果按票据接收或释放。页面实例按稳定取样轨道隔离，输出倍率在同一实例调整。

共用正式帧通道、共享纹理、外来代码信任确认、内容指纹事件和导出几何，不新增依赖、UI、持久格式或日志通道。Electron 的 contextIsolation/sandbox/nodeIntegration 与无 preload 网页窗口保持原值。HTML-in-Canvas 不可用时继续走普通页面标记帧路径；快照已经交接后失败则使流水线失效并重载到普通绘制，避免在已推进的 DOM 上假装重画上一刻。

排查范围包含：
- 主进程 open/capture/cancel/reload/close、快照与普通绘制分支、纹理交接和内容更新。
- Worker 帧通道与 preload、根及嵌套渲染器、节目预览/暂停/观察/导出、前视与倍率切换。
- 第 1 步暂停拖动取消与缓存入口，01/02 帧指纹、近似帧排除、导出缓存复用入口。已有直接消费者测试通过，未改其缓存算法。
- 审查补修：清理会话时保护当前帧正在使用的全部网页，避免慢帧里第五个来源触发回收；透明占位仍传递网页元数据，避免合法作者读取 info.web 时失败。

没有调大 PLAYBACK_MAX_SKIP_SECONDS；播放跳帧策略未变。未发现上述已检查缓存入口有本次改动引入的确定缺陷，但这不等于真片播放性能已验证。

## seek 超时调查结论

查询入口：`node scripts/query-logs.cjs --date 2026-10-30 --domain main.web_source --grep "超过 30 秒" --json`。
日志文件按 UTC 日期命名；以首次调查截止时间 **2026-10-30T23:05:55.749Z** 固定范围，避免运行中的旧应用持续新增日志改变统计：

- UTC 2026-10-30 共 17 条匹配事件，其中北京时间 10 月 31 日零点之后 13 条；seek(21.58) 重复 6 次。
- 该范围最后两条是 22:07:17.966Z 的 seek(21.0945) 和 23:05:55.749Z 的 seek(105.91666666666667)。
- 旧代码的 30 秒计时包裹页面世界的 seek **和** 可选 boxes，因此“seek 超时”不能证明 seek 单独挂起。主进程排队发生在这段计时之前，共享纹理送回在其后；不能把这些记录归因于传输慢或队列等待。
- 证据只足以确定页面 JS 调用未在时限内完成。页面主线程长期忙、seek 内部 promise 不结束、boxes 不结束，都尚未被历史日志区分。
- 同源不同时间交替 seek 是代码中确认的风险，本次已隔离；它是否解释这些历史超时仍需真实页面证据，不能当成已证实的全部根因。
- 新日志分开标识 seek/boxes，seek 带上次完成时刻及前进/后退方向；快照仍独立超时。未调大 30 秒时限，也没有吞掉错误或自动用旧帧冒充精确结果。

未读取片子外壳或修改 `D:\视频制作`；仓库内 author-api-media.md 只读。后续需用允许的实机环境取得新阶段日志，再定位具体未完成的页面 promise。

## 验证

本次是 testing.md 的 **L2**：跨渲染层/Electron 的公开帧契约、异步调度与取消，以及共享导出消费方。新测试对应第三节的真实回归、并发/取消/恢复和 IPC 稳定边界；不引入全量测试或 Reality。

最终命令（显式 20 个本次文件；不扫描其他任务的脏文件；本条命令堆上限 12 GiB）：

```powershell
$env:NODE_OPTIONS='--max-old-space-size=12288'
npm run verify:changed -- --level L2 electron/main/services/web-source/page.ts electron/main/services/web-source/pages.ts electron/main/services/web-source/page.test.ts electron/main/ipc/video-frames.ts electron/preload/video-frames-api.ts src/core/videoEdit/codeMaterial/webSource.ts src/platform/contracts/videoFrameTypes.ts src/features/videoEdit/engine/videoEditWebInputs.ts src/features/videoEdit/engine/videoEditWebInputs.test.ts src/features/videoEdit/engine/videoEditRenderer.ts src/features/videoEdit/engine/videoEditRenderTransport.ts src/features/videoEdit/engine/videoEditWorker.ts src/features/videoEdit/application/videoEditExport.ts electron/main/services/web-source/pages.test.ts electron/preload/video-frames-api.test.ts src/features/videoEdit/engine/videoEditNativeFrames.ts src/features/videoEdit/engine/videoEditGpuCompositor.ts src/features/videoEdit/engine/videoEditRenderer.test.ts src/features/videoEdit/application/videoEditExportQueue.test.tsx src/features/videoEdit/engine/videoEditGpuCompositor.test.ts --test electron/main/services/web-source/page.test.ts --test electron/preload/video-frames-api.test.ts --test src/features/videoEdit/engine/videoEditWebInputs.test.ts --test src/features/videoEdit/engine/videoEditRenderer.test.ts --test src/features/videoEdit/engine/videoEditWorker.test.ts --test src/features/videoEdit/engine/videoEditRenderSession.test.ts --test src/features/videoEdit/application/videoEditExportPreviews.test.ts --test electron/main/services/web-source/pages.test.ts --test src/features/videoEdit/engine/videoEditNativeFrames.test.ts --test src/features/videoEdit/application/videoEditExportQueue.test.tsx
```

最终命令退出码 0：精确测试 11 个文件、295 项通过，文件级 ESLint、渲染层 TypeScript、Electron TypeScript、check:dependency-graph、check:main-imports、check:ipc-contract 全部通过。依赖图 0 个静态值 SCC、0 条冻结跨层边；主进程边界扫描 969 个文件；IPC 对账为 435 请求 / 7 消息端口 / 40 订阅事件。显式本次文件的 git diff --check 通过。

匹配范围包括网页页内调度、网页输入、IPC/preload、原生帧接收、合成器、Renderer、Worker、RenderSession、导出预览复用和导出队列。未执行构建或真实应用运行，检查结果不包含真实像素与性能结论。

## 独立审查

共 3 轮；第一轮 1 项重要问题（当前帧网页被闲置清理）已修并补回归，第二轮 1 项重要问题（占位图没有网页元数据）已修并验证作者读取路径，第三轮增量未发现新的重要或小问题。审查未启动应用。

计划指定的 Opus xhigh + /code-review 在当前工具中不可用，实际使用独立干净上下文的可用审查代理。没有把“模型名称符合计划”冒充为已满足。

## 偏离与尚未验证

- 采用有界流水线：下一次 seek 可提前，但下一次快照复制仍等待上一幅不可变纹理。没有实现画面外编码或 timestamp 校准的多幅快照同时飞行；该选择避免已知 Chromium 合帧错配。**未证明达到此前探针 6.5–7ms。**
- 取消立即结束消费者等待、跳过后续阶段并释放迟到结果；**不会强行中断已经执行的页面同步 JS 或 GPU 复制**。同一页面的新任务仍可能等这段执行结束，预览靠旧帧/既有拖动缓存保持响应。
- 真片“改后丢帧率”“网页 p50/p90”“松手立刻再拖首帧延迟”均未测量。背景给出的改前 32–39%、0.8–3.5 秒、第二次拖动 3.4 秒仅为用户提供基线。
- CDP 动态缩放在真实 Electron 下的整页/局部取景、清晰度、边缘和普通绘制回退仍待像素验收；替身测试只证明尺寸命令、实例复用与数据契约。
- 本次页内复用按轨道隔离，即使两个不同参数恰好同秒也可各有页面；不为偶然同秒合并而破坏下一帧时间独立性。

## 本次文件统计

代码与测试合计 **20 个文件，+638 / -156**（18 个已跟踪改动 + 2 个新增测试；不含任务文档）。另新增 design.md 与本 result.md；plan.md 为用户已有输入。

| 文件 | 增加 | 删除 |
| --- | ---: | ---: |
| electron/main/ipc/video-frames.ts | 1 | 0 |
| electron/main/services/web-source/page.ts | 119 | 30 |
| electron/main/services/web-source/page.test.ts | 64 | 3 |
| electron/main/services/web-source/pages.ts | 17 | 6 |
| electron/main/services/web-source/pages.test.ts | 14 | 0 |
| electron/preload/video-frames-api.ts | 7 | 0 |
| electron/preload/video-frames-api.test.ts | 18 | 0 |
| src/core/videoEdit/codeMaterial/webSource.ts | 7 | 5 |
| src/platform/contracts/videoFrameTypes.ts | 10 | 0 |
| src/features/videoEdit/application/videoEditExport.ts | 2 | 1 |
| src/features/videoEdit/application/videoEditExportQueue.test.tsx | 4 | 1 |
| src/features/videoEdit/engine/videoEditGpuCompositor.ts | 7 | 1 |
| src/features/videoEdit/engine/videoEditGpuCompositor.test.ts | 10 | 0 |
| src/features/videoEdit/engine/videoEditNativeFrames.ts | 10 | 1 |
| src/features/videoEdit/engine/videoEditRenderTransport.ts | 1 | 0 |
| src/features/videoEdit/engine/videoEditRenderer.ts | 29 | 14 |
| src/features/videoEdit/engine/videoEditRenderer.test.ts | 37 | 4 |
| src/features/videoEdit/engine/videoEditWebInputs.ts | 167 | 90 |
| src/features/videoEdit/engine/videoEditWebInputs.test.ts | 110 | 0 |
| src/features/videoEdit/engine/videoEditWorker.ts | 4 | 0 |

工作区另有制作进度文档及 tickets/04-自动检查 的他人改动，本次未纳入验证、未暂存或修改。分支保持 main，开始时已有的领先提交保持不动。


## 真机实测（10-31，Claude，开发版，自动渲染暂停）
- 未缓存网页段播放：6150 起 3 秒丢帧 17%（改前 32%）；6400 起 33%（这段页面重，每次取帧 p50 34ms）；全图 2900 起 35%。连续播放时取帧 p50 16–36ms，倍率一直是 4（7680×4320，预览“完整”分辨率）。
- 全图段松手 300ms 后再拖：第一帧 824ms（改前 3453ms），但整段拖动只出 1 帧；实测段 6400→6120→6450：第一帧 91ms，拖动中也只出 1 帧。远跳取帧 1.2–2.5 秒，耗在页面自身 seek（重放），不是快照。
- 结论：播放有改善但不稳定；拖动仍被精确网页取帧拖住（拖动不走“超预算沿用上一张”）；倍率未按窗口在屏幕上的实际大小下调，未推近时也按 4 倍栅格整页。

## 交叉审查与真机问题修复（2026-10-31，本轮）

本轮按 review.md 开头的范围处理：必须改 1–4，以及建议 4、5、6、9、10、11、12；建议 7、8 另外做独立 Electron 原生探针核实并补修。代码增量限于原 ticket 的 12 个源码/测试文件；最终验证覆盖整个 ticket 的显式 20 个文件。没有修改 UI、缓存算法、Electron 隔离配置、其他任务文档或用户工程；没有提交、暂存、推送、运行 Reality、构建或操作开发版，也未访问 `D:\视频制作`。

### 修复对照

| 条目 | 本轮处理 |
| --- | --- |
| 必须 1 | 取消、失败等提前退出也等待 previousPaint，绘制屏障沿整个任务链传递；reload 等待同一屏障。领取结果保存自己的尺寸、时长，不受后继 resize/reload 影响。补取消空洞、在途快照与重载回归。 |
| 必须 2、建议 4 | 去掉渲染器实例号、clip.id 和参数名组成的页面槽键；同来源/取景/声明倍率/信任上下文共用页面，只在同一帧要求不同时间时分槽。嵌套与代码输入重建、跨剪点不重新 openWeb；补两类真实渲染器调用测试。 |
| 必须 3 | 导出内容几何比例及渲染入口上限均夹到 1，网页运行时像素夹到 [1,8192]；声明参数仍按原契约验证。补 1080p 导 4K、小取景降采样及纹理边界测试。 |
| 必须 4 | 拖动现场合成与播放共用一帧网页预算；超时用该槽上一幅并传播 approximate，松手后精确等待。新增连续三个跳转均可完成合成、松手补精确帧的测试；未改第 1 步缓存优先入口。 |
| 建议 5 | 结构更新只取消读请求、失效读缓存，保留上一幅作为近似回退。 |
| 建议 6 | latest 只淘汰尚未开始的 latest 任务；内容更新后精确消费者使用新票据重排。松手接管同目标在途预览时同步切换精确语义，避免更新文件时被误取消。 |
| 建议 9 | 复用跨帧已不再使用的同尺寸纹理；预算计入实际已分配纹理（含前视、待回收、复用池和复制中的预留），并与嵌套/代码输入预算合并。同帧同键读去重；不同 boxes 的同帧读共同保留，不能互相取消。 |
| 建议 10 | resize 完成后再次检查取消与关闭状态，不再为期间取消的任务 seek。 |
| 建议 11 | 嵌套结果返回本次子树新增的 approximate，使代码输入缓存保存近似标记；同帧松手会重取精确结果。 |
| 建议 12 | 透明占位继续共用 1×1 纹理，但对作者报告真实输出宽高；请求的 boxes 缺测时明确为 null，回退帧也补齐本次选择器，遵守已有矩形可空契约。 |

### 建议 7：真实倍率、边缘与回退核实

使用本机 Electron **44.9.3 / Chromium 152.0.7977.167**，独立资料目录、隐藏离屏窗口及自建纯色边界/文字页面，直接加载修改后的 WebSourcePage。此为叶子原生探针，不是完整应用或真片性能验收；未连接开发版。临时脚本与数据位于忽略目录 `node_modules/.cache/ticket03/`，不纳入提交。

取景为页面 800×600 中的 [73,41,301,201]，同页按 **2 → 0.5 → 1.125 → 2** 切倍率：

- 确认一项原有快照缺陷：HTML-in-Canvas 容器没有设置 backing 尺寸，默认 300×150 与页面 CSS 尺寸不一致，局部取景右/下缘混入外侧颜色。本轮将容器尺寸与页面 CSS 视口对齐。修后上述倍率的快照取景角点均为预期绿色，输出分别为 **602×402、150×100、338×226、602×402**。
- 实测没有支持“viewport 原点还必须再乘 viewport.scale”的证据，保持现有坐标设置。原始离屏纹理偶有额外 1–2 像素，正式 copyWebFrame 按有效输出尺寸 textureLoad 裁掉，不按整幅纹理拉伸。
- 普通绘制回退在 0.5 倍确实出现取帧超时：1 CSS 像素的透明标记成为亚像素，未产生新的 paint。本轮使标记至少覆盖一个输出像素。修后同一倍率序列均取帧成功，换倍率约 **119–122ms**；新增 0.125 倍回归阻止标记退回亚像素。
- 切倍率的准备等待确实存在：HTML-in-Canvas 本轮约 **130–166ms**，未通过删掉隔离旧 paint 的等待来冒险提速。页面 DPR 仍固定为打开时的 2；与按目标倍率新开的页面逐像素比较，0.5 倍有 **829/15000** 像素不同、1.125 倍有 **2212/76388** 不同、2 倍相同。差异包含文字抗锯齿及亚像素边界；普通回退的 1.125 倍边界也有覆盖率混色。因此只确认本轮取景/尺寸和低倍率可用性，**不宣称动态倍率与重开页面的目标 DPR 栅格逐像素等价**。保留固定 DPR、不重开页面的现有方案与这项清晰度限制。

API 核对依据为 [Chrome 的 HTML-in-Canvas 版本说明](https://developer.chrome.com/blog/html-in-canvas-ot-changes)及 [Chromium 的 copyElementImageToTexture 实现](https://chromium.googlesource.com/chromium/src/third_party/+/e16eac7ad9cc1761305bdad6c4882392bde677ff/blink/renderer/modules/webgpu/gpu_queue.cc)；没有将 Chrome 155 的新接口名套到本机 Chromium 152。

### 建议 8：崩页后的在途 seek

已在上述真实 Electron 进程中复现：下一 seek 返回永不完成的 Promise，前一快照领取失败后主动崩页，原执行等待 **超过 4 秒仍未结束**（宿主原本只能等 30 秒计时器）。

本轮加入页面进程生命周期信号；崩页、进程退出和关闭会立即拒绝在途 seek/boxes，成功重载建立新的生命周期。修后两任务约 **0.32 秒**均以错误完成（含探针注入的 150ms 快照失败等待），不再卡满 30 秒；单测另覆盖下一帧重新载入普通绘制恢复。没有吞掉失败或把旧图冒充精确结果。

### 最终验证与审查

分级仍为 **L2**：取消/重试状态机、跨 Electron 帧通道与共享渲染/导出消费者；新增测试均针对已复现缺陷或并发恢复边界。最终命令仅提高该进程树的 Node 堆上限：

```powershell
$env:NODE_OPTIONS='--max-old-space-size=12288'
npm run verify:changed -- --level L2 electron/main/services/web-source/page.ts electron/main/services/web-source/pages.ts electron/main/services/web-source/page.test.ts electron/main/ipc/video-frames.ts electron/preload/video-frames-api.ts src/core/videoEdit/codeMaterial/webSource.ts src/platform/contracts/videoFrameTypes.ts src/features/videoEdit/engine/videoEditWebInputs.ts src/features/videoEdit/engine/videoEditWebInputs.test.ts src/features/videoEdit/engine/videoEditRenderer.ts src/features/videoEdit/engine/videoEditRenderTransport.ts src/features/videoEdit/engine/videoEditWorker.ts src/features/videoEdit/application/videoEditExport.ts electron/main/services/web-source/pages.test.ts electron/preload/video-frames-api.test.ts src/features/videoEdit/engine/videoEditNativeFrames.ts src/features/videoEdit/engine/videoEditGpuCompositor.ts src/features/videoEdit/engine/videoEditRenderer.test.ts src/features/videoEdit/application/videoEditExportQueue.test.tsx src/features/videoEdit/engine/videoEditGpuCompositor.test.ts --test electron/main/services/web-source/page.test.ts --test electron/preload/video-frames-api.test.ts --test src/features/videoEdit/engine/videoEditWebInputs.test.ts --test src/features/videoEdit/engine/videoEditRenderer.test.ts --test src/features/videoEdit/engine/videoEditWorker.test.ts --test src/features/videoEdit/engine/videoEditRenderSession.test.ts --test src/features/videoEdit/application/videoEditExportPreviews.test.ts --test electron/main/services/web-source/pages.test.ts --test src/features/videoEdit/engine/videoEditNativeFrames.test.ts --test src/features/videoEdit/application/videoEditExportQueue.test.tsx --test src/features/videoEdit/engine/videoEditGpuCompositor.test.ts
```

最终命令退出码 **0**：**11 个测试文件、307 项测试全部通过**，文件级 ESLint、渲染层和 Electron TypeScript、check:dependency-graph、check:main-imports、check:ipc-contract 全部通过。依赖图 0 个静态值 SCC / 0 条冻结跨层边，主进程扫描 969 个文件，IPC 对账 435 请求 / 7 消息端口 / 40 订阅事件。显式本次文件的 git diff --check 通过。最终日志位于忽略目录 `node_modules/.cache/ticket03/verify-final.log`；不加入提交。

实际排查覆盖主进程 capture/cancel/reload/resize/崩页恢复，Worker 网页会话、同帧多参数、嵌套/代码输入、导出比例与普通绘制回退。01/02 导出预览复用、帧缓存及第 1 步拖动/松手入口的直接消费者测试通过，未修改这些缓存算法；没有据此宣称所有项目的播放性能已达标。

本轮独立审查 **3 轮**：第一轮 1 项重要问题（同帧不同 boxes 的请求互相取消）已修复并补精确/预览回归；第二轮增量无新问题；第三轮复查松手接管后的精确重排增量，无新问题。其后真实回退探针发现的低倍率标记增量，由主代理通过原生复测和精确回归核验，未追加第四轮独立审查。

原定遗留不变：完整取帧流水线/6.5ms 目标、按屏幕实际显示尺寸决定倍率，本轮未实现；《元宝搜索》新代码播放丢帧率、实际拖动延迟未复测，不以叶子探针或单测替代。建议 7 的固定 DPR 栅格差异及倍率切换准备成本如上保留披露。


## 第 2 轮真机（10-31 12:00，Claude，开发版，窗口恢复最大化，自动渲染暂停）
- 注意：开发版 `--background` 启动时窗口最小化，CDP 鼠标事件每步约 1 秒才确认（缓存区也一样），之前同条件数据作废；以下均为窗口恢复后。
- 拖动（松手 300ms 后再拖，3 组 2900↔3300、6050↔6300、3300↔3700）：第一帧 148–199ms（第 1 轮 824ms，改前 3453ms）；拖动中每步都出新画面（每次 28–30 帧，约 50ms 一帧）；没有过时帧晚到覆盖；松手后精确帧 1.6–2.0 秒（远跳 seek）。
- 播放 3 秒：2900 起丢帧 24–26%，3300 起 33–34%；6150 起约 1.2 秒即报“当前网页画面、视频输入与嵌套画面超过显存预算”中断（即复审重要 3）。

## 第 2 轮复审五项修复（2026-10-31，Codex）

继续在 main 的 ticket 03 未提交改动上修复。本节统计以本轮开始时的文件为基准，不把前两轮改动计成本轮新增。未提交、未暂存、未推送；没有修改 UI、Electron 隔离配置、01/02 缓存算法或拖动缓存入口，没有访问 `D:\视频制作`、操作 9334 开发实例、运行 Reality 或构建。本轮没有启动 Electron，也没有需要遗留或关闭的自建 Electron 探针进程。

### 五项处理及同源范围

| 复审条目 | 本轮修复与证据 |
| --- | --- |
| 重要 1 | 同一帧同源同刻仍共享槽位，不同时刻各占一槽；跨帧从未占用的同源会话中选择最接近上一取样时刻的槽。回归覆盖 A=1 秒、B=70 秒叠化/画中画后仅 B 继续：70.04、70.08 秒保持 B 页面，慢帧也回退到 B 的 70 秒画面，不转去 A 页面。 |
| 重要 2 | 网页输出倍率统一取整棵树根渲染器的输出比例与回放除数，下层代码输入、嵌套、滤镜前缀不再按自己的除数给同页发不同倍率。下层合成缓存键同时纳入该倍率，避免同一暂停帧切分辨率命中旧网页画面。测试覆盖半/四分辨率以及两次均停在第 17 帧的切换，检查同页同刻只取一次及下层离屏重绘。 |
| 重要 3 | 按当前帧必需读取和已交给合成的画面计算硬预算；实际分配仍记账。分配压力先放弃前视、回收复用池与待回收纹理、关闭闲置会话，再按需让上一幅让路；已被本帧用于回退的画面受保护。在途软复制被取消后于返回处释放，不阻塞预览等待。视频输入、嵌套、滤镜相邻帧统一经过该预算入口，只有本帧必需画面超过额度才报错。测试覆盖 7680×4320 网页、一路 3840×2160 视频输入、连续及跳帧读取、预览/精确两种路径，以及闲置页回收和必需画面确实超限。 |
| 小问题 4 | 占位纹理的 width/height 保持实际 1×1，displayWidth/displayHeight 通过已有 display 参数报告网页输出尺寸，网页元数据保留。避免作者按物理宽高复制时越界。 |
| 小问题 5 | 每次渲染的近似计数独立；共享画面用 WeakSet 记其实际近似属性，消费该画面的子树才继承标记。覆盖并发兄弟子树、共享嵌套结果、代码输入缓存和滤镜相邻帧传播；回归让精确兄弟及冻结视频输入等待慢网页子树完成，确认不被误标，也不重绘精确冻结缓存。 |

排查了网页会话的精确/预览取帧、前视、取消、内容失效、跨帧复用与回收，以及根/嵌套/代码输入/滤镜相邻帧的预算和近似传播。01/02 的导出预览复用、Worker/RenderSession 和拖动/松手直接消费者纳入本轮精确测试；这些入口没有修改，测试未发现同源回归。没有用这些替身测试声称真片的物理呈现时延或显存驱动行为已验收。

### 旧代码对照与独立审查

在忽略目录 `node_modules/.cache/ticket03/round2-base/` 保存本轮开始时的六份文件。临时 Vitest load 插件只在测试进程里加载旧实现，未回写或切换工作区源码。旧实现对照实际复现五类失败：B 回到 stream-1、倍率交替为 `[2,4,2,4,2,4]`、跳帧时抛同一显存预算错误、占位物理尺寸错误、精确兄弟被误标 approximate。证据为 `round2-red.log` 与 `round2-budget-red.log`；新版精确测试覆盖相同输入。

独立审查共 **2 轮**：第一轮发现 1 项重要问题（同帧改倍率未失效下层合成缓存），已修复并加入同帧切换断言；第二轮只审该增量，未发现新增问题。审查没有启动应用。首次 L2 的运行时测试通过，类型检查发现新增测试的两个类型声明问题（动态导入实例类型、只读取景元组），均已修正。

### 本轮增量

| 文件（均在 src/features/videoEdit/engine/） | 增加 | 删除 |
| --- | ---: | ---: |
| videoEditWebInputs.ts | 101 | 18 |
| videoEditWebInputs.test.ts | 53 | 7 |
| videoEditRenderer.ts | 34 | 26 |
| videoEditRenderer.test.ts | 114 | 0 |
| videoEditGpuCompositor.ts | 1 | 1 |
| videoEditGpuCompositor.test.ts | 2 | 1 |

合计六个代码/测试文件 **+305 / -53**，另在本 result.md 追加本节。测试增量用于五项已复现缺陷及审查发现的同源缓存遗漏，没有新增文档或修改其他任务文件。

### 偏离与待实测

没有超出本轮约定范围；完整取帧流水线与按屏幕实际尺寸决定倍率保持不做。真片 6150 帧附近播放是否持续不中断、拖动首帧是否保持 <200ms 且每步出画面，仍需在后续获准的真机运行中复测；本轮不触碰开发版和用户工程，不借用上节真机成绩作为修改后的实测结论。定向拖动超时回退、松手补精确帧及缓存消费者测试已纳入验证。

### 最终 L2 验证

本轮按 testing.md 的共享异步状态流与多个直接消费者归为 **L2**；用户要求复验 ticket 03 全部文件，因此显式传入该 ticket 的 **20 个代码/测试文件**，没有扫描其他任务的脏文件。Node 堆上限仅在执行该命令的子进程树内提高为 12 GiB。最终命令：

```powershell
$env:NODE_OPTIONS='--max-old-space-size=12288'
npm run verify:changed -- --level L2 electron/main/services/web-source/page.ts electron/main/services/web-source/pages.ts electron/main/services/web-source/page.test.ts electron/main/ipc/video-frames.ts electron/preload/video-frames-api.ts src/core/videoEdit/codeMaterial/webSource.ts src/platform/contracts/videoFrameTypes.ts src/features/videoEdit/engine/videoEditWebInputs.ts src/features/videoEdit/engine/videoEditWebInputs.test.ts src/features/videoEdit/engine/videoEditRenderer.ts src/features/videoEdit/engine/videoEditRenderTransport.ts src/features/videoEdit/engine/videoEditWorker.ts src/features/videoEdit/application/videoEditExport.ts electron/main/services/web-source/pages.test.ts electron/preload/video-frames-api.test.ts src/features/videoEdit/engine/videoEditNativeFrames.ts src/features/videoEdit/engine/videoEditGpuCompositor.ts src/features/videoEdit/engine/videoEditRenderer.test.ts src/features/videoEdit/application/videoEditExportQueue.test.tsx src/features/videoEdit/engine/videoEditGpuCompositor.test.ts --test electron/main/services/web-source/page.test.ts --test electron/preload/video-frames-api.test.ts --test src/features/videoEdit/engine/videoEditWebInputs.test.ts --test src/features/videoEdit/engine/videoEditRenderer.test.ts --test src/features/videoEdit/engine/videoEditWorker.test.ts --test src/features/videoEdit/engine/videoEditRenderSession.test.ts --test src/features/videoEdit/application/videoEditExportPreviews.test.ts --test electron/main/services/web-source/pages.test.ts --test src/features/videoEdit/engine/videoEditNativeFrames.test.ts --test src/features/videoEdit/application/videoEditExportQueue.test.tsx --test src/features/videoEdit/engine/videoEditGpuCompositor.test.ts
```

最终退出码 **0**：11 个测试文件、**314 项全部通过**；文件级 ESLint、渲染层 TypeScript、Electron TypeScript、check:dependency-graph、check:main-imports、check:ipc-contract 全部通过。依赖图 0 个静态值 SCC / 0 条冻结跨层边，主进程扫描 969 个文件，IPC 为 435 请求 / 7 消息端口 / 40 订阅事件。本次显式代码文件的 git diff --check 通过。

最终完整日志：`node_modules/.cache/ticket03/round2-verify-final.log`；执行脚本：`node_modules/.cache/ticket03/round2-verify.ps1`；本轮代码增量：`node_modules/.cache/ticket03/round2-final.patch`。这些均为忽略目录内的验证产物，不纳入提交。未改变本轮开工时 main 领先 origin/main 的两个既有提交；其他任务的未提交文件原样保留。

## 第 3 轮真机（10-31 12:25，Claude，开发版，窗口最大化，自动渲染暂停，渲染层已重新载入）
- 播放 3 秒（各两次）：6150 起 22%、14%（不再中断）；2900 起 51%（冷页面首次）、24%；3300 起 39%、30%。重新载入后日志 0 条警告/错误，无“超过显存预算”。
- 拖动（松手 300ms 后再拖，三组）：第一帧 153–194ms，每次拖动 27–30 帧，无过时帧覆盖；松手精确帧 86–1492ms。


## 第 3 轮复审与 /code-review 最后定点修复（2026-10-31，Codex）

本节以本轮开工时的未提交工作区为基线：10 个代码/测试文件，增量 **+256 / -88**，另追加本节。继续留在 main；没有暂存、提交、合并或推送，没有访问 `D:\视频制作`、运行 Reality、构建应用或操作端口 9334 开发实例。只启动独立资料目录中的原生叶子探针，全部已正常退出；未修改 UI 或 Electron 隔离配置。

### 修复与回归证据

| 条目 | 处理结果 |
| --- | --- |
| 1 回收顺序 | 全局按「复用池与待回收 → 非上一幅的已完成读 → 闲置会话 → 上一幅」回收，只处理持有纹理的对象；闲置回收跳过无纹理在途读。未结束帧的画面全程保护。池里其他纹理仅在压力下清理，不因每次复制无条件清池。持续压力回归确认慢预览最终完成并成为回退画面、导出前视不被反复取消重建。 |
| 2 帧状态 | `frames` 按根帧对象保存 required、pinned、availableBytes、槽位与保留读集合；回收和复用检查所有未结束帧。根渲染器在提交完成或取消/失败退出的 finally 调 trim，子树不提前释放共享状态。回归覆盖重叠帧有压力时不销毁、无压力时不复用覆盖、各帧预算回调互不串用，以及绘制前仍受保护和失败退出释放。 |
| 3 设备倍率 | 原生探针证实 DPR canvas 发糊，因此只在请求倍率超过设备倍率时重建离屏页面；降倍率及升回已达到的倍率保持窗口。重建仍通过前一幅绘制屏障，旧窗口的迟到 paint/退出事件不影响新窗口。单测覆盖重建阈值、降倍率复用及隔离配置。 |
| 4 文档更新 | 删除根 updateDocument 的全量网页 invalidate；读取仍由路径/取景/倍率/时刻/选择器键控，网页文件变动继续走内容事件失效。根、嵌套与下层代码输入回归确认结构编辑同刻不重复 capture，真正内容更新仍重排精确帧。 |
| 5 小问题 | 删除 WebPictureOptions.lane；512MiB 输入预算收口到 videoEditGpuBudget.ts，renderer 两处共用；blankWebPicture 直接复用/创建透明纹理；captureWeb 倍率限制为 (0, 8192]；恢复页面资源成本及同帧树上其他消费者保护的原因注释。 |

排查范围为网页会话读取/前视/回收/复用/内容失效/取消、根与嵌套/代码输入/滤镜邻帧的共享上下文、主进程窗口重建与画面交接。Worker、RenderSession、导出队列与导出预览的直接消费者纳入 L2，检查后未发现本轮引入的同源回归；没有扩展为全项目审计。

旧代码对照使用忽略目录中的 `final-base/` 与临时 Vitest load 插件，不回写工作区源码。旧实现实际复现慢读被取消、重叠帧销毁/复用覆盖、根帧提前 trim、结构编辑多一次 capture；证据为 `final-red.log`、`final-red-overlap.log`。当前代码对应测试均通过。

### 原生倍率核实

复用上轮 WebSourcePage 原生探针与 Electron 44.9.3 / Chromium 152.0.7977.167，800×600 CSS 页面，取景 `[73,41,301,201]`，比较 2 倍输出有效区域 **602×402（242,004 像素）**。夹具包含 DOM 文字和按 devicePixelRatio 创建 backing store 的 canvas 文字/细线；与按目标倍率新开的页面比较，并实际查看 PNG。

| 路径 | DPR | 对新开 2 倍页的差异像素 | 本次 capture 耗时 |
| --- | ---: | ---: | ---: |
| 修复前 1→2 | 1 | 28,348 / 242,004（11.71%） | 125.99ms |
| 修复后 1→2，第一次高倍率画面 | 2 | 0 / 242,004 | 550.94ms |
| 修复后 0.5→2，第一次高倍率画面 | 2 | 0 / 242,004 | 538.22ms |
| 修复后 0.5→2→0.5→2 | 2 | 最后 2 倍画面 0 / 242,004 | 降倍率 128.27ms；升回 128.53ms |

修复前 canvas 文字与细线目视模糊，RGB 绝对误差总和 4,966,537；修复后误差为 0。另在修复前 0.5→2 复现快照超时及崩页，修复后没有复现。代价是首次升到更高 DPR 约 0.54–0.55 秒重建，后续在已达到的倍率范围内不重开；节目预览仍由原有一帧截止时间交回回退画面。

探针完整性说明：一次早期复测截图缺少 canvas，未用于最终 canvas 画质结论。已让夹具 ready 等待字体与两次动画帧，并校验每幅 2 倍画面包含 canvas 白底；最终两条升倍率路径均检出 86,868 个白底像素，完整首幅高倍率画面与新开页逐像素一致。最终证据为 `node_modules/.cache/ticket03/final-probe-final-1.json`、`final-probe-final-half.json` 及同目录 `final-final-*-scale-2.png` / `final-final-*-cold-2.png`；降后再升证据为 `final-probe-verified-half.json`。探针脚本及图片均在忽略目录，不纳入提交。

### 验证、审查与遗留

按 testing.md 的共享异步状态流、取消和跨 Electron 边界判为 L2。执行上一节 ticket 03 的全部 20 个文件，额外加入 `src/features/videoEdit/engine/videoEditGpuBudget.ts`，共 **21 个显式文件**；仍只选相同的 11 个直接消费者测试，不扫描其他任务的脏文件。实际执行入口：

```powershell
pwsh.exe -NoProfile -File node_modules/.cache/ticket03/final-verify.ps1
```

脚本内为 `npm run verify:changed -- --level L2`，显式文件/测试清单与完整 npm 实参保存在 `final-verify.ps1` 和 `final-verify.log`；仅该进程树设置 12GiB Node 堆。最终退出码 **0**：11 个测试文件、**318 项通过**，文件级 ESLint、渲染层与 Electron 类型检查、依赖图、主进程导入和 IPC 对账全部通过（0 静态值 SCC、0 冻结跨层边；969 个主进程/preload 文件；435 请求 / 7 消息端口 / 40 订阅事件）。

L2 运行期间，仅将重叠帧测试补为「有压力/无压力」两个分支；补项后该文件 **14 项全部通过**，文件级 ESLint 通过，累计不重复测试为 **319 项**。此后无运行时代码变更，复用已通过的其余 L2 证据，不重复整套。首次定向页面测试的超时来自替身仍向已销毁的旧窗口送 paint，已让它向最新窗口送达；补参数化测试时的局部变量同名编译错误也已修正并重跑。两项均已收口。

按 review.md 末尾的明确安排，独立复审已满 **3 轮，本轮没有追加第 4 轮独立审查**；本轮逐项修复既有重要结论并由主代理核对增量、旧码反例及原生证据，后续由 Claude 读增量与真机验收。增量补丁保存在 `node_modules/.cache/ticket03/final-increment.patch`。

保留的遗留：作者读取占位画面的物理宽高仍为 1×1；同源硬剪点不预开第二页；完整取帧流水线/6.5ms 目标、按屏幕实际尺寸选倍率均未在本轮实现。第 3 轮真机「6150 不再中断、拖动首帧 153–194ms」仍是本轮修改前的已达标证据；本轮遵守禁跑约束，没有重测真片性能，不能把叶子探针或替身测试当作这些指标的改后验收。现有非阻塞预览、拖动取消与松手精确补帧的直接回归已通过。

## 最终真机验收（10-31 12:50，Claude，第 4 轮修复后，开发版重启，窗口最大化，自动渲染暂停）
- L2 复跑（Claude）：11 个测试文件 319 项通过，ESLint、两套类型检查、依赖图、主进程导入、IPC 对账通过。
- 播放 3 秒（各两次）：6150 起 22%、14%；2900 起 57%（冷）、21%；3300 起 43%（冷）、28%。日志 0 条警告/错误。
- 拖动（三组）：第一帧 151–188ms，每次拖动 28 帧，无过时帧覆盖；松手精确帧 76–1927ms（远跳 seek）。
- 结论：验收通过。遗留：完整取帧流水线（6.5ms 目标）、按窗口在屏幕上的实际尺寸定倍率、作者看到的占位宽高 1×1、同源硬剪点预开第二个页面、冷页面首次播放丢帧高。
