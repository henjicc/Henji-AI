摘要：6 个点阵模板的 kit.ts 在本机应用数据风格库；样片、工程风格副本、固定源码版本和片子代码是不同内容源，必须分别升级。
方案：缓存不可变 ImageBitmap，把持续脉冲与闪烁拆为独立 pose 小层；保留画法、时钟、合成顺序与原有运动模糊语义，经现有正式入口发布和改指。
状态：2026-11-01 只读调研完成，待 Claude 裁定后实施；本步仅写本文件，未改源码或用户内容，未提交、推送、启动应用或使用 9334。

# Ticket 21：组件库静止复用设计

## 1. 边界与证据

- 任务来源：同目录 `plan.md`；仓库 `docs/task/代码效果与渲染改进/以后再做.md` 第 2 项全文；`docs/task/未完成事项推进/交接/T3-静止内容复用.md`，尤其 4.1、4.2。
- 仓库：`D:\VibeCode\Henji-AI-t21`，分支 `task/21-组件库静止复用`，调研时 HEAD `26f8cfb1275deccf236ca8d51ce72ecb8e52133a`，工作区干净、无上游。按本次约束不切分支、不 pull、不提交、不 push。
- `node_modules` 是指向 `D:\VibeCode\Henji-AI\node_modules` 的 Junction；不执行 install / ci / uninstall。本步未构建、未执行用户作者代码、未调用应用读写能力，避免读取入口带来的初始化写入。
- 本步为 testing.md 的 L0：只核查文件、数据结构、Git 固定源码、入口与引用。下文性能与画面数值均是待验证目标，交接里的 9.5 ms 不是本轮测量值。
- 选型复用现有 Canvas2D/ImageBitmap、作者图层、版本发布与观察能力，不引入依赖、不改运行时、不补全局原型版本监控，也不将本任务扩成输出缓存或 GPU 管线改造。

## 2. 组件库到底在哪

### 2.1 全局风格库：6 份 kit 确实在应用数据，不是内置资源

实际根目录：`C:\Users\15212\AppData\Local\com.henji.ai\video-edit-styles`（下文记作 `L`）。`VideoEditStyleLibrary` 通过 `appLocalDataDir()` 解析此目录，不在其下的 `Henji-AI` 程序数据子目录。

| 模板 | 文件（相对 L） | 当前作品版本 | kit 所在字段 |
|---|---|---:|---|
| 录屏容器 | `templates/07ddab70-7628-4184-82ea-7b0ed1f52166.json` | 3 | `content.body.code.files["kit.ts"]` |
| 台面背景 | `templates/2bee12a9-2c93-4422-8839-707cefdcb806.json` | 2 | 同上 |
| 花字节点 | `templates/4a8c4449-67e3-494d-836d-b8728dd2baa0.json` | 1 | 同上 |
| 章节标题 | `templates/93a863db-35ae-45a3-af78-f6e595e5d52c.json` | 1 | 同上 |
| 数据卡 | `templates/aad99bfa-c4ef-460f-b098-ef577f1de52b.json` | 1 | 同上 |
| 高亮 | `templates/d3e808e5-8269-4082-94a4-37edfe981df7.json` | 1 | 同上 |

6 份 kit 的 UTF-8 SHA-256 完全相同：`d32768afb3468ec98cd4c2536a37d8a8fb0721a39550ff933aa0e670659715ef`；各自另带不同的 `main.ts`，入口均为 `main.ts`。模板归属的风格 ID 是 `a8ea502f-df41-4e3f-abac-fc414cd1e44b`，登记的归属版本为 5。

仓库 `resources/video-edit-styles` 下的 6 套是 `restrained`、`tech-info`、`explainer`、`variety`、`promo`、`warm-documentary`，属于另一套内置风格。逐份解析其 `style.json` 后，均没有 `kit.ts` 或 `knockPatch`。不要因为都是“6 个”而改错对象；本任务没有必须修改的仓库 resources 文件。

### 2.2 风格样片：不是第七份相同的 kit

个人风格源：`L/styles/a8ea502f-df41-4e3f-abac-fc414cd1e44b/style.json`。JSON 外壳格式版本是 4；`content.version` 是作品版本 11，两者不能混用。

样片在 `content.sample.code.files["main.ts"]`，3840×2160、60 fps、26 秒，只有一个源码文件和一个 `scene` 图层。其相近实现是 `tileOf`、`knockOver`、`grain`、`pulse`，不是模板 kit 的直接引用：

- `tileOf` 缓存 OffscreenCanvas；`grain` 的 `GRAIN = c` 缓存画布。
- `knockOver` 用可反复改画的 `KNOCK.canvas`，每次重画遮罩与台面后贴回；没有可直接替换的一张现成静态缓存。
- 脉冲、数据块闪烁、台面颗粒都夹在 `scene()` 内；镜头还会持续横移和推近。
- 同目录 `preview.mp4`、`thumbnail.jpg`、`anchors/*.jpg` 是派生产物，改源码后必须正式重渲染，不直接修改媒体文件冒充升级。

### 2.3 剪辑工程：有风格快照、模板登记、独立素材固定版本三层

只读核对了以下两个文档，不能按相同子 ID 把它们当同一文档修改：

| 文档路径 | 文档 ID | 发现 |
|---|---|---|
| `D:\视频制作\2026-10-23_元宝搜索\项目\元宝搜索.hjvid` | `43e2b5cb-0124-4b12-b45e-92211d3de4f8` | 主片，含模板测试、样片、正片、正片第二版 |
| 同目录 `元宝搜索 · 暗色风格样片（第二版）.hjvid` | `ae1fe2fd-bf2a-4886-ab31-f2aa947b6ba5` | 同样保留模板测试与样片副本；是否升级由 Claude 定 |

两份 `content.styles` 都保存了“点阵信息”v11 的独立样片快照，代码仍是 `main.ts`；库更新不会自动改此快照。工程里的样片素材又是独立 `codeMaterials[].versions[]`，不随风格快照更新。

两份文档均有 5 个已登记工程模板（台面、容器、花字、数据卡、高亮，章节标题未登记）。它们通过 `origin.id/version` 对应库模板，通过 `body.definitionId` 指向工程代码定义。主片对应定义分别是 `fb4d9de0…`、`0087173a…`、`f7f4ce60…`、`d7cd48d6…`、`a2cc4a00…`；实施时必须从正式目录读取完整引用，不用此前缀构造请求。

**验收序列 `模板 · 点阵信息`（`0fee3d14-5972-435b-a820-f970c82f801e`）的 6 个片段没有 templateId，且定义不是上述 5 个工程模板的定义。** 它们不能靠 `update_video_edit_template` 自动升级：

| 测试片段 | 定义 ID | 源码来源 | 起始帧 / 时长帧 |
|---|---|---|---:|
| 章节标题 | `76f3c3b9-d56d-41b2-8d56-69cb5482a20e` | `main.ts` 固定导入项目组件“点阵信息”v2 | 0 / 300 |
| 花字节点 | `95baa63f-60ab-44cc-91f5-f05bd955a865` | 同上 | 330 / 240 |
| 高亮 | `9211d1e4-3eaf-4f46-b26e-f96a430e0f96` | 同上 | 690 / 240 |
| 数据卡 | `e8790820-699f-406d-9a2c-b9d689f6ecdc` | 同上 | 1110 / 300 |
| 录屏容器 | `13450a33-84c2-4e39-a1e2-1c0ce7264b61` | 独立 `main.ts + kit.ts` 固定版本 | 600 / 480 |
| 台面背景 | `4a1ec614-d8b9-4cb2-bfbe-b87f1c56d476` | 独立 `main.ts + kit.ts` 固定版本 | 0 / 1440 |

此序列为 4K60、运动模糊开启。两份文档中的测试代码引用相同；台面参数包含 `drift:8`、`push:0.002`，确实持续运动，不能作为全画面静止对照。

项目组件 v2 固定在提交 `172939435f16faa2b3e0a46c4025900da837e18e` 的 `组件/点阵信息/main.ts`，哈希 `1117dd0f153a69c92a94414ce6118fd8164ad28db71e51019c766264a220b9dd`。已用 `git show` 只读回查，仍含画布形式的 grain/knock 缓存。当前工作树 `代码/legacy/components/点阵信息/main.ts` 与这个固定源码哈希一致。**磁盘 legacy 文件是维护副本；实际运行读的是 Git 固定提交，不是随磁盘文件即时更新。**

样片序列还分别固定“测试样片”（定义 `57a0e947…`）和“样片 v11”（定义 `51bdf94e…`）。后者代码哈希 `55c5c8a3…`，独立于风格库样片，不可直接用库样片整份覆盖并丢失其视频参数与已有差异。

### 2.4 《元宝搜索》代码仓库：当前路径已经完成部分目标

根目录 `D:\视频制作\2026-10-23_元宝搜索\代码`，分支 main，调研时 HEAD `aa02525cea41f0a2f7fc8fdc507fca4d87f622c8`。当前入口通过相对导入使用 `style/dot-matrix/**`；正片第二版的台面、窗口、标注、开场、颗粒各固定自己的 `version.project.commit/entry`，并不都跟随 HEAD。

- 当前 `style/dot-matrix/strokes/grain.ts` 已缓存 `transferToImageBitmap()` 的结果。
- 当前 `scene/overlay.ts` 的 `pulse` 已是小 bounds + pose，静态组件有停稳 `cacheKey`；`scene/grain-module.ts` 已是独立颗粒片段，提供时间无关 frameKey。
- 当前 `style/dot-matrix` 没有 `knockPatch`；台面与窗口已有原生 WebGPU 路径。不能把旧 kit 的整套 Canvas 改法套进当前路径，也不为本任务重写 WGSL、视频纹理或窗口画布。
- `legacy/materials/*/kit.ts` 与 `legacy/components/*/main.ts` 是旧素材/组件维护副本；`archive/dark-samples/kit.ts` 等是历史/试验。除正式发布流程自行维护的文件外，不直接改这些副本，更不全目录替换同名 kit。
- 当前仓库还有非本任务未跟踪项：`archive/dark-samples/`、`archive/style-v3-lab/`、`tools/check-frame-refactor.mjs`、`tools/frame-key-report.md`、`tools/henji-mcp/`。不得纳入本任务提交。

## 3. 每处具体怎么改

### 3.1 模板 kit 与旧项目组件：同一画法改一次，分别正式发布

1. `deskGrainTile` 用局部 OffscreenCanvas 完整生成同种子、同 192×192 颗粒，最后一次 `transferToImageBitmap()`，只把返回位图存入 STATE.grain。跨帧必须返回同一个对象，不能每帧 transfer/createImageBitmap。
2. `knockPatch` 保持原遮罩 12 圈、两格软边、屏幕空间台面渐变与颗粒原点、destination-in、p 透明度和贴图位置；完成局部画布后缓存 `c.transferToImageBitmap()`。用于构建的 mask 仍可为画布，不传入最终作者图层即可。
3. key 覆盖所有决定像素的几何与材质：r、k/ox/oy、裁出的整数区域、画幅、grainAlpha；p 只在贴图时使用，不进 key。不得增加时间或逐帧编号，也不得用新的舍入近似掩盖几何变化。现 key 的末段有舍入；若补充精确几何值，必须同时测相机/尺寸变动，确认不破坏命中与画面。
4. 维持现有有限 Map 缓存，不另设容量选项。淘汰只丢引用，不立即 close 位图：上一帧录制、当前帧其他层或重放仍可能持有它；模块回收时交由现有生命周期释放。禁止将仍被缓存引用的位图转移给会消费它的 API。
5. 6 份 kit 同步相同补丁；同一项目组件“点阵信息”v2 的画法同步发布为新不可变组件版本。不能覆写旧 Git 对象或旧版本记录。

浏览器契约依据：transfer 会产生新 ImageBitmap，并将原画布内容换为空图；drawImage 可重复使用位图。只对完成的图块 transfer，不能对需要继续沿用旧像素的 scratch 画布直接转移后继续假定其内容存在。见 [MDN transferToImageBitmap](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas/transferToImageBitmap) 与 [MDN drawImage](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/drawImage)。

### 3.2 脉冲/闪烁拆层：保留时间与像素，不把动画停掉

- kit 增加纯计算 `pulseAt`，沿用原路径、缓动、period、t0、alpha。保留原 pulse 导出供旧调用使用；本轮修改的调用点改为小层。点在局部原点绘制，位置与透明度由 pose 给出；半径按 m.k 换算，bounds 包含抗锯齿边缘。
- **新拆出的脉冲和闪烁层设 `motionBlur:false`**：原来在无 pose 的层里按中心帧画点，没有位姿曝光；照搬 T3 示例而沿用样片 shutter 180 会新增拖影。父层原有位姿/模糊则保持原义。
- `tag` 拆出信号点及入场波纹，文字、扫出遮罩与下划线继续原时序；不能把整个 tag 的 opacity 乘上 twinkle，原来只有点在闪。
- 信号点的半径增长可进入 pose.scale、twinkle 进入 pose.opacity；原画法中独立叠加的波纹单独一层，不用统一 opacity 改变其重叠关系。draw 内不再读取持续变化的时间。
- 所有层保留原覆盖顺序、原 clip 与 reverse/hold 离场时钟，尤其 `phase` 的 te/T/live 不得互换。`answer` 空字符串、lead=0、隐藏计数等分支也要保持。
- 对有 destination-out、multiply、读前层像素等关系的内容不任意分离。容器挖阴影仍与其必要的前置内容保持原合成语义。
- clip 是局部重画的备选方案，范围要包含波纹、线宽、两格软边；它只能减少上传面积，不能承诺零重画。无 pose 层的 bounds 不能代替 clip。首选 pose；若实际像素/成本不合格，记录问题交 Claude 决定是否接受 clip 备选。

| 模板 main.ts | 需要拆出的持续变化 | 保持原状的主体 |
|---|---|---|
| 章节标题 | frame 中 pulse；无 answer 时的闪点；answer/tag 的闪点 | knock、定位框、刻度、编号、章节名、标题、答案文字 |
| 花字节点 | lead 的 pulse；label/tag 的闪点与短暂波纹 | 生长完成的引线、标签文字与下划线 |
| 高亮 | lead 的 pulse；说明 tag 的闪点与波纹 | spotlight、压暗范围、引线与说明文字；注意说明用 ml 变换 |
| 数据卡 | frame 中 pulse/入口节点；matrix 内每个不同相位的亮点 | 框、名称、数值、单位、尺、暗点与计数；计数只随真实完成数变 |
| 录屏容器 | 无同类循环要拆；只换实际用到的 kit 缓存 | 原接触阴影、圆角裁切、视频、移动入场 |
| 台面背景 | main.ts 为原生 GPU 路径，不强行 Canvas 化 | 原漂移、推近、颗粒和退开行为；kit 同步以保持交付一致 |

数据卡每点的 twinkle 种子不同，不能用一张点阵纹理的共同 opacity 代替。优先每个亮点一个小 pose 层（默认 20 点）；记录图层数、GPU 和总 CPU，不能为了沿用率好看而让合成更慢。不新增参数/选项，不以错误的静态 cacheKey 冻住计数或闪烁。

### 3.3 样片单文件与工程样片副本

- `tileOf` 和 `grain` 的缓存源转位图；按画布创建 pattern，保留 pattern.setTransform 的矩阵与像素对齐。
- `knockOver` 改为按完整几何缓存“原遮罩 × 原屏幕渐变”的位图，保留 source-in 结果、源裁切大小与 p；不能机械把可变 KNOCK.canvas 转一次后继续读旧像素，也不能套入模板含颗粒的 knockPatch 改变原样片画面。
- 将 scene 中各条 pulse 与各个数据亮块闪烁按原叠放位置抽成小 pose 层。原 scene 的末尾 multiply 颗粒作用于前面内容，拆层必须保留其合成作用；不能将颗粒当普通 source-over 层，也不能把原本在颗粒下面的脉冲挪到最上方。
- 单 scene 还受连续相机、入场涟漪和视频影响。位图化会解除可比较障碍，但不意味着整个 scene 将静止；完成抽层需要按画法边界拆分底层场景。保持连续镜头，本任务不以停止推拉/减少动画实现指标。
- 风格样片源、两个工程的风格快照、已放置样片素材分别更新。已有样片素材从其固定版本做局部补丁，保留视频绑定与独有内容，不覆盖为“最新库样片”。

### 3.4 当前片子代码

当前 grain 与 pulse 已符合主方案，预期无需生产代码改动；仍按它们的实际依赖闭包核对，不为产生提交而重复改写。若实测发现同根因遗漏，只改 `style/dot-matrix` 的实际调用者，经第 4 节提交并升级受影响入口；不动 film 数据、镜头路线、网页录制、片子文案或 archive 试验。

## 4. 正式写回路径与保存确认

本节均为批准后的执行方案，本步未调用。通用变更使用正式反射返回的完整 ref、schema 与并发基线，不直接写 JSON/hash/revision。

| 内容源 | 正式入口 | 关键确认 |
|---|---|---|
| 6 个库模板 | `change_application_entities` 写 `video_edit.template.body`，保留完整 body 中的时长等字段 | `VideoEditStyleLibrary.saveTemplate/putTemplate` 自动算 contentHash、按内容升作品版本、写文件并通知刷新；逐个回读 |
| 个人风格样片 | 通用修改 `video_edit.style.sample`，再 `render_video_edit_style` | 保存 sample 不升作品版本；成功渲染才更新版本/摘要/预览，读取 stale=false 和媒体；不要手填 version |
| 已绑定风格快照 | `bind_video_edit_style`，目标 documentRef + sequenceRef + 同 styleRef | 重复制工程内同 ID 风格并保存；这个快照由同文档各绑定序列共享，需列出影响；不会更新现有素材 |
| 已登记工程模板 | `update_video_edit_template`，`content:{kind:"library"}` | 先读 instance_refs 和来源；刷新该定义的联动引用并保存，核对 codeInstances 无意外参数移除/重置 |
| 未登记的 6 个测试素材 | 在原定义下通用创建 `video_edit.code_version`，传 definition_id、files/entry；再显式改指素材项/片段/效果 | 4 个旧组件调用者先发布同名新 `video_edit.code_component`，新素材版本固定新组件；两份 local kit 版本各更新自身文件；保持原参数/曲线 |
| 工程中的独立样片素材 | 同上，基于各自固定源码创建新版本后改指指定引用 | 创建版本或设默认不会自动改变已经放置的片段；不改写旧版本或只看默认版本判断完成 |
| 当前片子相对导入代码 | 通用修改 `video_edit.code_project_file.source`，一次正式文件事务生成一次 Git 提交；再 `upgrade_video_edit_code_materials` 指定 materialRefs 与提交 | 只升级闭包受影响的入口，检查 upgrades.changedFiles、instances、verified；共享代码工程不等于两个剪辑文档都已升级 |

旧测试素材主方案保留 `@组件/点阵信息` 结构：通过通用创建同名组件发布新不可变版本，再创建各调用素材新版本钉住它。不要把“升级内置库”的 `upgradeLibraries:true` 当作项目组件升级；也不要为了套用库模板而重新放置片段、改变原时间线。

片子仓库当前有无关未跟踪内容，**不能调用会暂存全部外部改动的 `commit_video_edit_code_project`**。优先 `code_project_file` 精确事务，其提交边界是本次 paths。若后续 Claude 指定外部编辑再提交，须精确 `git add -- <本次文件>` 并检查 staged diff；不能使用应用的“提交全部外部修改”入口混入无关项。当前代码没有待修同源问题时不创建空提交。

上述发布产生的 Git/源码新版本不是剪辑改指：后者必须另行保存、检查 verified，并从正式读入口回读固定 commit/versionId。库与工程之间不是跨文件原子事务，按“库模板→样片渲染→工程副本→素材引用”逐批完成，失败保留旧版本和各批收据，仅重试未完成批次，不重复发布已成功内容。

只改作者源码内容，不改持久 schema、作者 apiVersion 或文档格式版本；沿用正式版本构造器的继承规则。文件格式迁移与黄金样本不属于本次预期范围。

## 5. 备份与回滚

所有用户内容写入之前，先取得该阶段授权并完成下列备份；本步没有创建任何备份或副本。

1. 风格库：经 `export_video_edit_style_package` 导出“点阵信息”完整 `.hjsty`（含 6 模板、样片源码、预览与锚点）；另在应用不写该目录的安全时段保存实际 style 目录与 6 个模板原字节。记录文件哈希、模板/风格作品版本，验证备份可读；不能只备份 kit 字符串。
2. 工程：保存确认后备份两份获准修改的完整 `.hjvid`，连同其实际代码 Git 仓库历史；可放现有作品 `.henji/backups/` 下有时间戳的本次子目录。剪辑文件引用的是 Git 固定源码，只复制 hjvid 而丢掉对应 Git 对象不构成完整备份。
3. 代码：记录原 HEAD、各受影响素材固定提交、旧组件 pin、全部参数与引用清单；对已存在未提交内容另存只读快照，绝不通过 stash/reset/clean 清理别人的工作。Git 历史备份可用 bundle，未跟踪内容另外保留；备份包含实际回滚需要的版本，不只保存 HEAD 的文件快照。
4. 失败/不达标时，先撤销对应工程操作或把目标引用改回原固定源码版本；回读画面和参数后保存。代码工作树通过精确恢复事务追加恢复提交，或只 revert 本任务提交，再按需升级/改回素材，禁止 reset --hard。
5. 库内容不在工程撤销栈内。需要恢复时导入已备份的同 ID `.hjsty`；导入覆盖前正式入口会保留可恢复副本。要字节级恢复则关闭相关写入会话，用原字节备份恢复对应文件并重新加载，防止内存旧状态再次覆盖。
6. 库回滚不自动回退工程快照、模板版本或素材引用；逐层核对。新创建的不可变源码版本可以保留未引用，不删除旧版本。完整工程备份恢复只在停写并保留当前版本后执行，恢复后重开验证固定源码仍可解析。

## 6. 画面与性能验收

### 6.1 环境与基线

- 当前只写设计，不运行。实施时使用与当前数据格式兼容的正式产物和独立验收实例，避开其他任务的构建/播放，不连接、不关闭、不重启 9334 开发版。独立实例使用获准副本，不能与现有应用并发写同一用户库和工程。
- 本次内容修改不要求修改宿主；确有宿主源码变化才先 `electron:bundle`。真实性能结论按 testing.md 使用本机正式产物/真实 GPU、同画幅与预览分辨率，不能拿裸 Vite、软件 GPU、导出耗时替代。
- 固定 Electron/宿主提交、GPU/驱动、字体、4K60、运动模糊开关、代码版本、媒体输入和同一帧清单；旧内容与新内容采用同一宿主，先采旧版基线。停后台预渲染等竞争负载。两轮旧版基线差异 ≤5% 才比较；超出先排环境，不归咎优化。
- 像素检查走 `observe_video_edit_frame` + `read_application_media`；单张使用 maxWidth=3840。联系表只用于找变化，不能用缩小后的总网格证明单帧像素一致。缓存观察图是未来验收产物，不加入素材库。

### 6.2 逐模板停稳段与采样

主验收对象为主片的 `模板 · 点阵信息` 序列。以下是基于当前时间线的候选中心帧；执行时从正式状态重新确认 start/duration、build、参数和出场边界，中心前后 5 帧都必须属于停稳段。

| 对象 | 中心帧候选 | 预期口径 |
|---|---:|---|
| 章节标题 | 220 | 入场 3 秒后、reverse 离场前；含 pulse、答案点闪烁 |
| 花字节点 | 500 | 含 lead=6 的引线与闪点，主体文字停稳 |
| 高亮 | 860 | 与容器有叠加；分素材取成本，核对框/说明和视频的区别 |
| 数据卡 | 1320 | 默认 20 点已点亮；逐点相位保持，计数停稳 |
| 录屏容器 | 960 | 已入场，仍有视频；另在验收副本做同画面冻结输入对照 |
| 台面背景 | 1100 | 原生 GPU 漂移/推近对照；保持参数不变 |

1. 每项用 `near_cut` 的 cutFrame 指向停稳段中心、before=5、after=5；这里借用连续帧功能，不以真实切点附近的入场画面衡量静止率。
2. 先在同一会话预热至少 16 个连续帧，再采上述 11 帧；可以依次取中心减 22、中心减 11 的两个预热窗口，再取目标窗口，覆盖相接的帧区间，并检查实际 sessionReused/sampling。不能把反复跳入的首帧或同帧命中当持续播放沿用。
3. 核对 `performance[].sampling.mode="adjacent-frame"`、preparation 与会话连续性。正式试渲染会做 f→f−1→f 的稳态测量，连续不变计数需跨过 `QUIET_FRAMES=12`；不满足的窗口重新预热，不把首次分组/上传混入稳定目标。
4. 每模板至少另选一组后段停稳窗口，覆盖一个完整脉冲/闪烁周期，防止只选无点可见的时刻。边界画面另测，不混入停稳统计。
5. 原序列保留不动，通过批准的验收副本/临时 composition 单独隔离目标素材测量，再回原组合核对。全序列会汇总背景、视频与目标模板的成本，不能把合计值误当章节标题的 CPU。

### 6.3 指标与判据

逐窗口保留原始 `performance`，至少列：模板/文档/片段与固定版本、帧范围、reused/redrawn/direct/video、uploads、uploadBytes、CPU 中位数与 p90、准备耗时和采样模式。图层沿用率定义为 `Σreused / Σ(reused+redrawn+direct)`，video 是子集不能再次加分母；分母为零报不适用。

- 纯 Canvas 停稳目标（章节、花字、高亮、数据卡）：预热后静止主体应全部沿用；优先 pose 路线下，窗口内整体沿用率目标 ≥99%，uploadBytes=0、uploads=0。首次出现/分组暖机单列，不用均值掩盖持续整帧上传。
- 章节标题：同条件稳态 cpuMs 中位数和 p90 均 <2 ms；先实测旧版，不把历史约 9.5 ms 当本机必然基线。≥99% 是对“接近 100%”的拟定量化，待 Claude 确认；不靠增加无用层凑分母。
- 数据卡：小 pose 层数量增加后还需总 CPU/GPU 和实际播放 p90 不退步；若沿用率通过而总耗时上升，仍未验收通过。
- 容器：冻结输入对照的静止装饰应沿用、上传归零；正常视频输入的 video 层重画与上传是合理成本，单列，不计入“所有内容零上传”的承诺。冻结仅在验收副本，原片不改变。
- 台面原生 WebGPU 入口没有 Canvas 图层沿用分母；uploadBytes=0 只表示未统计 Canvas→纹理上传，不能推断没有 GPU 工作。记录为不适用，比较 CPU、GPU队列完成墙钟与播放 p90，无性能退步，不停止漂移换指标。
- 样片与当前正片同样区分连续运镜、视频、闪烁和静止局部。列出可沿用层的证据，不承诺整片零上传。GPU ms 按现有口径是含队列完成的墙钟，不能当硬件时间戳。
- 真实播放用渲染条的实时合成 p90、跳帧比例与基线比较；相同负载下不得退步。离屏取帧与单元替身通过不能替代这项。

### 6.4 画面无差别与状态回归

- 同一时刻取旧/新全分辨率无损帧，用现有像素对比工具产差异图并目视闪切；图块仅换 Canvas→ImageBitmap 的局部首先要求像素一致。分层若出现 8 位合成的微小取整差逐处解释，不能自动扩大整图阈值或以 SSIM 高掩盖掉点、裁切和拖影。
- 关键帧：首帧、显影中段、停稳、pulse 周期头尾、twinkle 峰谷、reverse/hold 离场、最后可见帧；再测跳入→倒退→前进、重开、换尺寸/参数后的缓存失效。目标是同帧确定、无残影、无闪黑。
- 重点区域：定位框/标题相交、knock 两格软边与颗粒接缝、录屏接触阴影 destination-out、圆角裁切、点阵计数与亮点相位、说明 ml 缩放、空答案与无引线。
- 参数覆盖只挑有关风险：短/长文、空字符串、lead=0/非零、count=0/默认20/较多点、showMatrix=false、reverse/hold；既有模板参数、曲线、层覆盖、素材/片段版本引用必须无意外丢失。原有 ID 作为静止主体继续保留，新拆细节用新 ID。
- 最终报告区分库6模板、5个登记副本、6个独立测试素材、各样片和获准片子的实际完成范围。未测暗色文档或历史样片时明确列出，不能声称所有工程同步完成。

## 7. 需 Claude 裁定的点（实施前）

1. **工程范围**：建议主片为必做；暗色样片文档默认只读保留。主片内 5 个已登记副本、6 个独立测试素材和在用样片应分别处理；历史测试样片是否一并升级需点名，避免把“同步”扩大到所有历史版本。
2. **样片拆层范围**：建议保持 v11 连续镜头，落实图块位图化与脉冲/闪烁拆层，单独列其动态基线；单 scene/末尾 multiply 颗粒使它不是两行替换。是否本轮完成整个样片的必要场景拆层，或明确分批，不得只改模板就关闭“样片同步”。
3. **验收量化**：确认纯 Canvas 停稳沿用率 ≥99%、零上传、章节 CPU 中位数和 p90 <2 ms；视频与原生 GPU 按第6节单列，clip 备选不能悄悄冒充 pose 零上传通过。
4. **片子代码处理**：当前现代 grain/pulse 已达目标，建议无同源遗漏则不改、不造提交；旧项目组件经正式发布新版本及调用素材改指处理，不手改 legacy。确需新代码时采用精确工程文件事务，避开“提交全部”混入现有无关项。

## 8. 实现定位索引与本步核查

下列路径均相对 `D:\VibeCode\Henji-AI-t21`，已只读核对存在与实际行为：

- `src/features/videoEdit/application/videoEditStyleLibrary.ts`：root/builtinRoot、load、saveStyle、putTemplate、preserveStyle/preserveTemplate。
- `src/features/videoEdit/application/videoEditStyleReflection.ts`：style.sample、template.body、工程风格只读快照。
- `src/features/videoEdit/application/videoEditStyleRender.ts`、`videoEditStyleCapability.ts`：样片重渲染、绑定与保存回读。
- `src/features/videoEdit/application/videoEditTemplates.ts`：来源、工程定义、library 更新与实例改指。
- `src/features/videoEdit/application/videoEditCodeComponentReflection.ts`：项目组件发布新版本与固定依赖。
- `src/features/videoEdit/application/videoEditFields.ts`：code_version.files/definition_id/is_default、片段版本绑定语义。
- `src/features/videoEdit/application/videoEditCodeProjectReflection.ts`、`videoEditCodeProject.ts`、`videoEditCodeProjectUpgrade.ts`：精确文件事务与固定提交闭包升级。
- `src/core/application-control/domains/videoEdit/videoEditStyleCapabilities.ts`、`videoEditCodeProjectCapabilities.ts`、`videoEditApplicationCapabilities.ts`：正式操作入参及 near_cut/观察输出。
- `src/features/videoEdit/engine/videoEditAuthorCanvasRecorder.ts`、`videoEditAuthorRuntime.ts`、`videoEditAuthorLayers.ts`、`videoEditAuthorModule.ts`：ImageBitmap 身份比较、12帧/最多4组、clip 裁剪、pose 与逐层 motionBlur 开关。
- `src/features/videoEdit/application/videoEditCodeTrial.ts`、`videoEditFrameObservation.ts`、`src/core/videoEdit/codeMaterial/performance.ts`：相邻帧稳态与成本口径。

本步未执行任何画面、GPU、CPU 或真实播放验收；未运行测试、构建、应用或用户代码。本次文件为 L0 设计文档，不触发 L2/L3 提交前代码审查，也未派发子代理。未来若触及共享运行时、持久格式/IPC 等风险路径，需重新按 testing.md 分级并独立审查，不复用本步结论作为通过证据。

写入前后对风格库 JSON、两份 hjvid、当前 style/entries、相关 legacy 源码和仓库内置风格共 149 个文件计算合并 SHA-256，均为 `6df6e4447ff22b16b377a27aeb94e472f22699979a0cf76d6e9b8eb139b610ca`；文中完整仓库路径核查无缺失。t21 工作区仍干净，片子仓库未跟踪项与调研前一致，任务目录仅新增本 design.md。

## 9. Claude 裁定（11-01）
1. **工程范围**：升级本机风格库的 6 个点阵模板 kit 与在用样片；《元宝搜索》主片与暗色样片文档**不改**（主片现有 grain/pulse 已达目标，是用户的交付作品）；历史测试样片不升级。
2. **样片拆层**：本轮把在用样片的必要场景拆层一次做完（图块位图化 + 脉冲/闪烁拆独立 pose 小层），不分批。
3. **验收**：纯 Canvas 停稳段沿用率 ≥99%、零上传、章节标题 CPU 中位数与 p90 < 2 ms；视频与原生 GPU 单列；clip 备选不得冒充 pose 零上传。画面与改前人眼无差别（停稳与运动段各取帧对比）。
4. **片子代码**：不改、不造提交。
实施前按第 5 节备份风格库（整目录副本 + 哈希），失败可回滚；经正式入口发布与改指，不手改落盘文件。
