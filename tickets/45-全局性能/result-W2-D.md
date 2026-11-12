摘要：B2 B3 B6 改完：试听/擦洗取块按作品快照对象缓存渲染源、直接随机读浮点 WAV（兼容 RF64）不起 FFmpeg，渲染层一秒块按内存预算淘汰且原素材/剪后各留一份；拖滑杆的中间更新只比较、只校验改到的顶层字段，松手整份校验一次，历史步骤名按快照对缓存；区间音量、呼吸与成片拼接挪进效果工作线程，主进程只派活。
验证：electron tsc 通过；渲染层 tsc 只剩别人的 videoEdit 错误（本任务测试文件的类型错误已修）；13 个相关 vitest 文件全过（1 个性能用例按环境变量跳过）；19 个改动文件 eslint 0 问题。
没动作品格式、素材身份字段和 splice.ts；没改 .tsx，未跑 check:surface。

## 逐条改法

### B2 试听与擦洗取块
- `project-store.ts`：新增 `readAudioEditProjectSnapshot`。文件没变时返回同一个深冻结对象，不复制；`requireAudioEditProject` 改为在它上面 `structuredClone`，行为不变。
- `preview.ts`：
  - 按 `作品 id + 模式` 缓存渲染源路径的 Promise，命中条件是快照对象身份相同（文件一保存就换对象）。同一版本只走一遍 `prepareAudioEditRenderSource`（schema、verify、stat 链）。
  - 渲染源是同采样率、同声道的浮点 WAV 时用 `openF32Wav` 保持句柄直接读（RIFF/RF64 都支持）。最多 4 个句柄，闲置 10 秒关闭，避免 Windows 上缓存清理删不掉文件。不是浮点 WAV（例如自管素材的原文件）时仍按块走 FFmpeg。
- `pcm-wav.ts`：直接读进输出缓冲，不再经过中间 `Buffer.alloc` 清零再复制；可传入复用缓冲；短读循环补齐。
- `previewChunkCache.ts`：从固定 30 块改为按字节预算淘汰。预算是 `audioDisplayCacheBudget` 波形预算的一半，64 GB 机器约 512 MB，保底 64 MB。
- `useAudioEditPreview.ts`：原素材与剪后声音各留一份块缓存，切换试听模式不清空；`soundKey`/`planKey` 改为按依赖记忆。
- 证据：`preview.test.ts`“同一版本连续取 6 块只推一次渲染源、不调 execFile；作品一变才重新推”；`pcm-wav.test.ts` 复用缓冲越界清零；`previewChunkCache.test.ts` 按预算淘汰。

### B3 每次编辑的整份序列化与校验
- `audioEditProjectInstances.ts`：
  - `sameJson` 整份比较和 `hasUndoableChanges` 整份序列化，都换成 `changedFields`：引用相同的顶层字段直接跳过，只对换了引用的字段做 JSON 比较。
  - 连续拖动期间（`beginAudioEditGesture`）只用 `schema.shape[字段]` 校验改到的字段；松手时整份 `parse` 一次，不通过就回到拖动前并抛错。非拖动的单次编辑仍整份校验。
  - 只改了被规范化覆盖的字段（id、name、editBaseline）时，按无变化处理，不再白增修订号。
- `audioEditHistory.ts`：步骤名按（前快照, 后快照）放进 WeakMap 缓存，历史面板重列时旧步骤直接命中。
- `useAudioEditSilencePreview.ts`：键只在相关字段换引用时重新序列化（原来每次渲染都序列化整段转写）。
- 证据：`audioEditProjectInstances.test.ts`“拖动滑杆的中间更新不整份序列化、不整份校验……”，5 次中间更新时 `audioEditProjectSchema.parse` 0 次，`JSON.stringify` 从未收到转写或整份作品；松手后 1 次；合成一步撤销。`audioEditWorkspace.test.ts`“同一对快照只比较一次”，重列历史时 `JSON.stringify` 0 次。

### B6 主进程搬运 PCM
- 新增 `pcm-jobs.ts`：区间音量/呼吸（`gains`）与成片拼接（`splices`）的整段实现。块大小改为 8 秒；增益处理复用同一块缓冲；逐采样结果与分块大小无关。
- `effects-worker.ts`：同一个打包入口按 `job.kind` 分派，没有新增 vite 入口和 knip 配置。
- 新增 `pcm-worker-client.ts`：启动线程，取消时等线程退出再返回，让缓存层能删掉半成品。
- `render.ts`：两处都改成在主进程把源转成浮点 WAV（已有缓存）后派活。删掉主进程里的逐秒读写循环和 `openRenderSource`。
- 证据：`render.test.ts` 断言一次渲染派出 `['gains', 'splices']`，拼接用例只派出 `['splices']`；原有关于输出采样值、交叉淡化无跳变、缓存复用的断言照常通过（测试里同进程跑同一份 `runAudioEditPcmJob`）。

### 日志
- `audio_edit.preview.source.completed`：每版本一次，带 mode、revision、durationFrames、sampleRate、channels、elapsedMs。
- `audio_edit.preview.chunk.completed`（debug）/ `audio_edit.preview.chunk.slow`（≥200 ms，info）：带 sourceStartFrame、frameCount、durationFrames、direct（是否直接读）、elapsedMs。
- `audio_edit.render.completed`：补 sourceFrames、durationFrames、sampleRate、channels。`failed` 补 elapsedMs、sourceFrames。

## 偏离
- 渲染源缓存放在 `preview.ts`，按快照对象身份命中，没有放进 `prepareAudioEditRenderSource`：其他调用方（导出、频谱）传入的是克隆对象，带 signal，放在那里语义不清。
- `AudioEditPanels.tsx` 不用改：缓存在 `describeAudioEditStep` 里，面板的 `useMemo` 照旧。
- 加改了 `useAudioEditSilencePreview.ts`（同目录，B3 同类：每次渲染都序列化整段转写）。
- B2 的“非浮点源走常驻原生解码会话”没做：项目自己生成的渲染源都是浮点 WAV，只有自管素材的原文件可能不是，这种情况保留逐块 FFmpeg。
- 渲染源命中时不再每块 `verifyAudioEditSource`。原素材被替换时，下一次保存（快照换新）或任何编辑都会重新校验；读的是项目缓存里的派生文件，不受原素材变化影响。

## 遗留
- `spectral-pyramid.ts`（W1-D 的文件，我没改）每取一块频谱仍调用 `requireAudioEditProject`（克隆）+ `prepareAudioEditRenderSource`。可以改用 `readAudioEditProjectSnapshot`，并复用同样的按对象身份缓存。
- A4 ④ 精细波形回读直接随机读 f32（`ops.ts`），现在可以复用 `openF32Wav` 的新读法。

## 遗留：需主会话验证
1. 先 `npm run electron:bundle`（新增了工作线程分派，worker 产物要更新）。
2. 打开一小时口播并播放：看 `audio_edit.preview.source.completed` 的 elapsedMs（首块延迟）；播放中不应出现 `audio_edit.preview.chunk.slow`；整段播放期间任务管理器里不应反复冒出 ffmpeg 进程。
3. 拖动播放头试听：听感与改前一致（不变调、不黏糊、干脆）。擦洗算法没动，只换了取数据的路径；对比 `audio_scrub.session.completed` 的 meanReadMs、slowestReadMs。
4. 在这份作品上拖“输出音量”或效果参数滑杆：应跟手。松手后历史面板只多一步。
5. 加一处区间音量后导出 WAV：导出期间界面其他操作（滚动、点选）不卡；与改前导出的 WAV 应逐样本一致。
