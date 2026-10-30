# 01/02 交叉审查（Opus xhigh，第 1 轮）
结论：1 条必须改、13 条建议；未发现当前快照下复用旧预览的键漏项。
处理：全部交 Codex 返工（第 11 条先核实再定）；另加实测问题“撤回到已算过的版本后约 4 分钟才变回 ready”与“导出使用预览默认关”。

## 必须改
1. `videoEditRenderCache.ts:620`（另 :465、:694-699）用 `instance.document !== document` 判断内容变化；写创作意图、导出记录、改名会换 document 但不增 contentVersion → 手动/助手渲染被静默取消、删除渲染文件抛 AbortError。改用 contentVersion，与指纹调度 `alive()` 同口径。

## 建议（已决定全部处理）
2. `videoEditRenderFingerprints.ts:41/49` 帧表缓存键含整份 media/scenes/全部 webContent/整个 clip JSON（含 name）→ 无关改动清空全部帧表、绿窗口变 pending。键只含该片段实际读取的素材、场景、网页和 pictureClip。
3. `:66/146` `alive()` 只看 contentVersion，字体/分析/网页变化不取消旧快照；全局 FIFO 与 `pruneEntries` 触发的其他序列整片指纹排在当前序列前。
4. `:12/50` `owners` 缓存从不淘汰，长会话内存只增。
5. `:128-136` Worker 偶发失败把缺帧永久写成 `fingerprint-session-failed`。
6. `videoEditRenderCache.ts:693-697` 删除渲染文件每 20ms 轮询等指纹、无取消无超时，导出或拖动时一直占着 `clearing`。
7. `:180` 与 `videoEditRenderFingerprints.ts:113` 每算完一个区间就 publish，节目线程重算全部窗口（量级待测）。
8. `videoEditAuthorFingerprint.ts:12` dataFiles 可排除入口文件 → 入口画法改动不进代码身份，可能复用旧画面（按必须改处理）。
9. `videoEditRenderCache.ts:467` scope needed 把 pending 一律算 predicted，指纹就绪后不再按实测过滤。
10. `videoEditRenderer.ts:1850-1852` 预取打开失败后每个现场帧重复打开同一个坏文件。
11. 导出把项目标为已加载，节目监视器没打开时导出后 3 秒自动渲染也会开跑（不确定，先核实）。
12. `tests/fixtures/persistence/document.screen_recording/v46.json` 没有 `usePreviews`。
13. `exportPresets.ts:39/55`、`kinds/videoEdit.ts:140` 把 `?? true` 物化成显式 true，改默认需同时改物化与内置预设、迁移注释。
14. `videoEditRenderTransport.ts:312` 与 Worker 单帧 fingerprint 分支无调用方，弃用残留。

## 第 2 轮复审（Opus high）
14 条与 2 条实测问题均已解决；真机复测：撤回后 2 秒内 ready，未改段约 10 秒恢复，拖动与播放不退步。
修复引入：
- 必须改：`videoEditRenderCache.ts:177-178、:208-210` + `videoEditRenderFingerprints.ts:111` 跟踪/智能区域分析每个进度事件都 `fingerprintEnvironmentRevision++`，`environmentCurrent()` 变 false，指纹中止并新建 Worker 重来；分析期间指纹几乎不前进。改为比较实际环境字符串（字体版本 + analysis JSON + 网页身份）。
- 建议：`videoEditRenderCache.ts:468` needed 模式 `onStarted.requestedFrames` 含指纹未就绪窗口，之后可能被剔除，助手拿到的计划偏大。

## /code-review（high）
6 条，全部交返工：
1. 必须改：`videoEditRenderFingerprints.ts:87` 帧表键按原始 `clip.code.parameters` 找场景，媒体却按解析后参数；只靠声明默认值引用的场景改了记录时帧表键不变，复用旧指纹 → 旧预览播放或导出。
2. 必须改：`:123` 导出时 `busy` 让指纹计算整体暂停，改代码后立即导出拿不到任何预览复用。
3. 建议：`:91` 每次读取都对整份场景记录等 JSON 序列化并散列，节目线程每 50ms 一次；按合成对象缓存键。
4. 建议：`:123` 任一工程拖动或导出都暂停所有工程的指纹计算，只看本实例。
5. 建议：`videoEditExportPreviews.ts:13` 每次导出四次整份合成 JSON 序列化比较。
6. 建议：`:39` `trim` 就地清空被淘汰帧表，仍被快照持有的结果随之变空；只从缓存移除，不清 frames。
