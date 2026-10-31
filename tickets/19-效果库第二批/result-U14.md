摘要：U14 已实现代码效果反向入库成风格件，界面只提供数据与接口，未修改 TSX。
摘要：独立干净上下文审查 1 轮，2 项重要问题与 1 项小问题均已修复；真实 Dawn GPU 用例通过。
摘要：最终 L2 与三个指定专项门禁全部通过，提交 fa4cf7ca2；未推送、未合并回 main。

# U14 代码滤镜入库

## 分支与范围

- 工作目录：`D:/VibeCode/Henji-AI-t19u14`。
- 分支：`task/19-U14-代码滤镜入库`。
- 提交：`fa4cf7ca2`（`feat(video-edit): 支持代码滤镜保存为风格件`），44 个文件；提交后任务工作区干净。
- 已再次执行 `git merge main`，显示 Already up to date；当前实现基于 `d529d407f`，六种格式按此 main 顺延。
- 依据：本目录 `design.md` 第 10 节、第 12 节及末尾 Claude 裁定。
- 没有修改依赖，没有安装、删除或重建 node_modules / FFmpeg 联接点；没有启动开发版、占用 9334 或访问 `D:/视频制作`。

## 已落实

1. `VideoEditEffectPreset.codeSnapshots[效果实例 id]` 保存代码成员快照：`version` 直接复用 `codeMaterialVersionSchema`，保留源码入口、全部文件、固定组件依赖、作者 API、语言版本与锁定库版本；`codeSources` 复用源码内容表，`params/types` 沿用正式作者声明解析器。
2. 应用时核验全部源码 SHA-256，重建固定依赖闭包，复用现有 `portableCodeComponentFiles` 生成独立源码，再经正式代码存储写入当前工程。复用身份由源码内容、作者 API、锁定库与来源共同决定；不会把外来代码变成本机代码。未使用历史版本读不到时保留诊断，继续从完整快照导入。
3. 旋钮可映射内置效果及代码滤镜的 number / angle 参数，按声明硬范围校验；默认值归一化进成员参数，映射只移除对应参数的曲线，其他参数与曲线保留。
4. 图片、视频、音频参数携带媒体依赖身份与路径；片子数据保存完整副本。应用及预览重映射媒体、片子数据引用；重复应用复用相同媒体、片子数据和源码。媒体核验与导入复用代码资产的共同领域实现。
5. 异步片段应用与助手 creation_items 共用快照重建；试渲染、取消与内容变化检查通过后原子提交，源码、媒体、片子数据和目标效果共用一次剪辑撤销。失败不发布部分文档，并走既有源码补偿入口。
6. 分享风格包、剪辑预设包、外部文档与工程导入均覆盖代码成员的外来来源。导入只读数据；首次执行前，包括读取声明和预览，仍走现有外来代码确认。本机保存的源码不新增外来标记。
7. `look()` 保持拒绝含代码成员的风格件；代码成员只上片段。
8. `video_edit.effect_preset` 通用创建支持 `effects: [{id?, ref: video_edit.effect 引用}]`，宿主解析并嵌入快照；整体修改同样支持。保存口味前向用户确认一次，沿 ticket 13 的规则；没有新增专用助手工具。
9. 完整 definition 的替换会清除省略的旧快照，允许代码风格件改成纯内置风格件。相关实体、公共创建模板、派生读回与副作用回执已同步。

## Claude 界面接入接口

### 1. “风格件”文件夹的数据

文件：`src/features/videoEdit/application/videoEditEffectPresets.ts`

```ts
listVideoEditStylePieces(projectId, sequenceId): VideoEditStylePieceEntry[]
// entry = { ref, preset, styleId?, styleName? }
```

- 返回全局风格件和当前序列绑定的工程风格副本中的风格件，保留各自归属，同名项有不同 ref。
- `ref` 是应用及列表 key；全局为 `preset:<id>`，风格成员为 `style-preset:<编码的风格 id>:<编码的风格件 id>`。界面应直接使用返回值，不自行拼解析规则。
- 名称、说明、用途、旋钮读 `entry.preset`；归属读 `styleId/styleName`。
- 订阅全局库：`useVideoEditEffectLibraryStore` 的 `revision/presets`；订阅工程、序列绑定变化：`videoEditService.ts` 的 `subscribeVideoEditDomain` 与正式剪辑状态。
- 不要把风格成员先交给旧 `videoEditUserPresetEntries` 丢掉归属；旧函数只认识全局预设引用。

### 2. 应用到片段

文件：`src/features/videoEdit/application/videoEditCompositing.ts`

```ts
await applyVideoEditStylePiece(
  projectId, sequenceId, clipIds, entry.ref,
  knobValues = {}, signal?
): Promise<string[]> // 新效果实例 id
```

- 同时支持纯内置与含代码成员的风格件、多个片段、一步撤销。
- 按媒介选择适用片段，跳过锁定轨道；没有适用目标时报错。智能区域仍受正式片段校验约束。
- 界面双击、拖放的风格件分支应 await 此入口。旧同步 `applyVideoEditBuiltinEffect` 继续服务内置效果；含代码成员时会给出明确提示。

### 3. 从片段效果保存

文件：`src/features/videoEdit/application/videoEditStyleCode.ts`

```ts
await snapshotVideoEditStyleEffects(projectId, effects, signal?)
// => { effects, codeSnapshots? }，只获取快照，不写库

await saveVideoEditStylePieceFromEffects(projectId, {
  name, media, effects, description?, usage?, knobs?
}, signal?): Promise<VideoEditEffectPreset>
```

- 保存对话框确认后使用第二个接口；名称、说明与旋钮在调用方确定，宿主负责捕获固定源码与依赖。
- 风格包内成员可先获取快照，再沿现有 `videoEditStyleLibrary.saveStyle` 保存 `effectPresets`；需要保留当前风格的其他字段。
- 既有重命名、删除、收藏和预设导入导出入口继续可用。

### 4. 风格件预览

文件：`src/features/videoEdit/application/videoEditPresetPreview.ts`

```ts
await presetPreviewTimeline({ category: 'effect', preset: entry.preset }, size)
// => { composition, frames, poster }
await renderPresetPreviewFrame(composition, frame, signal)
```

已经接上同一快照重建服务，预览使用内存源码，不向工程发布代码。外来代码先确认，失败沿现有预览错误通道报告。

ticket 13 交回的样片与模板接线继续使用现有接口：`videoEditStyleLibrary.listStyles/findStyle/listTemplates`、`styleSampleTimeline`、模板 source `{category:'template', body, style, trustContext}`。`VideoEditStylesPanel.tsx` 中的 `StylePicture` 当前是局部函数，抽为共享组件及实际模板预览接线由 Claude 完成；本次没有修改它。

### 5. 助手与 UI 共用的创建模板

```ts
videoEditPresetCreationProperties(preset, styleId?)
// => properties[]，包装为 {properties} 后放进通用 create_items.items
```

工程风格的公开读回已经携带正确 styleId。创建模板包含不可拆解的成员引用与内容摘要，风格件变化后旧引用会拒绝并要求重新读取；界面不展示内部引用。

通用创建示例：

```json
{
  "kind": "create_items",
  "entityType": "video_edit.effect_preset",
  "parent": {"kind": "video_edit.style_library", "id": "singleton"},
  "items": [{"properties": {"video_edit.effect_preset.definition": {
    "name": "用户确认的名称",
    "media": "video",
    "effects": [{"id": "filter-member", "ref": {"kind": "video_edit.effect", "id": "目录读回的完整效果引用"}}]
  }}}]
}
```

## 持久格式

| 格式 | main → 本次 | 最低可读版本 |
|---|---|---|
| 剪辑内容 | 48 → 49 | 49 |
| 录制会话 | 51 → 52 | 52 |
| 本机效果库 | 3 → 4 | 4 |
| 风格库 | 7 → 8 | 8 |
| 风格分享包 | 10 → 11 | 11 |
| 剪辑预设包 | 11 → 12 | 12 |

旧内容逐版本原样升级，不丢字段；已登记的历史样本、支持下限和发布指纹不改写。本次追加黄金样本、基线与发布承诺。提高最低可读版本的原因是旧程序会拒绝代码风格件；代码资产自身结构保持不变，共享媒体依赖 schema 的提取不改变其指纹。

## 独立审查与修复

独立干净上下文只读审查 1 轮，确认并修复：

- 重要：跨工程的图片、视频、音频及片子数据引用未迁移 → 附带依赖、核验原媒体并重映射，覆盖异步应用和通用创建；共享媒体实现也回归了原代码资产出入库。
- 重要：复用扫描被无关历史源码缺失阻断 → 记录不可复用原因，使用完整快照继续创建。
- 小问题：完整 definition 替换遗留 codeSnapshots → 清理旧可选字段，代码→纯内置的实际通用修改已验证。

修复增量由主代理自查及精确测试验证，未进行第二轮独立审查。

## 验证与边界

- 已有通过证据：相关精确测试 12 文件 403 项；独立 Dawn GPU 用例验证双文件快照重建、henji-effects 1.3.0 锁定、重复应用只留一份代码定义，以及 80% 旋钮实际输出 `[204,0,0,255]`；依赖图 0 静态循环。
- L2：`npm run verify:changed -- --level L2 <本次 44 文件> --test <9 个直接消费者测试，逐项传入>` 通过。自动补齐并去重后执行 12 个 Vitest 文件、403 项用例，包含真实 GPU；精确 Node 7 项、ESLint、渲染层与 Electron 类型检查、依赖图、主进程导入边界与持久基线均通过。
- `npm run check:persistence-compat` 通过，覆盖 66 种格式。
- `npm run check:assistant-capabilities` 通过：结构检查通过，写入覆盖 15 项、业务不变量 31 文件 237 项全部通过。
- `npm run check:author-effects` 通过：作者效果生成检查通过。
- 提交前精确核对 44 个文件的暂存清单，`git diff --cached --check` 通过；末次 L2 后仅补迁移原因注释、清理文件尾空行，无运行语义变化。类型检查和依赖图使用单次 shell 的 12 GiB Node 堆空间，未修改项目配置。
- 没有运行全量 Vitest、完整 Electron 构建、开发实例或真实 Pi/MCP 进程；界面接线与视觉验收属于 Claude 的范围。
- 媒体依赖沿现有代码资产语义保存原文件路径及内容身份，不把图片、视频、音频或网页目录的字节内嵌到风格包；原文件移动或改变时明确拒绝，源码快照与片子数据自身完整保存。
- 同类问题实际排查范围：全局/工程风格成员、通用实体创建与修改、异步多片段应用、预览、风格包与预设包、外部工程/文档来源标记、代码资产媒体依赖共享入口。尚未进行 Claude 界面接线、真实窗口操作或跨机器媒体路径恢复验收。


## 审查修复 1（2026-11-01）

**状态：Claude 裁定条目已修复并提交，但尚未达到“所有门禁通过”的完成标准。唯一阻塞为 `check:assistant-capabilities:structure` 清点出的既有效果库 store 未建账；范围选择已提交用户，尚未收到答复。未添加豁免，未提高零 gap 基线。**

### 分支、提交与合并

- 分支：`task/19-U14-代码滤镜入库`；起点 `271a64842`（保留 Claude 已做的界面）。
- 修复提交：`2eebb14bf`（审查修复并合入 U12/U13/U0 主线）；`71288d2a7`（继续合入验证期间进入 main 的 U9 调整层，重新顺延格式）。
- 最后执行 `git merge main`，合入当时 `main@6b02672b4`；最终 HEAD `0a04ea49b2893ab41323f2421aeea2e5a9a66431`。最终这次合并仅有审查裁定文档，未改变已验证的运行代码。
- 任务工作区干净，未推送，未切分支，未合并回 main。
- 没有修改依赖、执行 npm install/ci/uninstall、操作 node_modules 或 FFmpeg 联接点、启动开发实例或占用 9334；没有访问 D:/视频制作、用户已登录浏览器、网页账号或外部聊天服务。主工作区仅追加本结果文件。

### 裁定落实

1. **级联与补偿**：声明及回执共用 `codeCascade`；覆盖目标工程没有同源代码时的正式 `change_application_entities/create_items` 创建。提交后回执校验失败也会调用现有源码撤回边界，并补偿文档；覆盖注入未声明回执的失败测试。
2. **来源不可洗白**：全局 definition 与风格 effect_presets 均由宿主解析。已有快照只允许沿原成员修改名称、旋钮等，宿主保留其原始来源；新增代码成员必须使用 `{ref}` 捕获，禁止直接塞入原始代码快照。测试覆盖省略 foreign 后完整写回、来源保留、执行前仍询问且拒绝后不编译；同源码的外来件不会污染本机件来源。
3. **内容摘要**：排除快照来源标记，导入标记不导致预览过期。
4. **前向兼容与录制来源**：外来标记采用结构浅改，保留较新可读文档中的未知成员/快照字段；外部文档导入和工程包导入均覆盖 video_edit、screen_recording 及录制基线里嵌入的代码定义、风格件。
5. **最低可读版本**：六种格式按合并当时 main 的下一号各升一次；最低可读版本使用明确字面量。
6. **保存入口**：删除生产已无人使用的 savePreset 和过时文案；保存走正式 saveLibrary，日志记录保存，restore 只供撤销/补偿。
7. **信任后预览恢复**：effect source 订阅快照来源查询，用户拒绝后再点运行会重建预览；测试实际经过信任会话与询问队列。
8. **源码独立落盘**：效果库当前元数据仅存摘要引用；源码经 PAL 及现有代码摘要校验读取入口存入 appLocalDataDir/code-sources/<sha256>.js，分享导出仍取回完整源码。历史内联库先沿正式迁移机制保留备份，读取不重写原键，显式保存才发布引用。真实临时磁盘测试覆盖重开、迁移、源码校验失败、写失败不发布和原库保护。历史备份保留原始内联数据，不把它误报为新的源码写入。
9. **列表开销和关闭状态**：复用未变风格件对象，不因每次文档编辑深克隆整库源码；工程或序列消失返回空列表。
10. **安全顺序**：补回媒体内容核验必须先于可能授权路径的 inspectVideoEditMedia 的中文约束注释。
11. **事实台账**：assistant-status 更新为实际界面接线及本轮两处 TSX 逻辑；内联类型改为顶部导入。
12. **统一不可用反馈**：双击/Enter 与拖放无目标、无可用片段均走同一个 effectUnavailable 错误反馈；保留 main 已有外观和布局。StylePicture 按 Claude 裁定视为已有模板接线完成，不另造实现。

### 独立审查补充修复

- 干净上下文审查共 3 轮。首轮发现快照仍保留原项目 Git 位置、普通文件摘要可能落后于实际文本，以及同码来源推断会污染本机来源；均已修复。
- 共用 snapshotCodeSourceClosure 按实际文本寻址文件及固定组件闭包，Git 引用仍严格校验；风格件与代码资产复用同一实现。真实文件系统用例移动原工程后，目标工程仍可导出/导入文档包和工程包。
- 第 2 轮增量审查无新问题；第 3 轮审查 U9 合并增量，确认试渲染、来源检查与逐版本迁移未被覆盖，无新问题。主代理另行发现并如实记录下述助手门禁阻塞。
- 实际同源排查范围：通用实体创建/修改/撤销/补偿，全局与工程风格成员，异步应用和预览，风格包/预设包，剪辑与录制外部导入、前向未知字段，以及代码资产/风格件共用源码与媒体闭包。没有扩大为全仓业务审计。

### 最终版本表

| 格式 | 合入 main 的版本 → U14 最终版本 | 最低可读版本 |
|---|---|---|
| document.video_edit | 52 → 53 | 53 |
| document.screen_recording | 55 → 56 | 56 |
| video-effect-library | 5 → 6 | 6 |
| video-preset-package | 12 → 13 | 13 |
| video-style-library | 8 → 9 | 9 |
| video-style-package | 11 → 12 | 12 |

作者 API 9、代码版本 10、代码资产 15 为 main/U9 已有升级，U14 未另升。main 的历史黄金样本、指纹和发布承诺保持原件；六份当前黄金样本用正式 generatePersistenceFixtures 生成（esbuild 加载官方生成器），随后正式执行 persistence:baseline 与 persistence:release-snapshot。合并期间用 MERGE_HEAD 对照主线发布承诺；最终提交后的默认 HEAD 保护检查也通过。

### 最终验证证据

- `npm run verify:changed -- --level L2` 显式传本次 64 个文件及 18 个直接消费者测试，通过；去重后 **24 个 Vitest 文件、560 项用例** 全通过，精确 Node **7 项**通过。
- 该 L2 包含真实 Dawn GPU 用例、改动文件 ESLint、渲染层与 Electron 两套 tsc、surface:strict、颜色、图标、残留、设计令牌、依赖图、主进程传递导入和持久基线；全部通过。依赖图 0 静态值 SCC、0 冻结跨层边。
- `npm run check:persistence-compat`：最终 HEAD 默认保护下通过，66 种格式。
- `npm run check:surface`：独立运行通过；0 界面语法错误，355 项既有启发式告警未当成错误屏蔽。
- `npm run check:assistant-capabilities`：**未通过**。结构检查报 `store 未建账且未登记原因：src/features/videoEdit/application/videoEditEffectPresets.ts`，聚合命令在此停止。
- 为排除其他阻塞，单独执行 `check:application-control-coverage`（1 文件 15 项）与 `check:application-control-invariants`（31 文件 238 项），均通过。
- `git diff --check`、暂存区检查通过。没有执行完整 Electron 构建、真实窗口、真实 Pi/MCP 或浏览器视觉验收；助手行为证据来自正式注册表/事务/执行器公共入口，进程与像素边界用既有替身，像素执行另由独立真实 GPU 用例证明。
- 本地检查日志：.tmp/u14-final-l2.log、.tmp/u14-final-gates.log、.tmp/u14-final-surface.log、.tmp/u14-final-coverage.log；均未纳入提交。

### 需用户 / Claude 裁定的唯一阻塞

原有效果库通过 return create 构造，旧静态扫描未清点到；本轮异步水合将实例保存为局部变量后，该门禁能识别此 store。逐动作核对发现：创建与改名已有通用实体入口，但收藏没有对应属性；effect_preset 集合明确只允许创建，不允许删除；现有 deletePreset 直接删本机库成员，未接回收区。这些是既有设计缺口，不能伪造账本绑定或借“内部动作”豁免。

按 assistant-capability.md 每个函数键必须建账，且 storeActionCoverage 的 GAP_BASELINE=0 不得放宽。已通过内置异步问题请求裁定：**建议将收藏通用属性、删除通用集合及正式回收一并纳入本次；或维持原范围并保留门禁阻塞。** 因这会超出审查裁定的既定业务范围，尚未执行。没有使用任何外部 Claude 服务。收到范围决定后才能完成这一项并宣称全部门禁通过。

## 审查修复 2（2026-11-01，接手 Codex）

**状态：完成。助手门禁阻塞已解开，check:assistant-capabilities 零 gap，所有指定门禁通过。**

### 分支与提交
- 分支 `task/19-U14-代码滤镜入库`；接手时有 17 个未提交文件（无进行中的合并），逐个核对后保留思路、修掉缺陷并补完。
- 提交 `4692a4a7d`（feat(video-edit): 效果库收藏、删除与恢复接入通用助手入口，19 文件）；随后 `git merge main` 合入 `main@024928d46`（U1/U2/U4 及裁定文档），提交 `8b4fa646a`，无冲突、无持久格式变化，不需顺延版本。未推送、未合并回 main。

### 落实
1. **收藏**：新增实体 `video_edit.effect_library:singleton`，属性 `favorite_ids` 用统一字段定义派生描述符/读写/账本；界面 toggleFavorite 与通用修改共用 `setFavorites`，未知或重复条目点名拒绝。
2. **删除**：`video_edit.effect_preset` 开放通用 `remove_items`；界面（效果库面板、预设详情）与助手共用 `deletePreset → saveLibrary`，被删成员先以已登记的效果库格式写副本并移入回收区，成功后才发布删除（中途失败最多多一条可幂等恢复的条目，不丢风格件）。
3. **恢复**：`settings.deleted_item` 通用移出触发恢复监听，按 `mergeRecycledMembers` 幂等并回，重名加序号，收藏接回；恢复不进撤销历史；读取失败把副本送回回收区；恢复链路有 start/completed/failed 日志。
4. **同一撤销**：库提交记入领域历史，`undo_application_changes` 按操作撤回；剪辑界面撤销/重做（`undoVideoEditWorkspace`）按提交顺序把文档与效果库排成一条链，新提交清掉另一方的重做；手势提交与导入重排也带顺序号；助手的 `undo_video_edit` 仍只撤剪辑文档，回执与实际影响一致。
5. 效果库 store 建账（storeId=videoEditEffectPresets），`GAP_BASELINE` 维持 0；assistant-status 台账同步。

### 独立审查
干净上下文审查 3 轮：第 1 轮重要 1 条（撤销“从回收区恢复”会移除已不在回收区的风格件）→ 恢复不进撤销；小问题中重做链、重复收藏、回收副本校验与日志、评分处理已修。第 2 轮重要 1 条（改成先删后回收引入的崩溃窗口）→ 改回先回收再发布；界面与助手删除对评分统一按 id 保留。第 3 轮无新问题。

### 验证
- `verify:changed --level L2`（19 文件 + 命令、预设目录两个消费者测试）通过：精确 Vitest 7 文件 100 项、ESLint、渲染层类型、surface/颜色/图标/残留/设计令牌、依赖图、主进程导入。
- 两套 tsc（合并后重跑）、`check:assistant-capabilities`（结构 + 覆盖 15 + 不变量 31 文件 238 项，合并后重跑）、`check:persistence-compat`（66 种格式，合并后重跑）、`check:surface`（0 错误，355 项既有告警）通过。
- 未运行真实 Electron 窗口、真实 Pi/MCP 进程。

### 遗留
- 少数路径会让重做多一步或少一步（提交批“无改动”分支与导入回滚恢复旧 future；最终无改动的助手事务也会清掉库的重做），不写坏数据。
- 撤销一次删除后回收区仍留着该条；之后改过内容再恢复会按既有语义另起身份。
- 删除风格件不清评分（按 id 保留，回收恢复改身份时接不回）。
