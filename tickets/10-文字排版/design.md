摘要：采用 Pretext 1.0.0 的断行规则与标点决策，HarfBuzz 整段整形提供唯一度量；发行 henji-layout 2.0.0 / 作者 API 8，旧冻结库与旧记录保持原行为。
摘要：字体改为模块静态声明、宿主出帧前准备；新路径只向 HarfBuzz 交付字节，会话回退链固定。layoutText / drawText / GraphemePose 保留调用形状，新增简单表格模块。
摘要：正文按第 13 节重写；第 12、13 节原样保留为裁定记录，冲突以第 13 节为准。本轮只改本文件，不安装依赖、不改代码、不运行实验或 Electron/GPU、不提交、合并或 push。

# Ticket 10 技术设计

## 1. 基线与范围决定

- 设计基线：`D:/VibeCode/Henji-AI-t10`，分支 `task/10-文字排版`，提交 `1de561750`。只读核对日期：2026-10-31。计划来源为同目录 `plan.md` 与仓库 `docs/task/代码效果与渲染改进/以后再做.md` 第 1 项。
- 第一阶段交付：中文、英文及日文标题的横排、富文本已有样式、逐字位姿、中英间距、两端对齐、简单无跨格表格、字形轮廓及实验 1–8。实验 6 的三维只验证轮廓消费成本，不建设三维字产品接口。
- 竖排不在本票实施：`ttb` 整形不等于具备竖排标点替换、直排横排混排和纵向避头尾；不增加半成品 writing-mode。hb-gpu、MSDF、GPU 字形图集、完整双向段落引擎、复杂表格继续留在后续或网页路线。
- 本票运行时切换范围为作者库新冻结版。宿主文字、字幕、图片编辑文字仍用当前实现；同时检查它们共享的字体资源与失效链，不把共享函数替换等同于“所有文字自动升级”。
- 当前仓库 `CODE_AUTHOR_API_VERSION = 7`，`henji-layout` 已有 `1.0.0 / 1.1.0 / 1.2.0`，最低作者接口均为 6；计划里的“v6”是库首次可用版本。`node_modules/electron/package.json` 为 44.9.3，官方发布表对应 Chromium 152.0.7977.167。[Electron 发布表](https://releases.electronjs.org/release)

## 2. 现有接口、调用方与冻结发行

### 2.1 作者接口的实际含义

权威实现：`src/features/videoEdit/authorLibraries/text.ts`；布局数据契约：`src/core/imaging/vectorContent/textDrawPlan.ts`。

```ts
layoutText(text: string | RichTextContent,
           style?: TextStyleInput, options?: TextOptions): TextLayout
drawText(context: OffscreenCanvasRenderingContext2D,
         layout: TextLayout, options?: TextDrawOptions): void
interface GraphemePose {
  x?: number; y?: number; scale?: number; rotate?: number; opacity?: number
}
```

- `layoutText` 同步返回深度只读布局；包括 `lines / graphemes / groups / box / contentSize / visibleContentSize / inkBounds / appearanceBounds / overflow / omittedRanges / fit`。`TextLayout` 去掉内部 `batches / rasterBounds`，不能由作者任意构造后交给 `drawText`。
- `GraphemePose` 是动画回调返回的位姿，并不是整形器输出。`x/y` 为相对排版位置的作品像素偏移；旋转为弧度；缩放和旋转围绕字素基线起点；`null` 隐藏。字位来自 `TextLayout.graphemes`，原文索引用 UTF-16，富文本段落间用一个换行连接。
- `TextOptions` 已含宽高、行数、fit、wrap、anchor、box、frame、direction、truncate、forceGraphemes。`maxWidth=0` 不限宽，`maxHeight=0` 默认截断全部行；宽度约束、换行宽度和放置盒不混用。
- 当前 `createTextDrawPlan` 以 Canvas 测量，`richText.ts` 以字素或 `Intl.Segmenter` 分词换行。普通静态绘制保留 Canvas 塑形；逐字模式由 `textGraphemeAtlas.ts` 将单字素重新排版进图集，跨字素连写和字偶距会丢失。
- 当前公开字素 `positionKind` 为 `native-estimate / individual / unavailable`；双向混排可能 `x=null`。不能把 glyph 数量、Unicode 码点数量、字素数量视为相等。
- 当前缓存按内容、样式、选项和字体代次复用布局，强引用最近 128 个；栅格预算为 32M 像素，通常 1×/2×/4×，逐字最低 2×。这些是旧版行为事实，不是新实现性能结论。

### 2.2 调用方边界

| 调用方 | 代码位置与现状 | 本票决定 |
|---|---|---|
| 作者素材/工程组件 | 编译器把 `henji-layout/text` 导入解析到冻结 URL；`flex.ts` 的 `layoutBoxes` 也调用 `layoutText` | text、flex、table 必须取同一冻结版和同一个文本核心实例 |
| 作者技能与示例 | `resources/assistant-skills/video-edit-code-creation/references/author-api.md`、`author-text-motion.md`、`recipes-text.md`、`recipes-text-data.md`、`code-project.md`；现有“表格参数”主要是结构化数据和 flex 数据卡 | 实施时更新新旧行为说明与可运行示例；不教助手重新手写测量/换行/表格列宽 |
| 宿主剪辑文字、字幕 | `src/services/vectorContent/textRaster.ts` → `createTextDrawPlan / paintTextDrawPlan`；剪辑共享文字入口在 `src/core/videoEdit/text.ts` | 保留算法与持久样式含义；只接共享资源生命周期的必要变化 |
| 图片编辑/矢量富文本 | `src/services/vectorContent/raster.ts`、`fonts.ts` 同样消费 core 布局和字体加载 | 回归字体变化，不自动改布局 |
| 网页路线 | `electron/main/services/web-source/page.ts` 等待 `document.fonts.ready`，`site.ts` 可提供字体文件；排版由 DOM/CSS 完成 | 作为独立对照及复杂版式路线，不把 Pretext 注入任意网页、不改写网页字体 |
| 元数据/样片/复核/预览/导出 | `videoEditAuthorModule.ts`、`videoEditAuthorPrograms.ts`、`videoEditPresetPreview.ts`、`videoEditRenderTransport.ts`、`videoEditWorker.ts` | 全部具备相同字体准备屏障、冻结模块解析和失效规则；复核继续读已有文字绘制事实 |

本票检查上述相关实现和状态切换；不据此宣称其他工作区已有全部排版能力。

### 2.3 新冻结版本的发布方式

1. 在 `src/core/videoEdit/codeMaterial/authorLibraries.ts` 登记新版本。版本确定为 `henji-layout@2.0.0`：虽然保留旧函数签名，默认断行与逐字字形语义发生可见变化；最低作者 API 为 8，已存在目录不可复用。
2. 改完源码并验证后才运行 `node scripts/freeze-layout-library.ts <新版本号>`。该脚本目前只生成 text/flex；本票需增加 table、静态字体声明类型、HarfBuzz ESM/wasm 资源、对应类型与完整许可证。
3. 冻结目录 `resources/video-edit-author/frozen/henji-layout/<版本>/` 保存 JS、类型、wasm、LICENSE/NOTICE 和 `release.json`。manifest 的 inputs 记录源码/补丁/锁文件，outputs 按原始字节计算 SHA-256；当前脚本的文本输出表需支持二进制，不能用 UTF-8 写 wasm。
4. 日常 `npm run build:author-libs` 仅校验和复制冻结内容到构建目录 `resources/author-libs/`（当前工作树尚未生成该目录）；`henji-media://author-lib/henji-layout/<版本>/…` 提供资源。现有 `electron/main/protocol.ts` 已支持 wasm MIME 和跨协议资源读取，不新增下载通道。
5. `CodeMaterialVersion.libraries` 钉住精确版本。已有导入继续原版本，缺失 libraries 的历史按首版解析；新建素材默认 API 8；已有素材只有显式升级作者 API 才可用 2.0.0，单独 `upgradeLibraries:true` 仍保持原 API（见 2.4）。升级创建新素材版本、改指可撤销，不重写历史源码与钉住关系。
6. 1.x 的源码产物、类型、license、release 摘要永久保留，日常构建不以新源码重新生成旧目录。新旧版本同时存在时，不共享可变字体匹配状态、排版缓存或 `TextLayout` 内部对象。

冻结只能固定作者库算法；系统字体被替换/删除、操作系统字体栅格与 Electron 升级仍可能影响旧版 Canvas 画面。“旧作品原样”验收限定同字体字节和同运行环境，不能把冻结 JS 宣称为跨机器像素封存。项目字体随包封存目前没有完整能力，本票不暗中加一个新资产格式。

### 2.4 版本钉住与显式升级

现有 `videoEditPresetPreview.ts::codeClip` 调用 `codeVersionCompilation(files, {})`，因此会按当前 API 和兼容最新库重编译。`styleSchemas.ts` 的样片与库模板代码体只有源码，没有该次渲染的版本选择。这条链必须与素材版本一样传递版本事实，不能只修素材导入。

- 在 `VideoEditStyleSample`、`VideoEditTemplateCodeBody` 上增加可选 `apiVersion` 与 `libraries`（库名到精确版本的只读映射），与各自 `code` 并列；预设预览源和编译请求显式携带同样两项。新建、由素材登记模板、提升模板、复制到工程、导入导出、样片渲染均写入或原样传递**实际**版本。已有代码资产导入使用其记录，不能当成“新建”抹掉版本。
- 对上述样片/模板/预览来源，两个字段均缺失时固定解释为 API 7 + **2026-10-31 的 API 7 库快照**：`henji-layout:1.2.0`、`henji-effects:1.0.0`、`three:0.186.1`、`opentype.js:2.0.0`；仅将实际导入的库写进编译结果。缺 API 时补 7；缺 libraries 时用该固定快照。明确给出的版本优先，若与 API 不兼容则报错，不默默降级。不能调用未来的 `latestAuthorLibraryVersions(7)`，否则之后追加 1.x 仍会漂移。
- 此历史缺省**只适用于原本未记录版本的样片/模板/预览来源**。已有 `CodeMaterialVersion` 缺 libraries 仍按原来的首版规则读取，不统一补成 1.2.0。编译身份、元数据缓存、指纹、预览和导出都使用同一个解析结果。版本字段与源码表分开传递，`normalizeCodeMaterialFiles` 后仍将原记录的 API/库交给 `codeVersionCompilation`，不能继续传空 publication 丢掉钉住。
- 原生文字/效果/转场预设没有独立作者源码时，预览用的宿主生成模块也显式钉住其 API/库（现有 BACKDROP 固定 API 7 及上述快照）；不得受全局最新 API 影响。预设包条目可带 `previewAuthor?: { apiVersion?: number; libraries?: Readonly<Record<string,string>> }`，解析后传入统一预览源；无此字段按固定历史值，带字段的导入项在现有个人预设记录中保留。新生成预览记录实际值，非作者内容的布局算法不因此切换。
- 风格/模板内容摘要须区分“补齐历史等价钉住”与“实际升级语义”：迁移不改变样片内容版本、不重算或丢弃已有 preview/thumbnail/anchors。旧缺省与显式历史快照归一为同一个语义身份；历史等价记录继续兼容原摘要，真正换 API/库才把版本身份加入摘要并要求重新渲染。不得仅因加字段把所有旧样片标成过期。

扩展既有 `upgrade_video_edit_code_materials`，增加可选 `upgradeAuthorApi: true`（面向用户描述“升到最新作者 API”）：省略/false 保持旧 API；true 把所选素材新版本的 API 升到当前版本，并为实际导入的库选取该 API 兼容的最新版本，因此同时包含升级库语义。`upgradeLibraries:true` 单独出现时只升级旧 API 兼容库，API ≤7 永远不会被它隐式切到 2.0.0。

正式升级服务须同时处理工程与非工程素材；版本相等判断包含源码、组件钉住、API 和实际 libraries，源码相同但 API/库变化也生成新版本。全部编译和参数迁移检查通过后，一次更改默认版本及使用中的引用，支持一步撤销；失败不留半升级状态。历史源码、版本与引用可恢复，不把“打开旧工程”变成升级操作。更新能力唯一声明、正式执行器与结果读回，Pi/MCP 自动投影；作者技能及 `codeMotionReview.ts` 的升级建议明确区分两种升级，不再只建议 upgradeLibraries 就能获得新排版。

## 3. 选型核查与适配边界

### 3.1 已核实事实

| 事实 | 一手证据 | 设计结论 |
|---|---|---|
| Pretext 包名是 `@chenglou/pretext`，1.0.0 的公开 prepare 参数没有外部测量函数 | [固定版本 layout.ts](https://github.com/chenglou/pretext/blob/v1.0.0/src/layout.ts) | 不能假设直接传入 HarfBuzz measurer 即可；不能改写 opaque prepared 对象冒充公开 API |
| Pretext 准备阶段用 Canvas；Worker 不具备其全部 DOM 探测条件，尤其 emoji 校正 | [固定版本 measurement.ts](https://github.com/chenglou/pretext/blob/v1.0.0/src/measurement.ts) | `layout` 的纯算术性质不等于 `prepare` 可在裸 Node 获得浏览器准确宽度 |
| 断行源涉及 Chromium 152 / ICU 78.2；HanKerning 注释引用 Chrome 153，harness 固定 Chrome 154 | [line-breaks.ts](https://github.com/chenglou/pretext/blob/v1.0.0/src/line-breaks.ts)、[han-kerning.ts](https://github.com/chenglou/pretext/blob/v1.0.0/src/han-kerning.ts)、[pins.json](https://github.com/chenglou/pretext/blob/v1.0.0/harness/pins.json) | “来源相近所以和 Electron 100% 相同”不成立，实验 1 是发布门槛 |
| 上游列出了窄宽、空格字距、紧急换行等已知差异；harness 的断点通过不代表宽度通过 | [ENGINE_FOLLOWUPS.md](https://github.com/chenglou/pretext/blob/v1.0.0/ENGINE_FOLLOWUPS.md)、[harness 说明](https://github.com/chenglou/pretext/blob/v1.0.0/harness/README.md) | 保留断点 100% 目标，宽度和字形另测；失败样本不从分母删除 |
| harfbuzzjs 1.6.4 升到 HarfBuzz 15.0；整形、字位和轮廓均有接口，默认入口使用顶层 await | [发布记录](https://github.com/harfbuzz/harfbuzzjs/releases/tag/v1.6.4)、[README](https://github.com/harfbuzz/harfbuzzjs/blob/v1.6.4/README.md)、[入口](https://github.com/harfbuzz/harfbuzzjs/blob/v1.6.4/src/index.ts) | 使用 1.x 的 Blob/Face/Font/Buffer API，不照搬旧版 createBlob/createFace 示例 |
| HarfBuzz 不做断行、两端对齐、字体回退或完整 bidi | [HarfBuzz 职责边界](https://harfbuzz.github.io/what-harfbuzz-doesnt-do.html) | 字体与方向分 run 是宿主/适配层责任；不把 `guessSegmentProperties` 当 bidi 算法 |

锁定上游：Pretext npm gitHead `4a98f37b1e5396a73197f17c13f3128c15d8c17c`；harfbuzzjs `3f162fa2c6ba68b40839fe2c11502a26632e20df`。以上为选型记录中的固定版本身份；本轮只读核对源码与官方资料，未安装或执行这些包。实施安装需锁精确版本及 integrity，不跟随 latest。

### 3.2 固定补丁的职责

第 13 节取代“三处 measurer 接缝足够”的假设：保留 Pretext 的 Unicode/UAX#14 数据、字素边界、富文本整段原文映射、避头尾及标点上下文规则；生产不走其 Canvas prepare，不以独立词/片段测量后相加来模拟整段。Pretext 只输出合法/紧急断行机会和标点压缩决策；选行与重整形由消费同一 HarfBuzz 段落结果的断行适配层负责。不是把 HB 包成 `measureText(segment)` 后沿用全部 Canvas 修正。

补丁按固定 tag + 独立 diff + 构建摘要保存。生产入口与上游 Canvas 对照入口分开，前者不得可达 Canvas/DOM 测量代码；保留原版只用于实验。规则按请求传 locale，固定 Blink 规则配置随 2.0.0 冻结，不按 Worker userAgent 重新选算法，不改全局 Canvas/FontFace 或跨请求 `setLocale`。本阶段默认 `zh-CN`，日文样本也据此对照；不声称具备完整 locale 选择器。

### 3.3 Pretext Canvas/DOM 探测逐项处置

下表依据固定版本 [measurement.ts](https://github.com/chenglou/pretext/blob/v1.0.0/src/measurement.ts) 与 [han-kerning.ts](https://github.com/chenglou/pretext/blob/v1.0.0/src/han-kerning.ts) 的实际入口。表中“关闭”包含其调用方与修正缓存，不是返回假宽度绕过探测。

| 探测/入口 | 生产替换或关闭 |
|---|---|
| 普通段宽、尾空格、空格/tab 基准：`getSegmentMetrics / getFollowingSpaceMetrics / getTextWidth / getSpaceWidth` | 读整段 shape 的 cluster advance、前缀和与空白规则；tab stop 以同脸 HB 空格度量计算。段落的词段不独立 shape。独立空格基准可按字体实例缓存，不替代上下文中的空格字位 |
| 字偶距及空格跨边界：`getFontSpaceKerning / getCharacterSpaceKerning / getSpaceKerning` | 关闭 Canvas 探针与差值补偿。HB 整段 GSUB/GPOS 已含 kern；行边界按 unsafe 标志重整形，不另加 ASCII pair 表 |
| 假名字偶距：`getFontKanaKerning / getKanaKerning / measureKanaKerning / getWholeRunContext` | 关闭“Canvas 分词漏 kern”补偿；完整 script/font/style run 一次 HB 整形，假名与标点上下文保留 |
| 连字检测：`isLigature / countLigaturesOnFirstLetter` | 以 HB cluster→原文字素映射与 glyph flags 判断共享簇；不用两字符宽度差猜连字。可选连字开关见 5.4 |
| 字形/字距计数：`getExtraSpacings`、`GLYPH_COUNT_SPACING` | 关闭超大 letterSpacing 反推；从 HB glyph/cluster 和 Pretext 字素映射得到可加字距的边界，组合 mark 不误加一次；glyph 数不等于字素数 |
| 紧急断词：`getSegmentFit / measureFitAdvances` 与前缀宽探针 | 直接查询整段 cluster 边界与前缀和；选中的不安全边界才局部重整形。不保留上游 80px 等探测成本阈值、不逐前缀 shape |
| 连字符：`getHyphenText / measureIn` | 主脸 cmap/nominal glyph 检查 U+2010，否则 U+002D；以 HB 取得字位。软连字符未断行时不显示，断在此处才把可见连字符纳入边缘重整形与选行；不靠 Canvas 墨迹猜实际脸 |
| emoji 校正与计数：`getEmojiCorrection / readEmojiWidth / readWidthIn / getEmojiGlyphs / countEmojiGlyphs` | 全部关闭浏览器 DOM/Canvas 宽度校正；使用实际回退脸的 HB 簇 advance。emoji 彩色回退只替换绘制，不反向修改度量或断点 |
| 标点墨迹、halt 能力与 trim：`getTypeFromBounds / getFontData / getTrim / getHanKerningTrims` | HB glyph extents + offset + advance 给出开/闭/居中分类；无 extents 时从同 glyph 轮廓求范围。字体 feature 表及实际 HB 特性对照验证 halt/chws；Pretext 输出作用范围/行边决策，HB 负责相应替换，移除 Canvas 宽差 trim 和重复扣宽 |
| 字体可用性/generic/locale：`hasFamily / getWebKitGenericFamilies / contextTakesFont / getCanvasFont` | 字体会话从平台目录选择实际脸与字节；不通过 Canvas font 字符串是否接受、墨迹或 WebKit generic 表猜脸。locale 是显式请求事实 |
| 上下文、引擎 profile 与 Canvas letterSpacing 能力：`createContext / createMeasureState / getContext / buildEngineProfile` | 生产不创建测量画布、不读 DOM/userAgent 决定行为；冻结规则配置，字距算术和 LayoutUnit 转换在共同几何层执行 |

实施验收须搜索全部 `measureText / actualBoundingBox / getContext / document / OffscreenCanvas` 的可达路径，覆盖 text、rich-inline、flex、table；在没有这些全局对象的 CPU 环境验证纯整形排版可用。生产普通文字“零 Canvas 测量”是结构约束，emoji 绘制例外不能偷带测量。相关接口若需包装补丁，随冻结版保存，不改上游 opaque prepared 对象冒充 API。

### 3.4 选型与冻结纪律

继续使用已裁定的 Pretext 1.0.0 + harfbuzzjs 1.6.4；代价是维护规则/整形接缝、unsafe 局部重排与确定性字体会话。不是未经验证的“小补丁即可完成”。先做实验 1–3 的共同度量与标点验证；若仍须引入完整 bidi 引擎或大范围复制 Blink，停止扩张并将证据交 Claude，再比较 CanvasKit。

Electron/Pretext/HB/字体变化后复跑受影响实验；如果 Electron 升级造成既有 2.0.0 与新 DOM 的差异，只发布新冻结版本修正，既有 2.0.0 字节、规则配置和作品钉住保持不变。冻结算法不能封存 OS 字体和 Canvas 抗锯齿；跨机器像素保证仍以相同字体字节与运行环境为前提。

## 4. Worker、静态字体声明与会话资源

### 4.1 现有链与新屏障的位置

当前 `videoEditRenderTransport.ts::fontsDocument` 根据当前帧、嵌套序列源时间和转场两侧收集字体；`applyFonts` 比较字体库 revision，发送 additions、availableIds、reset。`videoEditWorker.ts` 的 `fonts` 分支在渲染 queue 内执行，`LoadedFontFaces.retainIds` 淘汰本轮不在集合的字体。因此现状是**逐帧同步 + 淘汰**，不是文档级或会话级字体就绪屏障。

API 8 新库使用独立的会话字节字体资源集；1.x 与宿主文字继续原 FontFaceSet 链。作者 draw/layers 与宿主渲染处在同一个 `videoEditWorker.ts`，不另开每素材渲染线程。纯排版核心位于 `src/core/imaging/vectorContent/` 的独立模块，冻结到新库；宿主端口和作者封装仍各归本层。字体解析/解压使用已有 `electron/main/services/fonts/worker.ts` CPU worker，主进程负责 I/O，Worker 不直接访问 PAL/文件。

### 4.2 字体声明的形状与覆盖边界

删除作者异步字体准备入口，不导出 `prepareTextFonts`。新增 API 8 模块级静态元数据，示意如下（这是待实现契约，不是当前已有 API）：

```ts
export const textFonts = {
  faces: [
    { family: 'Noto Sans CJK SC', weight: 700, style: 'normal', variations: {} }
  ],
  text: ['固定标题 2026'],
  bindings: [{ text: 'title', style: 'titleStyle' }],
  scripts: ['Latn', 'Hani']
} as const
```

- `faces` 项：`family: string`，`weight?: number`（默认 400），`style?: 'normal'|'italic'|'oblique'`（默认 normal），`variations?: Readonly<Record<string,number>>`（OpenType 四字符轴 tag → 有限轴值）。完整字体名仍指向实际脸；字体匹配采用规范化后的请求，不能始终选 regular。features 属于排版请求/缓存键，不用它重新选择字体文件。
- `text?: readonly string[]` 提供模块常量文字，宿主由完整字素推导实际 script/emoji/VS 需求；`bindings?: readonly { text: string; style: string }[]` 指向本模块文本/富文本参数和 font/textStyle 参数，取已合并默认值的本次有效参数。`scripts?: readonly string[]` 使用 Unicode script 短名，并允许 `Emoji` 需求标记，声明代码计算文字可能用到的系统。Common/Inherited 由上下文及整簇覆盖检查解决，不各加载一套字体。
- 元数据是只读数据，不是回调、Promise、URL 或文件路径。编译阶段用现有 TS/JS 解析基础设施提取可静态读取的字面量/同模块常量引用，汇集依赖闭包各模块的声明；不能为了读取它先执行作者模块。参数绑定在作用域内解析，默认值纳入编译元数据；参数值未知时只预热明确声明的 faces/scripts，不把任意 JS 求值当字体扫描器。这是资源声明的可读性要求，不是限制作者 JS 表达能力的 AST 白名单。
- `font / textStyle` 参数沿现有元数据补入请求；固定字体和运行时可能选择的额外字体在 `faces` 列齐，动态字符串的书写系统在 `scripts` 列齐。不要求重复填每个字号或每个文字实例；按实际请求与 script 懒加载，不枚举所有已安装字体。
- 默认 generic 也解析为实际脸。缺指定脸走固定回退并报告；声明之外的字体/script 在同步 layout/draw 中不能发起 I/O，也不能临时选“此刻已加载”的脸。返回可定位到模块和声明缺项的准备错误，补声明或更新参数后经正式准备重试，不把半就绪帧呈现出来。

### 4.3 生命周期与绕开渲染 queue 的通道

顺序为：**编译并读静态声明 → 建立会话字体快照 → 加载冻结库 wasm → 准备本次声明/参数所需字体 → 确认 ready → 确定性作者模块求值 → 同步 layers/draw → 提交首帧**。模块顶层只要使用已声明的固定字体仍可同步 layoutText；不在 import 中 await 字体、不重复执行模块来发现字体。若声明提取尚未完成，不能先进入模块求值“试一下”。

具体接线：在既有 RenderTransport/Worker 连接初始化时移交一个专用 `MessagePort`，承载内部 `prepare / payload / ready / failed / cancel / dispose` 消息，含 sessionId、requestId、字体库 revision 和准备代次。Worker 收件函数在 `queue = queue.then(...)` **之前**分流该端口；资源接收、HB 对象构造、就绪回执均不排入渲染 queue。宿主处理请求沿现有 `platform/fonts → fonts IPC → 字体 service/CPU worker`，无需新文件下载或日志通道。

- RenderTransport 在将相关 frame/update/init 放入渲染执行阶段前等待字体 ready；即使一个在途 frame 等待资源，payload 回执也能独立到达。资源处理只更新会话资源表，不调用作者函数、不重入绘制。
- HarfBuzz ESM/wasm 的异步初始化在 `importAuthorDeterministic` 之外先完成；作者 import 只消费已初始化模块。`videoEditAuthorDeterminism.ts` 的导入串行链与 Math.random/Date/performance 临时替换不能覆盖字体 I/O 或资源等待，也不能以同队列里的字体响应解锁它自身。
- 参数改字体/文字 script 时，先准备增量，再原子切换参数与布局代次。播放中后续素材首次出现可准备新需求，但已解析链不重排、不淘汰先前字体。seek、导出起帧、样片渲染、元数据探测、取帧复核和指纹 Worker 均用相同准备服务，不能仅修节目窗口。
- 元数据读取只提取声明时不初始化 GPU；若需要执行模块求值，则也先完成该模块静态字体准备。指纹计算先纳入解析后的资源身份，不能用“无字体版”输出命中“有字体版”的预渲染缓存。
- 取消一个请求只取消其等待/订阅，不撤销其他使用者共享的资源加载。关闭会话使代次失效、关闭端口并释放引用；迟到响应按 session/revision/request 验证后丢弃并释放，不激活旧会话。失败经现有日志/失败回执点名字体与阶段，不静默换引擎。

### 4.4 字体字节与会话常驻回退链

回退链身份只由 **规范化请求字体（family/weight/style/axes）、冻结的平台候选表、字体库修订号** 决定，候选表内容摘要属于冻结实现。不得受当前帧、加载完成顺序、LRU、其他素材用过什么字体影响。文本/script 只决定该固定链中哪些候选需要加载；候选次序先固定，选脸必须依序完整覆盖测试，不能跳过未 ready 的前候选抢用后面的已加载字体。

平台候选表为 Win x64/macOS arm64 分别提供 Latin/CJK/假名/emoji 与 generic 具体候选顺序。原则为指定脸 → 同 family 匹配脸 → 该 script 的平台候选 → 明确最后回退；用字体目录覆盖事实和整字素试 shape 选择，缺失脸也记入快照。连字符、组合 mark、VS、ZWJ 均按完整簇选脸；相邻同脸同 shaping 样式同 script 的字素合并后整形，不逐字 shape。

会话已准备链、SFNT 字节、被其引用的 Face/Font **会话内常驻并 pin**，不随 frame availableIds 或像素缓存 LRU 回收。脚本懒加载指首用前等待，不指用完一帧就卸载。读取字节后再次核对目录 revision 与文件内容身份，变化则重建请求快照，不把新字节混入旧快照。字体库修订号改变时建立新快照，先准备再切换；旧快照保留至在途帧/导出任务结束，预渲染、指纹、layout/raster 全部按 revision + 完整候选链摘要 + 实际字体内容身份失效。导出任务固定一个快照；期间字体库变化不能让前后帧混用。新旧 Worker 在同 revision/候选表/字节下应解析为同一链，不要求跨 OS 用相同字体。

| 来源 | 新路径处理 |
|---|---|
| TTF/OTF | 复用 `fonts.list/readFace`，规范化字节只交 HB Blob/Face/Font；新生产路径不注册 FontFace、不生成 CSS 别名 |
| TTC/dfont | 沿 `metadata.ts::standaloneFont` 提取独立脸并保留表；HB face index 用 0，原集合索引仅作来源信息 |
| WOFF/WOFF2 | 当前 standaloneFont 原样返回压缩内容；实施采用成熟 SFNT 转换方案（候选 `fontverter@2.0.0`，内部使用 wawoff2 等），在字体 CPU worker 转换并哈希，先验证表完整性；不手写解压、不以 fontkit subset 丢表 |
| 用户导入/项目所用字体 | 走全局字体库。现有 `catalog.ts::filterFonts('project')` 是已用名称筛选，不是项目携带字节；本票不新增项目字体打包/自动发现 |
| 对照 DOM | 仅实验页面将同一 SFNT 注册独立 FontFace 并等待 ready，映射实际脸/weight/style/axes；生产 HB 不受对照 FontFaceSet 影响 |
| 彩色 emoji 例外 | 如精简 HB 构建无法绘制彩色簇，使用系统 emoji Canvas 绘制，位置/advance 仍由 HB 决定；不注册自定义 FontFace，列为已知平台差异，见 5.4/实验7 |

参考：[fontverter](https://github.com/papandreou/fontverter)、[wawoff2](https://github.com/fontello/wawoff2)。所有候选都缺字时输出明确 missing-glyph 事实及稳定替代簇，不能把 tofu 当通过。真实粗斜脸优先；fauxBold/fauxItalic 沿外观层执行一次。可变轴按请求显式固定，包括 opsz 的规则；字体对象发布后不可变，同 Face 的不同轴 Font 分开缓存。

### 4.5 wasm 发行、共享与显式释放

本票**不把 harfbuzzjs 登记成独立的公开作者库**：唯一消费者是本票排版，新增公开可变对象 API 会增加类型、生命周期和跨版本组合成本。将其运行时做为 henji-layout 2.0.0 的共同内部 ESM/wasm 依赖，text/flex/table 共享同一个实例；按内容哈希共享字体，已能避免每个入口复制 CJK 字体。未来有独立作者调用需求再单独评估，不让作者自行释放宿主字体对象。

- 冻结目录包含实际 wasm 二进制、ESM、类型、许可证与来源/补丁摘要；模块相对 URL 离线装载，构建按原始字节哈希。不同冻结版不共享可变 wasm memory；不同 Worker 有独立实例，传输专用 buffer 副本，不 detach PAL 的缓存原件。
- 字节键为规范化 SFNT SHA-256；Face 键加 face index/构建身份；Font 键加规范化轴、尺度和合成配置。对象不可变，变轴新建；只读字节可共享，跨版本可变状态不可共享。
- [harfbuzzjs 1.6.4 helpers.ts](https://github.com/harfbuzz/harfbuzzjs/blob/v1.6.4/src/helpers.ts) 目前用 FinalizationRegistry 且无公共 destroy。本票须随冻结依赖加可审计的显式 dispose 包装补丁：统一所有权、注册可注销 token、幂等释放、先 unregister 后调用对应 HB destroy；dispose 后禁止再访问，不能手动 free 后仍被 finalizer 二次释放。
- 会话持有的回退字体不参加 LRU；**最后会话/布局引用释放之后**才可淘汰 Font→Face→Blob 并显式释放 wasm 原生对象，临时 Buffer/轮廓/栅格按引用和软预算回收。释放使 wasm heap 中空间可重用，不保证 WebAssembly.Memory 或 OS RSS 立刻缩小；最终 Worker 结束释放整个实例。大文件/数量不设硬拒绝上限。
- 实验 4 区分字节、HB 对象、heap 高水位与进程 RSS，验证重复 prepare 不重复创建、取消和迟到结果无泄漏。旧库 FontFaceSet 的加载/淘汰保持原路径，新库不在旧别名下覆盖、删除或额外注册字体。

## 5. 整段整形、断行与字素动画

### 5.1 唯一流水线

“整段一次”指**先保留完整段落上下文，再按字体/script/direction/实际 shaping 样式划分必要 run，每个 run 初始只 shape 一次**；HB 单次 shape 只能接收一套 Font，不是强迫多字体段落塞进一个 Font。Pretext 的词、断行机会、富文本 span 边界都不自动成为 shaping 边界。颜色等仅绘制属性变化不拆 shaping run。

1. **解析与映射**：沿 `parseTextInput / textStyleSchema` 解析原文与富文本，保留 UTF-16 原文→段落→样式→字素映射。应用 allCaps/smallCaps 等文字变换时另存显示文本映射（一个原字素可展开多个码点）；源码范围、揭示索引仍指原文。硬换行切段，软连字符和折叠空白保留可追踪的归属。
2. **准备资源**：取得 4.3 的 ready 快照，按完整字素选脸；给每个 run 明确 language/script/direction/font/字号/axes/features，规范化 feature 范围。不得把 `guessSegmentProperties` 当完整 bidi；本票没有完整混合双向段落引擎。
3. **规则与标点计划**：Pretext 扫描完整段落并输出硬断点、正常/紧急机会与避头尾约束。标点静态类别沿其规则，字体相关类别来自同字体 HB extents；生成段内特性范围及各候选行首/尾的决策。字体分类探针可按字体实例缓存，它们不承担正文宽度测量。
4. **整段初始 shape**：每个必要 run 用完整段落文本及 itemOffset/itemLength 提供上下文，保留原文 cluster 偏移。设置字体尺度、features、轴值和 buffer flags，得到 glyph IDs、advance/offset、cluster 与 unsafe flags；建立 glyph↔字素多对多映射和精确 advance 前缀和。不得逐词、逐 Pretext segment 或逐字素测完再拼。
5. **候选选行**：适配层只在 Pretext 给出的机会中选行；候选宽从上述结果切片，加 tracking/数字 kerning/tsume/中英间距、tab 与尾空白规则，再应用该候选的行边标点/连字符决策。宽度按 5.3 量化；不以 Canvas 宽或 Pretext 旧 prepared.width 驱动选行。
6. **边缘修复**：普通安全断点直接切片，复用段落 glyph。只有不安全的断点，或行边特性/可见连字符实际改变输入的边缘，走 5.2 的局部重整形；更新候选宽再检查 fit。不能每一行无条件重新 shape。
7. **放置与公开结果**：确定行之后再应用 justify、align、anchor、baseline、fit/截断/省略号与边界计算。省略号也是同字体链的 HB shaping，选截断点时计入其宽度；fit 改字号/有效 opsz 后重新走同一流水线。内部 glyph 绘制计划与公开 TextLayout 从同一结果派生，drawText 不再以单字符 fillText 重新整形普通文字。

### 5.2 unsafe_to_break、局部重整形与收敛

[HarfBuzz 15 glyph flags](https://github.com/harfbuzz/harfbuzz/blob/15.0.0/src/hb-buffer.h) 明确：unsafe_to_break 表示在该 cluster 起点切开后两侧可能改变；它**不是禁止在这里换行**。无标志的 cluster 边界可直接复用，cluster 内部没有独立 flags，不能当“安全”。Skia 的 [SkShaper HarfBuzz 实现](https://skia.googlesource.com/skia/+/f4aab0584dc844b1fa38e299ff1a9c1922c06a99/modules/skshaper/src/SkShaper_harfbuzz.cpp) 保存该事实；本设计采用第 13 节所指的段落 shaping 后切行/按需 reshape 路线，不把具体库内部行为当成未经验证的等价证明。

- 候选若落在共享 cluster 内（例如长词紧急断到可选连字内部），视为需要重整形；不拆 glyph 或按平均宽度造半个 glyph。仍只接受合法字素边界，不能切 UTF-16 代理对、组合簇或 emoji ZWJ。
- 请求 `PRODUCE_UNSAFE_TO_CONCAT`，同时读取 unsafe_to_break；向断点左右寻找可安全拼接边界，重整形行尾与下一行行首的受影响区段，设置真实文本/行上下文和对应边缘特性。新结果的拼接点也要安全；否则继续向外扩大到必要 run/段落边界，不以“只重排前后两个字”当通用规则。
- harfbuzzjs 1.6.4 的 `getGlyphInfos / getGlyphInfosAndPositions` 已返回 flags，`BufferFlag.PRODUCE_UNSAFE_TO_CONCAT` 也已暴露，应直接接入并验证；初期宁可重整形受影响 run 的左右两部分，也不能在适配时丢掉 flags 后当零。该保守范围只由不安全切点触发；无需把整个段落所有行重做。纯安全行边无变化时保持初始 glyph 数组及字体身份。
- 字符替换（软连字符/省略号）、行首/尾 halt/chws 特性范围变化同样使**对应边缘计划失效**；原结果上的 safe 标志仅对原输入/原 features 有效。只重整形确有变化的边缘，不能以“没有 unsafe 标志”为由沿用失效字形，也不能因一个标点变化重做每行。
- 每个候选以 `(段落shape键, 行起止, 边缘输入/feature计划)` 缓存修复结果。用修复后的真实 occupied width 决定是否放得下；超宽退到上一个合法机会，修复后变窄可验证后续候选，以选出规则允许的最远合适边界。依规则有序遍历有限机会，每候选至多计算一次；不靠任意循环上限、epsilon 放宽、缩放 glyph 或移动末字掩盖差异。
- 下一行消费修复后的行首，不能仍读原段的错误字偶距。没有任何可放下的机会时，按 wrap 的紧急断行/单簇 overflow 语义产出事实，不无限重试。原文映射、omittedRanges 和复核几何随最终计划更新。

### 5.3 唯一度量与 LayoutUnit

`Woccupied = Σ HB.xAdvance + Σ 字距/tsume/中英附加间距 + Σ justify − 规则允许悬挂的尾空白`。HB kern 与 halt/chws 已反映在 glyph advance/offset 中，不能再叠加 Pretext 的 Canvas 补偿/trim。墨迹边界来自 glyph extents 与 placement，不是 advance 的另一种叫法。

字体单位值保持精确到换算阶段；作品像素为内部几何基准，不把 DPR/输出密度混入排版。比较可用宽与占用宽时采用 Blink **LayoutUnit（1/64 CSS px）** 的同阶段转换/舍入，单位相同再作整数比较，不沿用 Pretext 的 0.005px fit epsilon，也不能对每个 glyph 单独四舍五入后求和。依据固定 [Chromium 152 layout_unit.h](https://github.com/chromium/chromium/blob/152.0.7977.167/third_party/blink/renderer/platform/geometry/layout_unit.h) 区分构造截断、Floor、Ceil、Round；实施须核对调用处使用哪一种，不能统一用 `Math.round(width*64)` 宣称模拟 Blink。

实验 2 同时报告原始 HB advance、布局 occupied width、量化后的对照宽、DOM Range 宽与墨迹宽。**几何误差 ≤1/64 作品像素；临界断点按量化宽判定一致**。W−1/64、W、W+1/64 与半格边界均入附加样本；量化后相同的宽度必须作相同判断。原始浮点值跨过未量化阈值但量化后相等不判错；超过一个 LayoutUnit 的差异仍须修复。Canvas Pretext 仅是独立对照，不能将两个来自相同 HB 数组的求和互相比较当成功证据。

### 5.4 字素揭示、位姿与连字

- `drawText(..., { graphemes })` 的 number、索引集合、回调三种形态都触发逐字素模式，该排版段关闭可选 `liga/clig`；`forceGraphemes:true` 可在 layoutText 阶段提前选同一模式。保留 kern/mark/curs/必需 rlig 等，不以关闭全部 OpenType 换取“每字一个 glyph”。Latin/CJK 可拆字素各有独立簇，一个字素仍可有多个 glyph。
- 复杂书写系统的必需连字保持整簇，使用原文逻辑顺序的**首字素**作为 owner；其位姿、透明度和是否被选中决定整簇。number=N 以 owner 索引是否小于 N 判定；索引集合只选中簇内非 owner 不显示该簇；回调可给所有字素求值，但非 owner 的结果不用于绘制该簇。整簇只画一次，不报“组内姿态不相同”、不裁半个连字，不承诺复杂连写可逐字飞散。
- 必需连字簇的非 owner 位置不能标记为可独立绘制的 individual；公开字素仍按逻辑原文排列，内部记录 owner/range。观察事实报告整簇的实际可见性、位姿和边界，避免把同一 glyph 计多次。
- **调用时序补充提案（待第 11 节确认）**：graphemes 目前只在 drawText 才传入，layoutText 已返回不可变几何。建议 layoutText 同步缓存普通与禁可选连字两个计划，默认公开普通计划；graphemes 绘制固定选动画计划，回调收到动画计划的字素几何，观察器也记录动画计划；`forceGraphemes:true` 返回的公开几何就是动画计划。首次动画绘制不得改写已返回的 TextLayout，动画完成仍保留 graphemes（全选）避免切回连字版。若作者需在绘制前读取精确动画行框，应在 layoutText 用 forceGraphemes。两计划确实可能不同的断行/行框语义须由 Claude 确认，不能伪称旧调用形状天然解决该问题；确认前不实施该接缝。
- 首阶段没有完整 UAX#9；复杂混合 bidi 保持已明确的原生兼容路径与 unavailable/x=null 语义，独立列回归，不纳入新 HB 字位准确覆盖。不用自写重排算法，也不从兼容路径反向提供新引擎宽度。
- AAT（如 morx/kerx）与位图 emoji 不能假定 HB_TINY 支持；实验 7 检验真实构建与字体表。纯轮廓文字用 HB glyphToPath/glyphToJson；彩色能力可用才走对应 paint/PNG。精简构建画不了的 emoji 簇，允许 Canvas **系统 emoji** 在 HB 指定的簇原点/基线上整簇绘制：HB 决定位置和宽度，Canvas 不做测量校正。记录实际回退和平台差异，不保证它与指定自定义 emoji 字节像素一致，不用于矢量描边生长/挤出。

### 5.5 样式语义与排版责任

| 项目 | 规则 |
|---|---|
| wrap | 新版省略时 normal；word 为单词优先 + 超长词紧急断行；grapheme 沿合法字素边界强断，对照 `line-break:anywhere`；none 只硬换行。不把字素强断宣称仍满足避头尾 |
| 标点挤压 | Pretext 决定位置和特性范围；HB 同字体 extents 判字形类别，再按实际字体支持执行 halt/chws。不能整段两者同时强开、重复扣宽或压缩轮廓；无字体支持则保留自然字形并报告对照差异 |
| 中英间距 | 按 CSS Text 4 的表意字母/数字边界，默认相邻表意字体 1/8 em；不插字符；已有空白、行首/尾不重复加；作为断行前附加距离参与候选宽，换行时回收边界距离 |
| tracking / kerning | 保留千分之一 em；数字 kerning 是既有附加字距语义，auto 由 HB kern 处理。明确定义开关后只应用一次，不能再开 Canvas letterSpacing。必需簇内部不分配字距 |
| tsume | 沿当前 `text.ts/metrics.ts` 含义：0–100% 压缩字形推进量，不横向压缩轮廓；在 HB 完成字位后按簇的可分配推进扣减，glyph offset 与轮廓保持，下一簇起点相应前移。与 halt/chws 的形状替换分开记账，按压缩后的 HB advance 应用一次；组合 mark 不另扣一次 |
| allCaps / smallCaps | 保留既有合成语义，allCaps 优先。源字素转大写并保留映射；smallCaps 仅原小写部分使用 0.75 倍字号，已大写不缩。按各自实际字号重新整形并参与行宽/墨迹计算，不把大号 glyph 缩图当同一度量。不自动启用 smcp/c2sc 取代已有语义 |
| superscript / subscript | 保留 0.65 倍字号整形，上标基线移 −0.35×原字号、下标 +0.2×原字号，二者同时启用以上标优先；可与 smallCaps 的 0.75 叠乘。另叠加现有 baselineShift（正数上移）。不同时启用 sups/subs 再缩小一次；每个实际字号/opsz 独立 shape |
| justify | 沿既有 align 枚举：末行默认不拉伸，justify-center/right 控制末行，justify-all 包含末行。只在合法空白/CJK 间隙扩展，不拆必需簇、不缩放 glyph；单簇行保持自然宽 |
| fit / 截断 / 外观 | 保留宽高/行数/anchor/box/omittedRanges 契约；fit 改字号须重新 shape，省略号参与度量。底板、阴影、外描边、填充、内描边、装饰线维持既有层次，实际绘制事实可供复核 |

CSS 字类依据：[CSS Text 4 text-autospace](https://www.w3.org/TR/css-text-4/#text-autospace-property)。常用横排和简单富文本在本票验收范围；竖排、完整 bidi 与复杂段落继续另行设计。

## 6. 简单表格

新增 `henji-layout/table`，属于同一个新冻结版本。表格是排版结果，不是新持久节点或 UI 表格组件；与现有作者 `table` 参数（数据）区分。

```ts
interface TableColumn {
  key: string
  width?: number                  // 作品像素；省略为自动列
  align?: 'left' | 'center' | 'right'
  numeric?: boolean              // 启用 tnum，缺省右对齐
}
interface TableCell { text: string | RichTextContent; style?: TextStyleInput }
interface TableInput {
  columns: readonly TableColumn[]
  rows: readonly Readonly<Record<string, string | TableCell>>[]
  style?: TextStyleInput
}
interface TableOptions {
  width?: number
  cellPadding?: number           // 默认 0
  columnGap?: number             // 默认 0
  rowGap?: number                // 默认 0
}
layoutTable(input: TableInput, options?: TableOptions): TableLayout
// TableLayout：只读列宽、行高、外框、overflow、cells[{row,column,box,contentBox,text:TextLayout}]
```

数值和日期格式化由调用者给定字符串，不加地区格式化系统。缺失单元格为空，未知 column key 报输入问题；无跨行跨列、百分比列、排序、分页、复杂边框或自动挤字号。绘制循环复用 `drawText`；边框和底板由作者按 box 画，不再增加同功能绘制器。

算法为明确的 CSS auto-table 子集，参考 [CSS Tables 内容度量与宽度分配](https://www.w3.org/TR/css-tables-3/#computing-column-measures)，不宣称等同浏览器完整表格布局：

1. 每个单元格用同一文本核心计算 `min-content`（正常合法不可断单元的最大宽度）与 `max-content`（仅显式换行的最大行宽），加左右 padding；列分别取各行最大值。长词的 min-content 不因 break-word 的紧急换行被误算成一个字。
2. 固定列先保留指定宽；自动列下界为 min，上界为 max。无指定表宽时取各 max，加 gaps；有宽度时先扣固定列和 gaps。
3. 自动列可用宽在总 min/max 之间时，按 `(max_i-min_i)` 比例分配剩余；大于总 max 时，超额在自动列等分；全固定列则保留固定列宽，允许表框留白。
4. 可用宽不足总 min 时，自动列保持 min，返回真实 overflow，不静默压缩字形或丢单元格；固定窄列内部允许既定紧急换行。作者可加宽、改固定列、缩字号或分表。
5. 最终列宽确定后逐格排版；行高取该行最高内容加上下 padding。第一版单元格顶对齐，基线由其文本布局提供。复杂混合基线表格仍交网页。
6. 数字列在测量前把 `tnum=1`、`pnum=0` 加到 HB shaping；布局和绘制使用相同 glyph。对 fallback 脸也检查 0–9 实际 advance；未支持 tnum 且数字不等宽时明确报告，不能把 `font-feature-settings` 已设置当作成功，也不逐数字套等宽盒假装 tnum。实验比较支持 tnum 与不支持的字体，后者必须有可见诊断。

数字列的 features 是库内单元格排版请求，不改共享 `TextStyle` schema。不为它新增全应用 OpenType 面板。

## 7. 稳定绘制身份、密度缓存与失效

### 7.1 路径与录制器复用

现有 `videoEditAuthorCanvasRecorder.ts` 把任意作者 Path2D 当可变 live 对象，会令指令不可比对；仅缓存 Path2D 实例仍会每帧重栅格和上传。本票扩展现有录制器的内部资源协议：库构造并持有不可变字形路径，将其与稳定内容键登记在宿主控制的 WeakMap；记录 fill/stroke/clip 时编码该键和绘制状态，重放时解析同一路径。作者拿不到可变路径引用；任意作者 Path2D 仍按 live 处理，不凭作者声称“不可变”复用。

路径身份包含冻结库/路径格式、规范化字体哈希、face、轴、glyph ID、轮廓命令摘要与填充规则；同一内容重建得到同一语义键，不能只用运行时递增 id。录制器仍比较位姿、颜色、透明度、裁剪、混合、外观及采样密度。静态指令命中时复用既有图层纹理，整层移动优先沿现有 pose；逐字位姿变了须重合成，但复用字形资源。指纹 Worker 只序列化轮廓内容身份和数值，不需要创建 Path2D 或 GPU。

### 7.2 外观栅格与成本边界

纯填充可按稳定路径录制；带描边/阴影的字以**字素/必需连字簇**为单位，按密度档缓存紧边界栅格或图集单元。边界包含真实 ink、描边外扩、阴影模糊和位移；沿既有 appearance 算法在首次/失效时绘制紧尺寸画布，产出不可变位图。按层次分别保存阴影/外描边、填充/内描边等必要层并批量合成，不能逐字画完全部外观而改变跨字遮挡顺序。

每帧仅变换、透明度合成所需单元，不为每个字新建两张整作品画布；整段底板/装饰线沿独立稳定层缓存。空白簇不分配像素，必需连字只占一个簇单元。推近由总变换与输出密度选择合适档，越档才重栅格，密度不固定封顶 4×；超设备单纹理尺寸时分片，不以字体大小硬拒绝。图集单元 padding 防止过滤串色，回收按实际像素/字节软预算。

4ms 门槛仅用于**典型 200 可见字、1080p、纯填充、逐字位姿**文字阶段 P95（位姿求值、路径提交/回放、2D 栅格及该阶段必要上传）；同时报告整帧 P50/P95/max、播放跳帧与合成 p90。静态复用单列，不能拿静态命中冒充动画通过；描边、阴影、多重外观、1000 字/4K 压力独立列数据，不受纯填充 4ms 一刀切。冷准备不藏进热帧统计，运动模糊多采样列实际次数。

### 7.3 完整缓存键与生命周期

| 层 | 必须进入身份的事实 |
|---|---|
| 字体/回退会话 | 规范化请求、平台候选表版本/内容、字体库 revision、完整有序候选链（含缺失候选）、规范化 SFNT 哈希/face；与当前帧无关 |
| 规则分析 | Pretext/补丁/Unicode 数据身份、原文与富文本映射、language、wrap/空白/禁则规则；不依赖字体宽度，不用只含 CSS font 的 prepare 缓存 |
| 段落 shape | HB 构建/冻结版、原文与显示文本映射、完整 run 上下文、实际 font/face/hash、字号/scale、script/language/direction、cluster level/buffer flags、**规范化 OpenType features（tag/value/原文范围）与 variable axes（tag/value）**、合成字形/大小写/上下标模式、可选连字模式、回退快照。范围相同但周边字不同不可误命中 |
| 行边重整形 | 段落 shape 键、行起止原文 offset、左右安全拼接点、边缘上下文/flags、标点特性计划、可见连字符/省略号替换、特性范围；不能只按 substring 缓存 |
| 最终 layout | shape 与边缘计划键、宽高/fit/截断/行数、spacing/tsume/justify/align、anchor/box/frame、量化规则、回退 revision/链；可共享不含放置的中间数据，但公开几何键不能漏放置参数 |
| glyph 轮廓/稳定路径 | font 哈希/face/轴、glyph ID、轮廓版本/命令身份、填充规则；尺度若已烘焙也入键。features 已映射到 glyph 及 placement，不把同 codepoint 误当同 glyph |
| 逐簇外观栅格 | glyph 及相对字位、实际字号/合成变换、填充/描边/阴影/装饰参数、密度档/栅格原点策略、颜色空间；必要时加亚像素相位。逐帧位姿/时间不进几何键，位姿导致密度/相位变化须选择对应栅格 |
| 预渲染/指纹/图层 | 源码/参数/API/精确库版本、当前实际绘制计划、全部字体依赖的 revision/链/字节身份、画幅/密度/颜色空间、真实位姿与绘制状态；字体更新不得命中旧帧 |

两种连字计划分键；table 的 tnum/pnum 也参与 features，不允许列宽测量与绘制共用漏特性的旧结果。按 tag 排序只用于没有优先级冲突的规范化值；重叠 feature range 要先解成最终有效区间，不能排序后改变覆盖顺序。

可重建缓存不落项目；字体按 4.4 会话常驻，其余布局/轮廓/栅格按软预算和 LRU。录制命令、在途帧、作者仍持有的布局 pin 住必要资源；淘汰纹理/位图后通过稳定资源键恢复，不留已 close 的 Bitmap 引用。字体代次切换、密度变化、会话关闭都必须有对应失效/释放路径。

日志复用 `createLogger/createMainLogger`、已有 Worker 回传和 `recordVideoEditPreparation('fontLoad', …)`。记录 prepare 开始/完成/失败、资源身份与耗时；逐帧细分仅性能采样期开启，不新增日志文件、查看器或 IPC。

## 8. 实验 1–8

本节是批准后的执行规格，本次结果全部为“未执行”。显卡暂停期间即使 OffscreenCanvas、软件渲染或无头 Electron 也不启动；Node 可执行项仅指后续获得实施授权后的 CPU 阶段。

裸 Node 不具备 Canvas/FontFace/DOM；新生产规则与 HB 整形必须无需这些对象即可执行。原版 Pretext、DOM 与 Canvas 系统 emoji 对照留待真实窗口；不再用伪 Canvas fixture 支撑生产标点分类。CPU 结果不能替代实验 1–3、7 的真实对照验收。

### 8.1 固定 200 条断行样本来源

每条 case 是“文本/样式/字体文件哈希/语言/宽度/wrap 配置”，不是只收集 200 个字符串。创建后冻结 case ID、来源链接/tag/行或生成器种子、许可；不得按首次跑分删困难样本。

| ID | 数量 | 具体来源与组成 |
|---|---:|---|
| R001–R020 | 20 | 本仓库 `author-text-motion.md / recipes-text.md / recipes-text-data.md` 及 `authorLibraries/textPixels.test.ts` 的现有标题/数据卡文字；取 10 条，每条普通宽和临界宽各一例，不读取外部视频工程 |
| P001–P040 | 40 | Pretext v1.0.0 的 `harness/` 已有用例与 accepted 记录对应输入，固定抽取 10 CJK 标点/禁则、10 空白/tab/soft-hyphen、10 Latin kern/ligature、10 假名/富文本跨 run；保留原 case ID，样本不够某类时从该类官方案例生成等价变体并标注 |
| U001–U020 | 20 | Unicode 固定版本 `LineBreakTest.txt` 与 `GraphemeBreakTest.txt` 选取 10 断行边界、10 emoji/VS/ZWJ/扩展汉字/组合符序列，包在自有短句中；Unicode 预期只验证规则层，最终 DOM 断点仍现场采集，不把 UAX 默认规则当 CSS oracle |
| H001–H120 | 120 | 自有短句生成器：8 类各 15 例——中英无空格、带已有空格、括号引号、连续句末标点、数字与单位/负数、URL/长词、显式换行与窄宽、粗细/字号切换的富文本。种子固定，宽度以接近断点的值为主 |
| 合计 | 200 | H 组独立自有样本 120/200 = 60%（不把上游/Unicode 改写计入）；加 R 组共 70%。至少保留少量 ≤24px 极窄案例；不因上游已知差异排除。复杂 mixed bidi 另列兼容回归，不塞入“新引擎字位已支持”结论 |

Unicode 版本与 Pretext 固定数据对齐，实施从 [Unicode 数据目录](https://www.unicode.org/Public/) 读取对应版本，保存具体版本 URL；不使用随时间漂移的 latest。实验字体优先采用固定文件的思源黑体/宋体 CJK、Noto/允许再分发的 Latin 与 emoji 字体，另加本机商业字体只做本机结果；所有报告记录真实文件名、哈希、脸与轴，不只写 family 名。新增字体 fixture/依赖须在实施阶段获得授权后准备。

### 8.2 统一 DOM 对照法

在正式 `test:reality` 真实 Electron 窗口的隔离资料目录注册本票专项场景；沿正式 author import、字体加载、Worker 与取帧链，不另造启动器。对照 HTML 注册同一 SFNT 并等待 FontFace loaded/document.fonts.ready；生产 Worker 仅加载该 SFNT 到 HB 并等待会话 ready；记录 Electron/Chromium、OS、DPR、locale、字体哈希和冻结版本。

DOM 固定 border-box/content-box、font-size/weight/style、line-height、white-space、word-break、overflow-wrap、font-kerning、font-feature/variation、text-spacing-trim、text-autospace、letter-spacing。normal 基线为 pre-wrap、word-break normal、line-break auto、overflow-wrap break-word；显式 grapheme 与 none 分别设对应 CSS。实验 1 在 DOM 显式 `text-autospace:no-autospace`，新库测试配置也关闭自动中英间距；两边不插空格，不以产品默认 1/8 em 与关闭间距的 DOM 比断点。中英间距在实验 2 的独立几何组验证，产品默认不变。

静态核对已确认 Chromium **152.0.7977.167 支持 text-autospace**：固定版本 [css_properties.json5](https://github.com/chromium/chromium/blob/152.0.7977.167/third_party/blink/renderer/core/css/css_properties.json5) 登记 `normal / no-autospace`，默认 no-autospace，该属性无 runtime_flag；不能据此声称全部 CSS Text 4 扩展值都支持。解禁后记录 `CSS.supports`、computed style 及有/无间距的 Range 宽差，以确认 Electron 实际构建没有覆盖行为。几何组用 normal 对照整体间距，并独立核对本库 1/8 em 的边界增量；属性被忽略时标为对照不可用，不伪报通过。

用 Text node + Range 采集原文范围所属行、边界和文本盒，不把每个字包成 span 破坏连写。Range 不能可靠证明 ligature 内单字的 ink origin；这部分用整行叠图/字形轮廓和 cluster 范围核对。分别输出断点差异、advance 差异、墨迹差异与抗锯齿差异；截图必须打开目视，不能只确认文件存在。

### 8.3 分实验执行和判据

| 实验 | Node/CPU 可做 | 必须真实 Electron/显卡解禁后做 | 判据与输出 |
|---|---|---|---|
| 1：200 条断行 | 样本生成、原文映射、固定规则数据与 Pretext walker 不变量；HB 整段/安全切片/unsafe 双侧修复与标点计划逻辑，生产零 Canvas 调用 | 同一 200 case 比较 DOM、未修改 Pretext、适配后正式作者输出；逐条比较可见行起止 UTF-16 偏移、硬换行与省略范围 | 断点 200/200 且逐行一致；任一失败保留，列明原因/修复/复测。升级 Electron、Pretext、HB 或字体后重跑相应基线 |
| 2：行宽 vs HB advance | TTF/OTF 下 shape、cluster、轴、feature、spacing/trim 算术与 source mapping | 对实验 1 同批取 Canvas Pretext、HB、DOM Range 的宽度；追加每个临界点 W−1/64、W、W+1/64，不用它们凑 200 数量 | 误差 ≤1/64 作品像素，候选与容器宽按相同 LayoutUnit 转换后比较，临界断点一致；裸 advance/occupied/量化/墨迹分栏。另设中英间距几何组（normal vs no-autospace、已有空格、换行边缘），不计入实验1断点分母 |
| 3：开口标点与 halt/chws | 取 `「『（《【“` 及配对闭口、连续标点的 glyph ID、advance、offset；各做无特性/halt/chws/适配策略；覆盖有/无特性的字体 | 同字体、字号与行首/中/尾，1×和4×输出叠图 DOM；比较标点墨迹原点与相邻字的间距；同一禁可选连字计划的静态/逐字落定互比 | 无位置性差异；AA 差异单列且目视无可辨双边，不以总宽相同替代字形正确。任何双重挤压阻断发布 |
| 4：大中文字体打开 | 用实际 10/30/60MB 附近字体或本机可取得的最大完整 CJK 字体，记录真实字节数；TTF/OTF/TTC/WOFF2 读取、解压、HB 实例与首 shape，Node worker_threads 内存/耗时；加入系统中文、系统 emoji 实际字节装载成本 | 独立字体端口消息传输、HB 会话 ready、第一帧延迟（生产不注册 FontFace）；验证渲染 queue 等待时资源回执仍能到达；并发两素材/两 Worker、切字体、关闭后迟到结果、会话常驻、关闭后的显式 dispose/wasm 重用与 GC | 冷启动和缓存命中分开，P50/P95/max、JS/wasm/进程内存；证实重工作不堵主线程、同 Worker 同字体只准备一次。无虚构冷磁盘缓存结论 |
| 5：逐字重画与推近 | layout/shape/outline/稳定路径身份命中与失效；无 Canvas 的位姿计算基准；连字全选/部分选择/不同位姿与 owner 规则 | 20/200/1000 字，1080p/4K，静态、逐字位姿、描边阴影、推近1×→8×；旧版与新版同一场景；记录完整帧与上传、录制器纹理复用、密度档切换与逐簇外观栅格分配，确认热帧零整画布临时分配 | 报作者提交/栅格/上传/合成 P50/P95/max，播放跳帧与 p90；典型200字纯填充 P95≤4ms；描边/阴影单列，不套此门槛；推近按新密度重画、落定无跳字；压力规模超预算如实报告 |
| 6：描边生长、立体字耗时 | 同一 HB 轮廓转 Path2D 指令/three.Shape 的 CPU 几何准备；用已内置 three SVGLoader/ExtrudeGeometry，不另写曲线离散/三角化；计洞/轮廓数与几何缓存 | 小标题与200字压力样本的描边揭示和一次挤出绘制，首帧/热帧成本、内存及截图；复用当前 three 路线 | 轮廓、洞与方向正确，缓存避免每帧挤出；不把结果解释为本票已交付三维字系统，不测试 hb-gpu |
| 7：回退 | 字素整簇选脸、缺字判定、UTF-16/代理对/ZWJ/VS 映射；同名字节变化与轴变化失效；核对 HB_TINY 的 AAT 支持、实际字体 morx/kerx 及位图 emoji 表，不把有 glyph ID 当支持绘制 | 指定脸故意缺 emoji/扩展汉字/假名，比较正式 Worker 与 DOM 的实际回退；Windows 与可取得的 macOS 分别验；加入 AAT 字体、CBDT/CBLC、sbix 与可得彩色格式，验证系统 emoji Canvas 回退在 HB 位置绘制；随机 seek/预览/导出/指纹同快照同链 | 同一 case 同一脸/序列与断点，簇不拆、无未报告缺字；系统 emoji 回退的形状/基线/墨迹/AA 差异单列，不能当完整一致；只测 Win 就标明 macOS 未验，不能声称跨平台一致 |
| 8：tnum 与列宽 | 0–9、正负数、小数、百分比、空格/千分位的 HB advance；列 min/max/固定列/overflow 算法、无tnum字体诊断 | 表格在 DOM 使用 `font-variant-numeric:tabular-nums` 与相同字体，逐格对齐/换行、换数字长度、窄列叠图 | 支持 tnum 的数字 advance 同宽（HB font units 精确），符号不要求与数字同宽；列不重叠，换数值不发生意外横跳；简化表格与完整 CSS 分配差异显式列出 |

性能统一 5 次预热、30 次计量；冷启动用同一次专项中的独立 Worker 重建并明确“进程冷/字体冷/磁盘未清缓存”。正式产物性能验收走 `electron:prod` 对应生产构建及统一 Reality 启动路径；不能以 Vite 开发页或 Node 的时间宣称最终帧率。运行大字号字体、2D 栅格、截图、GPU/three 及 Electron 的所有部分现在均暂停。

## 9. 持久格式、迁移与助手覆盖

### 9.1 受影响格式清单

版本与 schema 权威为 `src/core/persistence/formats.ts`；下表基于本工作树 2026-10-31 基线列出下一版本，实施前若基线前进则顺延，禁止复用已发布版本。`apiVersion` 和库钉住决定作者行为，不是可丢弃缓存。字段可选是为了读取旧数据，不等于能让旧程序忽略 API 8 后照常渲染。

| 登记格式/存储 | 基线 → 计划 | 变化与迁移动作 |
|---|---|---|
| `code-author-api` | 7 → 8 | 新静态字体/宿主准备/稳定路径资源契约；版本分流保留 4–7 行为，不把旧素材 apiVersion 值批量改成 8 |
| `code-version` | 8 → 9 | schema 接受 API 8；既有 apiVersion/libraries/源码哈希/组件与工程引用原样保留，迁移仅升级容器解释能力 |
| `code-asset` | 13 → 14 | sourceVersion 等嵌套代码版本允许 API 8；旧资产导入保留记录，不套新建 API8 默认值；导出读回包含实际库版本 |
| `document.video_edit` | 45 → 46 | 嵌套代码版本/工程风格样片接受新契约；旧代码保持原值，只有无钉住的样片等按 2.4 固定历史语义解析 |
| `document.screen_recording` | 48 → 49 | 内嵌剪辑内容同样逐层迁移；不能只升级外层后遗漏录制内的代码/风格副本 |
| `video-style-library` | 6 → 7 | `sample.apiVersion? / libraries?`；读取缺值按固定 API7 快照，不改 guide、源码、风格内容 version、媒体与历史 contentHash |
| `video-template-library` | 6 → 7 | 代码体 `body.apiVersion? / libraries?`；原生模板内容不变；应用到工程时版本传入新素材，不能被发布默认值冲掉 |
| `video-style-package` | 9 → 10 | 遍历 style.sample 与所有 templates[].body 的代码体迁移，保留精确钉住；预览视频/缩略图/锚点原始字节不重做、不丢失 |
| `video-preset-package` | 10 → 11 | 条目增加可选 `previewAuthor` 钉住；缺省固定历史快照。历史 style/title 条目的冻结输入 schema 不改，由已有转换函数在生成新样片/模板时补历史钉住；其他预设内容原样保留 |
| `text-presets` | 1 → 2 | 个人文字预设保留包中带来的可选 previewAuthor；预览生成器取此记录，原生文字 style 及算法不变 |
| `video-edit-effects-library` 本地数据 | 现有存储 2 → 3；登记正式格式 | 个人效果预设同样保留 previewAuthor。当前 `videoEditEffectPresets.ts` 自管版本且未在 formats.ts 单列；本次触及其存储字段，须把现有受支持读取（1、2）接入正式逐版本迁移和样本，保留 favorites/effects，不顺带重构其他本地库 |

后两项是预设包钉住在“导入→本机保存→预览→再导出”间不丢失的必要传播，不新增预设业务功能；内置转场等无个人记录的来源在内置描述符写固定版本。字段投影复用一个作者版本 schema，包条目到个人记录直接搬运，不能两边各维护一套默认值。

上述会实际容纳 API8 或依赖新钉住解释的格式，最低可读版本提高到对应新版本；旧程序会误解释 API8，不能以“字段可选”豁免。若实施把**仅补充 API7 等价元数据、旧程序忽略仍保持完全相同语义**独立发布为中间格式，该中间步才可保持原 minReaderVersion；不得让最终写出的 API8 数据继续沿用旧下限。code-author-api 自身的兼容范围与容器可读下限分开管理。

不机械升级：剪辑 JSON 外壳（当前 document version 10）由 kindVersion 管具体内容；项目说明与通用项目/单文档包外壳如果结构/解释不变，保持版本，仅在嵌套入口调用对应内容迁移。字体字节、wasm、shape/outline/raster 和预渲染缓存均非新增项目格式。`codeMaterialFilesSchema` 继续描述源码表，版本字段放所在样片/代码体/素材版本，避免无差别修改所有源码消费者。只读的旧 style-kits/title-templates 输入 schema 也不借此扩写。

### 9.2 逐版本迁移、摘要与黄金样本

- 文档类在 kind descriptor.migrations、其他已登记格式在 `formatMigrations.ts` 中按 N→N+1 增加纯函数，保留旧链；只复制新增字段，不做文件 I/O、源码重新编译或预览重渲染。缺值解析和迁移共用 2.4 的固定快照，显式字段原样保留，未知/不兼容库走明确错误，禁止吞掉后选 latest。
- 风格/模板可以在内存补齐等价历史钉住，但使用语义归一兼容已有 contentHash，新增版本身份不造成旧样片失效。新建或真正升级时哈希纳入实际 API/库；相同源码、不同引擎必须不同身份。存储字段升级不等于用户内容版本加一。
- 文件读取升级前沿现有通道备份 `.henji/backups/`；localStorage 先留备份键。读/扫描/hydration 只产出内存结果，明确保存才落新格式。失败保留原件，不能以空库覆盖；未知高版本按 minReaderVersion 拒绝并提示升级。
- 分别追加旧样片/库模板/风格包/预设包无字段、显式 API7+1.x、API8+2.0.0、缺一个字段、同工程混用、新旧嵌套录制、代码资产、项目/单文档包真实入口样本。校验 import→保存→重开→export 钉住相同，包预览媒体摘要不变、历史源码哈希不变；旧 CodeMaterialVersion 缺库仍落首版。
- 升级操作单列黄金场景：仅升级库仍为 API7；显式升级 API 产生 API8+2.0.0；源码相同也创建/复用正确新版本；撤销恢复全部实例、默认版本与参数。不可仅断言登记表版本号。
- 样本用正式构造/导出入口追加到已有 persistence fixtures；已发布样本和冻结目录不改。精确迁移/读写验证通过后，才更新 baseline/releasedCompatibility 并执行兼容门禁。

### 9.3 能力与可读回结果

按 henji-application-capability 分级，本票属于**既有算法能力的能力增量**：扩展升级操作的 `upgradeAuthorApi`，不用新增排版 MCP 工具。实现保持 `videoEditCodeProjectUpgrade.ts` 为唯一升级服务，领域声明与 UI/Pi/MCP 同源，结果明确列出变更素材/实例、实际 API/库及可撤销事实；幂等比较必须包括 API/库。

字体查询/导入继续原实体与操作；静态声明属于作者契约，准备通道属于内部宿主通信，不新增任意脚本或下载工具。更新作者技能、类型、示例及 codeMotionReview 建议，使助手知道新建默认、两种升级差别、字体声明、自动连字策略和表格入口，不教助手手写测量/换行/列宽。

`textDrawObservation.ts` 的文字布局/绘制事实必须来自实际计划（包含动画连字计划、必需簇 owner、截断、溢出与回退），新 drawText 绘制轮廓也要上报，不能因为不再 fillText 就丢失复核覆盖。外来模块执行仍经过既有信任入口；纯读源码/静态声明不是执行，但首次真正模块求值不能绕过原有确认。

## 10. 验证与分步实施

### 10.1 本轮文档交付边界

本轮为 **L0**：仅核对本文件的裁定一致性、实际代码入口、固定上游源码、路径与链接；不运行 lint/tsc/Vitest/构建或任何实验。不安装依赖、不触碰 node_modules 联接点；不启动 Electron、Reality、OffscreenCanvas/GPU/显存程序，不操作 `D:/视频制作`；不提交、不合并、不 push。第 12 节曾允许 CPU 实施，不构成本轮越过“只写文档”授权的依据。

### 10.2 后续实施顺序（需另行进入实施阶段）

1. **复审设计**：Claude 与指定审查员检查本次正文，补定第 11 节接口接缝。实验 1–8 仍全为未执行；不得先写原型/fixture 冒充已获实现授权。
2. **CPU 可行性**：获实施授权后锁定依赖/许可与来源补丁，验证 SFNT/flags/cluster/轮廓、Pretext 规则接口、整段 shaping/unsafe 双侧修复、标点 extents、LayoutUnit、table；验证新生产排版不依赖 Canvas/DOM。字体显式 dispose 补丁也在这一阶段验证。显卡暂停时仍不做任何画布或窗口实验。
3. **真实窗口可行性门**：解禁后沿正式 Reality 跑实验 1–3、7、8：200 断点（关闭 autospace）、量化几何、标点字形、连字模式、AAT/emoji 与表格。失败保留样本；若需改变裁定或大幅扩张引擎先交证据，不直接发布。
4. **宿主与版本集成**：静态声明提取、字体独立端口/首次求值与出帧屏障、会话回退常驻、预览/导出/元数据/指纹同源、revision 原子失效；并落实 API8、全部钉住入口、9.1 格式迁移与显式升级。测试涵盖不同帧顺序、两 Worker、取消/迟到、关闭重开及旧1.x混用。
5. **绘制与性能**：接稳定路径身份和录制器复用、密度档逐簇外观缓存；完成实验 4–6 的正式系统字体/真实画面/热帧数据。纯填充 4ms 门槛与外观数据分栏；确认热帧没有每字整画布分配、推近无低清放大、连字落定无跳换。
6. **冻结与交付**：上述可行性、迁移与集成通过后冻结 2.0.0，增加 table/共同 wasm 模块/类型/许可/二进制摘要，逐字节核对旧 1.x 不变。更新技能和真实结果读回，分别报告未验证的平台与彩色格式。实验报告属于后续被授权阶段，本轮不创建其他文档。

### 10.3 验证等级与风险对应

- CPU 精确验证覆盖原文映射、features/轴缓存失效、安全切片与 unsafe 重整形、临界量化、必需簇 owner、表格 tnum/overflow、固定历史解析及字体取消/迟到。不得用上游规则清单/版本数字的复制断言代替行为测试。
- 直接消费者复用 `authorLibraries/layout.test.ts / precision.test.ts / release.test.ts / textPixels.test.ts`、core textDrawPlan、fonts/fontFaces、作者模块/编译、CodeProjectUpgrade/CodeService、PresetPreview、指纹与 CanvasRecorder 及 persistence 读写测试；真实像素依赖的部分留显式解禁专项，不混入 CPU 阶段。复核按 API7/8 和1.x/2.0分别断言实际绘制事实。
- 共享字体生命周期、内部消息与持久迁移满足 testing.md 的 **L2**：精确直接消费者、所属 TS 工程、依赖图和格式专项；core 同时被两工程编译则双 tsc。`verify:changed` 显式传本票代码文件并先 dry-run，不扫描他人脏工作区。
- 作者 API 核心公共契约/关键排版依赖正式引入满足 **L3** 升级条件；完整实施边界执行一次对应全量质量门禁，原型阶段不反复跑全仓。构建只为更新产物时用 electron:bundle；正式性能结论用生产产物和真实设备，不用 Node 时间代表帧率。
- 新格式完成精确迁移与黄金样本验证后才运行 persistence:baseline / persistence:release-snapshot / check:persistence-compat。升级能力字段变化执行能力投影与正式结果验证；无新界面不新增 Surface/MCP 工具。
- 实施后的 L2/L3 或 IPC/持久高风险代码才按 AGENTS.md 做干净上下文提交前审查。本轮 L0 不派实现审查代理、不启动实现，只将正文交回 Claude 复审。

## 11. 仍需 Claude 补定的点

**仅一处接口语义尚需裁定：graphemes 延迟到 drawText 才出现，如何与不可变 TextLayout 几何一致。** 第 13 节已确定“逐字素模式自动关闭 liga/clig、必需连字跟随首字素”，此处不重开方向，只补齐调用时序。

建议采用 5.4 的“双计划 + forceGraphemes 提前选动画几何”：不改三个公开函数的调用形状，graphemes 自动选禁可选连字计划；回调/观察器读实际计划，需要绘制前读取同一几何的作者设置已有 forceGraphemes。代价是可能多算一个 shaping/layout 计划，且未设置 forceGraphemes 的公开 layout 行框可能与随后动画绘制不同。另一选择是让 API8 新版始终关闭可选连字，以单一几何换取静态连字损失；本设计不擅自采用。Claude 确认前该接缝保留明确未决状态，其他已裁定项不重复请求批准。

其余为实施验证项而非待定产品方向：平台候选实际覆盖、字体格式支持、AAT/彩色 emoji 限制、真实性能与 DOM 对照都要实验，不能以设计写完宣称通过。字体声明的提取/参数绑定及无队列资源准备按第 4 节作为具体复审方案；harfbuzzjs 暂不公开独立作者库的成本决定见 4.5。

以下第 12、13 节为原样保留的裁定记录，不是两套同时有效的实现方案。第 13 节优先；本轮禁止实施与显卡暂停约束继续有效。

## 12. Claude 裁定（10-31）
1. **Pretext 窄适配**：批准三处接缝（测量注入、标点决策输出、边界 spacing）的固定源码补丁：锁定 Pretext 1.0.0，补丁以独立补丁文件 + 来源版本记录，Electron 升级与 Pretext 升级时都要复跑实验 1–3。实验 1–3 失败且需要更深改造时停下回报，再评估 CanvasKit。
2. **版本与范围**：同意新库 henji-layout 2.0.0、作者 API 8，按 persistence.md 升相关格式、写迁移与黄金样本；旧冻结版本与 API 7 作品原样渲染。本票不改宿主内置文字布局、不做竖排、不做项目字体打包。
3. **作者契约**：同意保留 layoutText / drawText / GraphemePose 形状，新增 prepareTextFonts 与 table 模块；默认正常断行、中英间距 1/8 em；跨字素连字只接受同组位姿，强拆用 forceGraphemes。技能说明同步（只写新能力怎么用，不教作者手写这些排版）。
4. **门槛**：断点 200/200 一致；几何误差 ≤ 1/64 作品像素；典型 200 字 1080p 文字阶段 P95 ≤ 4ms。跨平台字体、彩色 emoji、抗锯齿差异分别列出，不包装成完全一致。
5. 显卡暂停期间先做不需要真实窗口的部分（依赖接入、补丁、Node 侧测试、表格），实验里需要 Electron/DOM 对照的等显卡恢复。

## 13. 设计审查第 1 轮后的裁定（10-31，优先于前文与第 12 节冲突处）
1. **版本钉住**：风格样片、库模板代码体、预设预览都记录作者 API 与库版本（可选字段）；缺字段时一律按“API 7 + 当时 API 7 的最新库”解析，不随 API 8 变化；新建的样片/模板记录实际版本。按 persistence.md 升相关格式（风格库、模板库、风格包、预设包），写迁移与黄金样本。风格包预览视频因此不需要重做。
2. **切到新引擎的路径**：新建素材默认 API 8；已有素材经升级操作显式“升到最新作者 API”才切换（现有默认升级仍保持原 API）；助手能力与技能、codeMotionReview 的提示同步改写。
3. **字体准备不做作者异步 API**：去掉 prepareTextFonts。字体由模块静态声明（模块级常量元数据），宿主在首次出帧前准备好；字体请求的处理不经过 Worker 的渲染 queue，不在模块求值或 draw 期间等待。
4. **回退链确定**：回退链只由（请求字体、平台候选表、字体库修订号）决定，会话内常驻、不随当前帧淘汰，出帧前统一等待就绪；预渲染缓存键随字体库修订号与回退链变化而失效。第 4.1 节对现有屏障的描述改成实际的“逐帧同步 + 淘汰”。
5. **测量方案改为整段整形**：HarfBuzz 整段整形一次作为唯一度量；Pretext 只提供断行机会（UAX#14、避头尾）与标点挤压决策；按 HarfBuzz 的 unsafe_to_break 切行，只在不安全的断点重新整形（SkParagraph 做法）。逐项列出 Pretext 每个 Canvas 探测（字偶距、假名字偶距、连字检测、字形计数、连字符、emoji 校正、标点墨迹）如何替换或关闭；缓存键含 OpenType 特性与可变轴值。
6. **绘制性能**：库自己的字形路径要有稳定身份，录制器能比对复用纹理；带描边/阴影等外观的字按密度档缓存逐字栅格，不每帧建整画布；4ms 门槛适用于纯填充文字，带外观的单列数据。
7. **连字簇**：作者用了逐字素位姿或揭示（graphemes 选项）时，该排版段自动关闭可选连字（liga/clig），每个字素成独立簇；复杂书写系统的必需连字整簇跟随首字素。
8. **阈值量化**：宽度比较模拟 Blink LayoutUnit 1/64 像素量化，临界宽度样本按量化后的宽度判定。
9. 采纳：生产只把字体字节交给 HarfBuzz（新 drawText 用字形轮廓绘制，不注册 FontFace），按文字实际用到的书写系统懒加载字体，与 1.x 的 FontFaceSet 互不干扰；实验 4 加入系统中文与 emoji 字体装载成本。
10. 采纳：AAT 与位图 emoji 放进实验 7；彩色 emoji 若精简构建画不了，emoji 簇按 HarfBuzz 给的位置用 Canvas 系统 emoji 绘制，并列为已知差异。
11. 采纳：标点分类用 HarfBuzz 字形范围；Electron 升级后实验 1–3 失败只发新版本修，已有 2.0.0 作品不变。
12. 补 tsume、小型大写、上下标的映射与各自字号下的整形方式。
13. 采纳：字体对象按内容哈希缓存、不可变；字体淘汰时显式释放 wasm 内存。harfbuzzjs 是否登记为独立作者库按成本决定，写明理由。
14. 实验 1 的断行对照关闭中英间距（两边都关）比较断点；中英间距单独按几何验证。确认 Chromium 152 的 text-autospace 支持情况并写进设计；自有样本比例提高到至少 60%。

## 14. 第 11 节裁定（10-31）
采用单一几何：API 8 的新版默认关闭可选连字（liga/clig），排版几何只由文字与样式决定，drawText 收到 graphemes 不再改变几何，不做双计划；去掉 forceGraphemes。TextStyle 增加可选 `ligatures: true` 给需要连字的静态标题用，此时逐字素位姿/揭示按“整簇跟随首字素”处理。DOM 对照实验相应设置 `font-variant-ligatures: no-common-ligatures`（开连字的样本另列）。理由：中文为主的片子里拉丁可选连字收益很小，单一几何让排版结果、回调与绘制始终一致，接口更简单。
