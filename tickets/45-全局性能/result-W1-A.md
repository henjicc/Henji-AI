摘要：图片编辑器的预算已全部改成“只淘汰缓存、不拒绝”，总账与各缓存按机器内存放大（8 GiB 及以上取 4 倍）。
改动前会抛错或报错的路径已全部删除：最粗 mip 抛错、全局分析缓存抛错、导出共享预算断言、导出账本拒绝、单帧传输上限、点选缓存报错、缩略图内存报错。
验证：两条 tsc 中只剩 W1-B 的 video-decoder 报错；25 个测试文件、132 个用例通过，其中包括真实 WebGPU 的多尺度导出测试；改动文件的 eslint 通过。

## 做法
- `src/core/imageEdit/v3/resourceBudget.ts`
  - 新增 `IMAGE_EDIT_MEMORY_SCALE` 和 `scaleImageEditCacheBytes()`：以 2 GiB 为 1 倍，读 `navigator.deviceMemory`（浏览器最大只报 8，所以大内存机器取 4 倍）；拿不到时按 8 GiB 算。用 `globalThis` 读取，没有 DOM 也能编译。
  - 默认值随之变为：总账 5 GiB、CPU 缓存 2 GiB、GPU 1.25 GiB。
  - `admission()` 去掉 `admitted`，只返回压力档位（hard/soft/normal）和建议；`acquire()` 只记账，永远返回租约。
- 图-4 拒绝点逐个处理：
  - 视口合成候选与瓦片缓存：hard 压力只用来换更粗的 mip。
  - 规划器：最粗一级仍超出也照样使用。
  - 瓦片缓存：in-flight 和插入都先淘汰未租用的条目，淘汰完照样分配。
  - 全局分析：本帧用到的分析结果直接持有到下一次 prepare，缓存放不下也照样出图。
  - 导出：按压力减少并发区域后照样执行；删除 1.25GiB 半径预检和 `acquireOrThrow`。
  - 柔光、模糊、辉光、画笔、蒙版的“账本拒绝”分支都已删除。
  - 预览与视口的 `ImageEditorResourcePressureErrorV3` 整个文件删除，连同“降档重试”分支。
  - 单帧传输上限（预览画笔 128MiB、视口 256MiB）的报错也一并删除。
- 图-3 `imageEditorGpuSceneExportRuntimeV3.ts`：删除 `assertSharedBudget`、`assertCompositorBudget`。新增可选回调 `trimPreviewMemory`，在导出开始、上传瓦片、全局分析前调用，让预览先淘汰未受保护的缓存。预算只作为导出 compositor 的内存目标（只影响压力统计）。导出分块仍固定 512，像素结果不变。
- 图-5 点选缓存：超出目标（64MiB×系数）后，新图层的命中图按 4×4 取最大值降采样，所有图层仍可点选，不再报错。
- 图-7 按系数放大：预览代理、预览画笔缓存、帧缓存、查找表缓存、导出解码缓存、几何工具的读取分块与源缓存、选区分块、修复源与覆盖缓存、全局分析缓存、缩略图条数。

## 偏离与需要别人改的
- 需要 Runtime 的负责人接一行：`imageEditorGpuSceneRuntimeV3.ts` 创建导出运行时的地方要传入
  `trimPreviewMemory: (bytes) => trimImageEditorGpuSceneMemoryV3({ resources: this.resources, preview: this.states.peek()?.compositor ?? null, exportResidentBytes: bytes })`。
  不接时导出照样能跑（已不再报错），只是开始导出时预览不会主动让出显存。
- 导出分块大小保持 512，没有改成“按预算决定”，以保证导出像素与现在一致。导出分块在 `export/gpuExportSessionV3.ts` 里由请求固定为 512。
- 单帧传输上限不在排查表里，按“放开就删”的约束一并删除了。

## 碍事就清（测试）
- 删除两条只断言旧拒绝行为的用例：`imageEditorPreviewClientV3.test.ts`“预算不足时在启动 Worker 前返回降低预览尺寸信号”、`viewportCompositeClientV3.test.ts`“成品 GPU 预算不足时不调用 Worker”。它们保护的就是已删除的拒绝路径。
- 改写四条用例，改为断言新行为（超出照样执行）：
  - `resourceBudget.test.ts`“超过总账只报告压力”
  - `viewportTilePlannerV3.test.ts`“最粗层仍超预算也照样出图”
  - `viewportTileCacheV3.test.ts`“全局账本吃紧插入照样成功”
  - `imageEditorGpuSceneExportRuntimeV3.test.ts`“先让预览淘汰缓存，仍超出也照样导出”

## 遗留
- `src/core/imageEdit/v3/renderCaches.ts` 的 `if (!lease) return false` 已成死代码，但文件不归我。
- `scripts/dead-code-baseline.json` 里残留已删除的 `ImageEditorViewportAdmissionErrorV3` 条目，文件不归我。
- `export/contracts.ts` 的 `WORKING_SET_EXCEEDED` 只剩安全整数溢出一处在用。
- 没有用 8K 多图层大图做真实窗口验证。

## 审查返工（第 2 轮）
1. 已接上：`gpu/imageEditorGpuSceneRuntimeV3.ts` 创建导出运行时时传入 `trimPreviewMemory`，写法与 admitTile 一致，只改了这一处。
2. `imageEditorSessionResourceBudgetV3.test.ts` 改为断言：两个会话的租约记到同一个全局账本（共 1001 字节、2 个租约），释放后清零，最后一个使用者离开后账本移除。
3. `scripts/image-editor-v3-performance-bench.ts` 改为新语义：满账后 admission 只报告 hard 压力，`acquire` 照样分配并记账；输出字段 `hardRejectionAvailableBytes` 改名为 `hardPressureAvailableBytes`。
4. 死代码：
   - 已删：`renderCaches.ts` 的 `if (!lease) return false`；资源登记表的空租约分支，以及 `register`、`prepareAdmission` 返回值里的 `admitted` 字段（同步改了测试；Runtime 里 `result.admitted` 属于瓦片上传结果，是真实的上传失败语义，保留）。
   - 保留：`imageEditorPreviewResourcesV3.ts` 的 `insertProxyCache` 返回值不是死代码。会话已释放或单个代理大于缓存上限时返回 false，调用方据此改记临时 in-flight 租约。
   - `scripts/dead-code-baseline.json` 删除 6 条：已删文件 `imageEditorResourcePressureV3.ts` 及其 3 个导出，`IMAGE_EDITOR_VIEWPORT_MAX_TRANSFER_BYTES_V3`，`ImageEditorViewportAdmissionErrorV3`。
   - `npm run check:dead-code`：knip 部分无新增；命名检查仍失败，但报出的条目里已经没有本任务的，剩下的是其他任务的（viewportNavigationV3、ImageEditorGpuTileAtlasBudgetErrorV3、ImageEditorDockChromeV3、colorGradeMigration 等）。
5. 内存倍数改用真实物理内存。
   - 入口：渲染层已有 `getPlatform().system.memoryInfo()`（主进程 `os.totalmem`，音频缓存已在用），没有新增 IPC。
   - 倍数为 总内存 / 16GiB，夹在 1–8 之间：64GB 机器为 4 倍，128GB 及以上为 8 倍。
   - 读取时机：第一次领取编辑会话账本时异步读一次，到达前按 deviceMemory 估算。账本省略的目标值随系数实时取值。
   - 预览代理、画笔、点选、缩略图、几何工具、导出解码缓存都改为用到时才取值。
   - Worker 内的缓存（查找表、全局分析）拿不到平台接口，仍按 deviceMemory 估算。
   - `IMAGE_EDIT_DEFAULT_*` 常量换成 `imageEditDefaultBudgetBytes()`，`IMAGE_EDIT_MEMORY_SCALE` 换成 `imageEditMemoryScale()`。
   - 新增一条用例，断言 64GiB 为 4 倍、512GiB 封顶 8 倍，以及已建账本的目标随之更新。
6. `renderExportTilesV3.ts` 加回物理保护：单个带 halo 的 Float32 RGBA 工作面超过 2GiB（类型化数组单次分配的可靠上限）时，导出给出明确失败并提示减小半径。注释写明这是物理限制，不是预算；其余情况照常放行。
7. `viewportCompositeClientV3.test.ts` 新增“Worker 渲染前出错时归还源帧与传输、工作集、成品三份租约”：让画笔瓦片读取在三份租约到手后失败，断言源帧释放一次、账本归零、未发送 Worker 渲染。

验证（第 2 轮）：
- 18 个测试文件、106 个用例通过：resourceBudget、renderCaches、资源登记表、会话账本、视口客户端、导出运行时、Runtime 及其回退、导出瓦片与生命周期、瓦片缓存与调度、预览资源与客户端、缩略图、几何工具、修复源、sourceRegion。
- 两条 tsc 均无报错（渲染层需加 `--max-old-space-size=12288`，否则内存不够中途崩溃）。
- 改动文件的 eslint 通过。
