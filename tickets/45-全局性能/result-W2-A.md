摘要：图片编辑 GPU 预览出错不再整条退回 CPU：显存不足降档留在 GPU，单帧失败丢帧重试，反复失败才交给 CPU 并按退避自动回到 GPU。
渲染线程与设备改为待命池：应用空闲时预热一个，打开文档直接领用，关闭时清掉会话状态归还待命（只留一个）。降档预览的放大改为双线性，同视口重复选档与高斯包络抖动已去掉。
验证：渲染层 tsc 通过；21 个相关测试文件（含 8 个真实 WebGPU 文件）全部通过；改动文件 eslint、依赖图门禁通过，命名/死代码检查无本任务条目；真实窗口未验证，步骤见文末。

预热接入点：`src/App.tsx`——复用现有空闲预取（`prefetchWhenIdle`，开发版同样推迟 20 秒），动态加载渲染线程池并预热。画布、工具箱、文档、临时导出四条路径都经过同一个池，一处接入即可覆盖。

## 三种错误的新处理（`gpu/imageEditorGpuSceneRuntimeV3.ts`）
- **显存不足**（原生 `GPUOutOfMemoryError`，或被 vGPU、调用方包装在 `cause` 链里的同一对象；只认类型不认文案）：
  先淘汰全部未受保护的缓存瓦片，再调用合成器 `reducePreviewMemory()`——预算逐次减半并重新选档，直到预览至少降一档；
  运行时保持 `ready`，发 `frame-failed`（`outOfMemory: true`），客户端重新请求下一帧。能降档时不计入失败次数；已在最低一档时按单帧失败计数。
  来源有三处：渲染抛出、vGPU `onError`、设备的 `uncapturederror`（原生显存不足只走这里，vGPU 不转发；其他原生错误不处理）。
- **单帧失败**（渲染抛错、瓦片上传失败、vGPU 异步错误）：丢这一帧，设备、合成器、已上传资源都保留，发 `frame-failed`，桥接层立刻请求下一帧。
  连续 3 帧失败，或 2 秒内累计 3 次（异步错误夹在成功帧之间时，只看“连续”会无限重试），才进入回退。
- **回退与回来**：释放合成状态（设备留在设备管理器里），发 `gpu-fallback`；之后 10 秒起按 2 倍退避（最长 5 分钟）重新 initialize，
  成功即发 `ready(recovered)`，桥接层收到后重新请求帧，GPU 帧呈现后会话自动挂起 CPU。出了稳定帧退避从头计。
- **设备丢失**：仍走原有立即恢复；恢复设备在首帧前再次丢失（原来永久停在 CPU）现在也排上述退避重试。设备丢失恢复失败报 `gpu-fallback` 并继续退避。
  Reality 注入的初始化失败、恢复失败保持原样（报 `initialization-failed`，不排重试），巡检场景的断言不受影响。
- 桥接层（`execution/imageEditorRenderSessionGpuBridgeV3.ts`）：`frame-failed` 只重发帧、`deviceReady` 不变、不通知导出；
  `gpu-fallback` 与 `initialization-failed` 同样置 `deviceReady=false`、中止瓦片加载、切 CPU，等 `ready` 才重新启用。
- 客户端：`gpu-fallback` 后重置 ready 去重（重试可能拿到同一设备代际，原逻辑会把这次 ready 丢掉）；`frame-failed` 记 warn 日志 `image_editor_v3.gpu_scene.frame_failed`（带 `outOfMemory`）。
- 原来 vGPU 的任何异步错误都发 `initialization-failed`，客户端随即把整个设备代际标为丢失、后续帧全部丢弃——这条也一并改成单帧失败。

## 预热与归还的生命周期（新文件 `gpu/imageEditorGpuScenePool.ts`）
- 应用空闲 → `prewarmImageEditorGpuScene()`：起一个 Worker，发 `warm`；线程加载模块、申请设备、建 vGPU Context 与一个空合成器，不属于任何会话。
  已有待命线程时什么都不做；巡检注入“GPU 初始化失败”时不预热（要验证从零申请设备的失败路径）。
- 打开文档 → 客户端默认 `workerFactory` 改为向池领用：有待命线程直接拿（日志 `worker_acquired {warm:true}`），没有就新起一个。
  领用后 `initialize` 直接拿到已建好的设备与合成器（预算与会话要求不同才换合成器），不再新建设备。
- 关闭文档 → 客户端 `dispose` 改为 `release()`：池里没有待命线程就发 `release` 留作待命，否则结束这个线程（待命只留一个）。
  线程处理 `release`：推进会话代际（上一个会话在途的初始化、渲染不能再向新会话发事件）、清资源登记表（销毁全部纹理）、清场景与相机/交互序列门、清呈现 Surface、取消导出与重试计时、换一个新的空合成器，然后回 `released`。
  池在收到 `released` 之前把该线程发来的事件全部丢弃（位图关闭），新会话看不到旧会话的任何帧或瓦片请求；多次归还按计数等对应的 `released`。
- 线程脚本出错（onerror）的线程不再放回池里。

## 降档画质（图-6）
- `shaders/imageEditorGpuRasterPresentV3.wgsl`：降档时手写四点双线性（预乘 alpha 直接插值）；原分辨率仍逐像素读取，结果与原来逐位一致。色彩探针写的 `options.y=1` 走原路径。
  临时实测 2→4 像素黑白放大得到 0/137/225/255（线性 0、0.25、0.75、1 的 sRGB 编码），测试文件已删除。
- `gpu/imageEditorGpuRasterPipelineV3.ts`：选档记住“场景、视口（含 interacting 与舞台尺寸）、预算”，同视口重复的 `updateViewport`（宿主每次同步场景后都会再发一次）直接跳过；
  试探更清晰一档失败、回到原档位时恢复原档位的高斯包络，降档时拖高斯参数不再每帧换工作窗口尺寸、重建纹理。

## 待确认两条的结论
- **打开后约 480ms 的 CPU“全图分析”**：查 11-12 日志确认是 `execution/imageEditorRenderSessionCpuWorkV3.ts` 的 `captureSafetyOnce`——GPU 首帧呈现、CPU 挂起后，在分析通道生成一张整图粗分辨率（本例 mip1、4 瓦片、Worker 耗时约 770ms）的“安全帧”，供 GPU 回退时立刻有画面。
  它在后台 Worker 跑，不卡主线程，但占 CPU 与瓦片读取。GPU 可用时可以不走 CPU：现在单帧错误不再回退，安全帧只在设备丢失/反复失败时才用得上。建议二选一：推迟到空闲且无交互时再做；或回退时直接用已有的 CPU 草稿路径、删掉安全帧。文件不在我的所有权内，未改（见遗留 1）。
- **拖调色滑杆时输入被合并（帧间隔中位数 50ms、输入约 30ms）**：桥接层对新场景代际不等上一帧，每次输入都会立刻发 sync-scene + render；Worker 在上一帧合成期间收到新 sync-scene 时，上一帧做完即被丢弃。
  所以“合并”是单帧端到端耗时（主线程 React 投影快照 + Worker 编译场景/同步渲染图/合成）超过输入间隔的结果，不是桥接层主动合并。
  所有权内能去掉的浪费已去掉：每次同步场景后重复的一次选档（降档时还是两次 setViewport）。剩余耗时需要真实窗口用 `--dev-checks` 打开 debug 日志，看 `image_editor_v3.gpu_scene.frame_presented` 里的 `compositionMs`/`presentationMs` 与 `eventToPresentMs` 才能定位；开发版 React 本身偏慢，结论应以 `electron:prod` 为准。

## 改动文件
- `src/features/imageEdit/v3/gpu/imageEditorGpuSceneRuntimeV3.ts`、`imageEditorGpuSceneClientV3.ts`、`imageEditorGpuSceneProtocolV3.ts`、`imageEditorGpuSceneRecoveryV3.ts`、`imageEditorGpuRasterPipelineV3.ts`、`shaders/imageEditorGpuRasterPresentV3.wgsl`
- 新增 `src/features/imageEdit/v3/gpu/imageEditorGpuScenePool.ts`
- `src/features/imageEdit/v3/execution/imageEditorRenderSessionGpuBridgeV3.ts`
- `src/App.tsx`（接入点，3 行）
- 测试：`imageEditorGpuSceneRuntimeFallbackV3.test.ts`（原“单帧失败即回退”用例改写为单帧/连续失败与回来/显存不足三条）、`imageEditorGpuSceneRuntimeV3.test.ts`（+预热与归还）、新增 `imageEditorGpuScenePool.test.ts`、`imageEditorRenderSessionGpuBridgeV3.test.ts`（+单帧失败与回退回来）、`imageEditorGpuRasterCompositorV3.test.ts`（+真实 WebGPU 降档）
- `imageEditorGpuScene.worker.ts`、`imageEditorGpuDirectPresentationV3.ts`、`imageEditorGpuColorProbeV3.ts` 无需改动。

## 验证
- 渲染层 tsc（heavy.sh，12G 堆）：通过，无报错。
- `check-dependency-graph`：通过（App.tsx 新增的是动态导入，不进首屏、不成环）。`check-dead-code`：本任务新增的文件与导出均无命名残留或未使用条目（新文件、导出名按规则不带版本号；其余报出条目属于别的任务）。
- vitest（逐个列出）：
  - 假设备：`gpu/imageEditorGpuSceneRuntimeV3`、`RuntimeFallbackV3`、`ScenePool`、`SceneClientV3`、`SceneProtocolV3`、`SceneSourceGeometryV3`，`execution/imageEditorRenderSessionGpuBridgeV3`、`GpuBridgeTilesV3`、`imageEditorGpuResourceRecoveryV3`、`imageEditorGpuTransformHandoffV3`、`imageEditorRenderSessionGpuCpuBudgetV3`，`export/gpuExportDiagnosticV3`：12 个文件 82 个用例通过。
  - 真实 WebGPU：`gpu/imageEditorGpuRasterCompositorV3`、`ColorPipelineV3`（覆盖色彩探针与呈现着色器）、`DirectPresentationV3`、`RenderGraphV3`、`SparseAnnotationV3`、`GraphSourceGeometryV3`、`SceneExportRuntimeV3`、`BrushHistoryV3`：8 个文件 91 个用例通过。
- eslint：改动的 13 个文件通过（`--max-warnings 0`）。
- 未跑：长基准、导出多尺度、Reality。

## 需要主会话在真实窗口验证
1. 启动开发版，等 20 秒以上并空闲，日志应有 `image_editor_v3.gpu_scene.prewarm.start`。从工具箱打开那张 1152×2048 带调色层的图：应有 `worker_acquired {warm:true}`，`gpu_scene.initialize.start → initialize.completed` 应只剩几到几十毫秒；点开到首帧目标明显低于 1.4s（开发版）。画布双击图片节点同样检查一次。
2. 关闭再打开同一张、再换另一张图：每次 `worker_acquired {warm:true}`，关闭时 `worker_released {kept:true}`；新文档首帧不闪旧图、尺寸与内容正确；任务管理器里图片编辑渲染线程不累积。
3. 降档画质：临时把 `gpu/imageEditorGpuSceneProtocolV3.ts` 的 `IMAGE_EDITOR_GPU_SCENE_DEFAULT_BUDGET_BYTES_V3` 改成 `32 * 1024 * 1024`，打开带调色/高斯模糊的图，帧诊断 `previewRenderScale < 1`：放大应平滑、无像素块；降档时拖高斯模糊参数画面不闪、不跳尺寸。验完改回。
4. 回归：Reality `--only` GPU 设备丢失恢复相关场景（8192 瓦片与 recovery 成功/失败、源全隐藏回退）确认行为不变。
5. 显存不足与“回退后回来”只能注入验证（本机 4090 触发不了），已由单元测试覆盖；正常路径只需确认日志里没有新的 `frame_failed`。

## 偏离
- 失败计数在“连续 3 次”之外加了“2 秒内累计 3 次”：异步上报的错误夹在成功帧之间时，只看连续次数会形成无限的“出帧—报错—重发”循环。
- 预算“减半”实现为“逐次减半直到至少降一档”：只减一次常常不改变档位，下一帧会照样显存不足。
- 新文件 `imageEditorGpuScenePool.ts` 与新导出（`prewarmImageEditorGpuScene`、`acquireImageEditorGpuSceneWorker`、`isImageEditorGpuOutOfMemoryError`）不带 V3：命名检查禁止新增版本号，和目录里存量命名不一致是有意的。
- 合成器的降档方法 `reducePreviewMemory()` 没写进 `imageEditorGpuRasterPipelineContractsV3.ts`（不在所有权内），运行时用类型守卫按可选能力调用。

## 遗留
1. `execution/imageEditorRenderSessionCpuWorkV3.ts` 的安全帧（见上文结论）：建议推迟到空闲或删除，GPU 正常时打开文档可省约 0.5–0.8s 后台 CPU。
2. GPU 初始化期间 CPU 草稿与 GPU 抢跑：日志显示打开时 CPU 的 draft/target 与 GPU 初始化同时开跑，GPU 首帧一到就被取消。这由 `execution/imageEditorRenderSessionV3.ts` 的 `scheduleCurrentWork` 决定，不在所有权内。建议：池领用到预热线程时由客户端→桥接层告诉会话“GPU 马上可用”，会话在首个 GPU 帧或桥接层回退回调之前不排 draft/target，并设约 300ms 看门狗兜底。
3. `gpu/imageEditorGpuRasterPipelineContractsV3.ts` 建议给 `ImageEditorGpuRasterCompositorV3Like` 补可选方法 `reducePreviewMemory?(): boolean`，届时去掉运行时里的类型守卫。
4. `gpu/imageEditorGpuSceneTileAdmissionV3.ts` 失败时只回传文案、丢了错误对象，上传路径同步抛出的显存不足无法识别（实际原生显存不足是异步上报，已由设备监听覆盖，影响很小）。
5. 降档后预算不会回升：同一会话里显存一旦报不足，预览就保持较低档位，直到关闭文档（归还时换新合成器，预算恢复默认）。

## 第二轮（真实窗口反馈：预热没生效、冷路径变慢）
- **12 秒内没预热的原因**：预热排在 App.tsx 的浮层空闲预取链末尾，开发版这条链先推迟 20 秒，且空闲回调不带超时。日志可证：11:44:53 重载，11:45:16 打开（warm:false），11:45:19 才 `prewarm.start`；11:45:47 再重载，11:45:49 打开又是 warm:false。实测流程每次都是“重载后 20 秒内打开”，所以从来领不到预热线程。
- **之前三次 prewarm.start 没有后续**：当时只记了开始、没有完成事件（不是卡住）；那几次预热线程都被随后的页面重载结束了。现已补 `prewarm.completed {durationMs}` / `prewarm.failed {durationMs, reason}`（Worker 处理完 warm 回 `warmed` 事件；线程脚本出错也记 failed）。
- **冷路径变慢约 0.5 秒**：日志显示那次 1.83 秒的打开正好撞上开发版 20 秒浮层预取（另一次 1.61 秒的打开撞上 15 秒的工作区预取）；离重载 2 秒、没撞上预取的那次是 1.39 秒，与改动前持平。我这边唯一可能拖慢冷路径的，是“预热在已有会话占用线程时又起第二个线程”（11:45:19 那次就是），已改成线程被使用时不预热。冷路径本身领用与初始化的步骤和改动前完全相同。
- **改法**：
  - `src/App.tsx`：预热从浮层预取链拿出来，首屏后 `requestIdleCallback(..., { timeout: 2000 })`，开发版不再推迟。
  - `src/workspaces/toolboxTools/imageMark/entry.ts`（新增接入点）：进入图片工具页（工具组件首次加载）立即预热。日志里打开文档前还要花约 4 秒加载编辑器，正好把冷启动藏进去。
  - `gpu/imageEditorGpuScenePool.ts`：线程状态 `warmth`（ready / warming / failed / cold），归还时按 `released.deviceReady` 判断是否仍是 ready；有会话正在使用线程时不预热。`worker_acquired` 带 `warm` 与 `warmth`。
  - `execution/imageEditorRenderSessionV3.ts`：领到 warmth=ready 的线程时不排 CPU 草稿/目标，GPU 首帧呈现、GPU 回退、300ms 看门狗三者先到哪个就结束等待。
  - `execution/imageEditorRenderSessionCpuWorkV3.ts`：安全帧改为 GPU 首帧后等 2 秒，再在空闲时做（空闲回调超时 3 秒）；开做时读当前快照与视口。取消、隐藏、换文档会撤掉排着的这一次。
- **验证用的计时日志**：
  - `image_editor_v3.gpu_scene.first_frame {warmth, acquireMs, initializeMs, firstFrameMs}`：每个会话第一次呈现 GPU 帧时记一条；`firstFrameMs` 从会话建立（预览区挂载）算起。
  - `initialize.start` 带 `warmth`，`initialize.completed` 带 `durationMs`。
- **验证**：渲染层 tsc 通过；18 个测试文件通过（池、运行时、运行时回退、客户端、源几何、桥接、桥接瓦片、资源恢复、变换交接、导出诊断、GPU/CPU 预算、会话、会话排程、表面重挂、视口合成 hook、显示管线、工具箱工作区、工具箱登记一致性）；12 个改动文件 eslint 通过；依赖图门禁通过。
  - 测试改动：GPU/CPU 预算测试里 8 处“首帧后立即有安全帧请求”的断言改为推进 2 秒后再断言，并加一条“首帧时还没有安全帧”；新增一条“领到预热线程先等 GPU 首帧、300ms 看门狗兜底”；池测试改写为两条（预热完成→ready、使用中不预热；归还丢旧事件→再领用为 ready）；运行时测试补 `warmed` 与 `deviceReady` 断言。
- **请主会话实测**：重载 → 等 3 秒以上 → 打开。日志应依次有 `prewarm.start`、`prewarm.completed`、`worker_acquired {warm:true}`、`first_frame {warmth:'ready'}`，目标 `firstFrameMs ≤ 300`。冷路径对比：`first_frame {warmth:'cold'}` 的 `initializeMs`，要避开开发版重载后第 15、20 秒的预取窗口。

## 第三轮（审查意见：1 条重要 + 8 条小问题）
- **重要 1 退避清零过早**：失败计数与退避统一收进 `gpu/imageEditorGpuSceneRecoveryV3.ts`（`recordFrame` / `recordFailure` / `noteError` / `resetFailures`）。退避只有在 GPU 持续 10 秒且 30 帧都没有新错误时才清零；任何错误（包括只请求重绘、不计数的异步错误）都会打断稳定计时。新增 `imageEditorGpuSceneRecoveryV3.test.ts`，覆盖 2 秒窗口计数（成功帧夹在中间、滑出窗口不算）、连续 3 帧、退避 10/20/40/80/160/300/300 秒，以及“头几帧成功不清零、帧数够时间不够不清零、15 秒 31 帧才清零”。
- **2 同一错误计两次**：运行时监听到的 vGPU 异步错误不再计数，只请求重绘一帧；计数只来自渲染抛出。直呈 Surface 失效由呈现器自己降到 ImageBitmap，不计数；ImageBitmap 提交时抛出的才算一次。显存不足错误按对象去重，监听与渲染抛出两条路只降一次档。
- **3 迟到错误**：记录最近一次发起渲染时的会话代际，异步错误只归到已发起过渲染的当前会话。
- **4 继承丢失历史与首次失败**：没有改设备管理器（`src/core/imageEdit/webgpu/deviceManager.ts` 不在所有权内，且正被别人改着）。改为 `released` 带 `deviceLossHistory`（近期丢失过或在冷却期），待命池不留这种线程、换一个新线程预热。设备丢失恢复成功和每次重新初始化成功后，失败计数清零。首次 initialize 失败也报 `gpu-fallback` 并按退避重试（不用 `initialization-failed`：它会让客户端把设备代际标为丢失，设备仍在时重试成功的 ready 会被挡掉）。Reality 注入的失败路径不变。
- **5 待命设备丢失**：待命线程收到 device-lost 就重新预热（warmth 回到 warming，完成后才是 ready）。
- **6 回退空白**：`execution/imageEditorRenderSessionV3.ts` 在 GPU 画布正显示、而 CPU 还没有任何帧时，回退先不撤 GPU 画布：CPU 帧照常画进被盖住的稳定表面，第一张画好再撤 GPU 画布。GPU 回来、换文档、换表面都会清掉这个状态。
- **7**：`reducePreviewMemory` 没有预览视口时直接返回 false，不动预算（真实 WebGPU 测试已补断言）。
- **8**：待命池加 `import.meta.hot.dispose`，热更新时结束旧池的待命线程；仍在用的线程归还到旧池时直接结束。
- **9**：保留一条真实 WebGPU 的双线性测试：半分辨率黑白两像素放大到 4 像素，与 0/0.25/0.75/1 线性插值的 sRGB 编码相差不超过 1。
- **预热触发收紧**：首屏后不再无条件预热，只在“近 7 天用过图片编辑”时预热（领用线程时把时间写进 localStorage `henji.imageEditor.gpuScene.lastUsedAt`）；进入图片工具页照常立即预热。
  - 取舍：没用过图片编辑的人启动后不再常驻渲染线程和 GPU 设备。代价是这类人第一次从画布打开图片走冷路径（工具页入口不受影响）；用过的人启动后常驻一个线程和一份设备。
- **验证**：
  - 测试：19 个文件通过（新增 `RecoveryV3.test`；池、运行时、运行时回退、客户端、源几何、真实 WebGPU 合成器与色彩、桥接、桥接瓦片、资源恢复、变换交接、导出诊断、GPU/CPU 预算、会话、排程、表面重挂、视口合成 hook、工具箱工作区）。
  - eslint：17 个改动文件通过。
  - 渲染层 tsc：本任务文件无报错；只剩 `src/features/videoEdit/engine/videoEditEncodedVideo.test.ts` 的 2 条（别的执行者的文件）。
  - 待真实窗口确认：预热路径首帧后人为触发回退（Reality 设备丢失注入），画面不应空白；Reality 的 recovery failure 场景在 1.2 秒时检查 GPU 画布已隐藏——那时若还没有任何 CPU 帧，GPU 画布会继续显示到第一张 CPU 帧画好，需要跑一次确认。
  - 新增用例：退避与窗口 3 条；异步错误不计数与迟到错误 1 条；首次初始化失败重试 1 条；待命设备丢失与带丢失历史的归还 1 条；回退保留 GPU 最后一帧 1 条；双线性 1 条。
