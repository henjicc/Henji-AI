摘要：保留 Pretext 1.0.0 + harfbuzzjs 1.6.4；先验证共同度量与标点字形，再发布新的 henji-layout 冻结版，旧冻结版不变。
摘要：layoutText / drawText / GraphemePose 保留现有调用形状；新增字体准备与简单表格入口，字体宿主契约建议升作者 API，宿主内置文字暂不切换排版算法。
摘要：本次仅技术设计，未安装依赖、未执行实验、未启动 Electron/GPU；Claude 与指定审查员批准后实施，真实窗口实验另等显卡解禁。

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

1. 在 `src/core/videoEdit/codeMaterial/authorLibraries.ts` 登记新版本。建议版本为 `henji-layout@2.0.0`：虽然保留旧函数签名，默认断行与逐字字形语义发生可见变化；准确版本号在批准实施时确认，已存在目录不可复用。
2. 改完源码并验证后才运行 `node scripts/freeze-layout-library.ts <新版本号>`。该脚本目前只生成 text/flex；本票需增加 table、字体准备导出、HarfBuzz ESM/wasm 资源、对应类型与完整许可证。
3. 冻结目录 `resources/video-edit-author/frozen/henji-layout/<版本>/` 保存 JS、类型、wasm、LICENSE/NOTICE 和 `release.json`。manifest 的 inputs 记录源码/补丁/锁文件，outputs 按原始字节计算 SHA-256；当前脚本的文本输出表需支持二进制，不能用 UTF-8 写 wasm。
4. 日常 `npm run build:author-libs` 仅校验和复制冻结内容到构建目录 `resources/author-libs/`（当前工作树尚未生成该目录）；`henji-media://author-lib/henji-layout/<版本>/…` 提供资源。现有 `electron/main/protocol.ts` 已支持 wasm MIME 和跨协议资源读取，不新增下载通道。
5. `CodeMaterialVersion.libraries` 钉住精确版本。已有导入继续原版本，缺失 libraries 的历史按首版解析；只有新导入或显式 `upgrade_video_edit_code_materials` 的 `upgradeLibraries:true` 采用兼容新版本。升级创建新素材版本、改指可撤销，不重写历史源码与钉住关系。
6. 1.x 的源码产物、类型、license、release 摘要永久保留，日常构建不以新源码重新生成旧目录。新旧版本同时存在时，不共享可变字体匹配状态、排版缓存或 `TextLayout` 内部对象。

冻结只能固定作者库算法；系统字体被替换/删除、操作系统字体栅格与 Electron 升级仍可能影响旧版 Canvas 画面。“旧作品原样”验收限定同字体字节和同运行环境，不能把冻结 JS 宣称为跨机器像素封存。项目字体随包封存目前没有完整能力，本票不暗中加一个新资产格式。

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

锁定上游：Pretext npm gitHead `4a98f37b1e5396a73197f17c13f3128c15d8c17c`；harfbuzzjs `3f162fa2c6ba68b40839fe2c11502a26632e20df`。本次只读取 npm 元数据及固定 tag 源码，未下载/执行包。实施安装需锁精确版本及 integrity，不跟随 latest。

### 3.2 需要批准的窄适配

采用固定源码的可审计 Pretext 适配补丁，并随新冻结库保存来源与补丁。修改范围限于三条内部接缝：

1. 测量入口可注入相同字体/feature 的整形度量；默认 Canvas 实现保留为对照。生产的推进量来自 HarfBuzz，Canvas 仅承担需要浏览器字体墨迹/标点分类的探测。
2. 暴露原文映射及行边界的标点 trim/feature 决策，供最终 HarfBuzz reshape 使用；不只暴露已经减掉宽度的数字。
3. 在原断行 walker 的宽度累加处接收字素边界 spacing 与行首/尾回收规则，供中英间距使用。不得用插空格或插空白 box 改变原文与断点。

保留上游 UAX/ICU 数据、避头尾规则及断行 walker，不另写分词器和贪心换行。适配代码归冻结库的实现边界，不 monkey-patch 全局 Canvas/FontFace，不让不同库版本互相影响；优先向上游提可复用接口，实施不依赖上游合并时点。

当前的无补丁组合省掉维护成本，但无法公开表达 HB feature 度量和标点最终字位；上述做法使测量与绘制共用字形结果，代价是维护并验证一份固定版本补丁。若实验 1–3 表明还需重写成段断行、完整 bidi 或大范围模仿 Blink，停止扩张补丁，按原计划比较 CanvasKit 段落方案。现阶段没有证据支持推翻 Pretext + HarfBuzz，也没有实测证明补丁规模足够小。

## 4. Worker、字体与 wasm

### 4.1 接入位置与准备屏障

- 作者 draw/layers 实际在 `videoEditWorker.ts` 所在剪辑渲染 Worker 执行；“作者 Worker”和“宿主渲染 Worker”在这条执行链上是同一 Worker，不为每个标题另开线程。打包/类型检查 Worker 不创建文字渲染上下文。
- 可复用文本核心放在 `src/core/imaging/vectorContent/` 的独立排版模块，纯算法和宿主端口分离；作者封装放 `src/features/videoEdit/authorLibraries/`。新核心被新冻结库打包；旧 `createTextDrawPlan` 保留给当前宿主消费方，不改成隐式按最新库运行。
- 在现有 `videoEditRenderTransport.ts → videoEditWorker.ts` 消息链提供会话字体端口，主进程仍只通过既有 fonts IPC 交付数据。Worker 不调用 PAL、不读文件系统。字体解析/解压沿 `electron/main/services/fonts/worker.ts` 的 CPU worker，不挪到主进程事件循环。
- 每个会话先建立字体端口，再允许作者模块求值；首帧前等待声明字体、回退字体和 wasm ready。声明参数用现有 `font / textStyle` 元数据收集；不能只按 family 的常规体选择，新增匹配需带 weight、style、variation。
- 为模块常量字体和运行中参数选出的额外字体，新增库入口 `prepareTextFonts(requests): Promise<void>`，request 最小包含 family 与可选 weight/style/variation。作者在模块顶层 await 或异步准备阶段调用；不改变 `layoutText` 同步签名，不在每帧隐式 await，不靠重复执行整个作者模块补字体。该入口是作者库导出，不是新 MCP 工具。
- 未准备的字体走已准备的明确回退脸并报告实际字体；要保证指定字体必须先准备。固定参数字体由宿主代劳；完全不透明的任意 JS 字符串无法在执行前静态扫描完。顶层准备不能反向等待尚未读出的作者参数元数据；字体端口可独立按请求解析，避免元数据加载死锁。
- 同时排版多个语言/素材时，locale 和字体状态属于请求/会话；不逐段调用全局 `setLocale` 造成串扰。首阶段新库默认语言明确固定为 `zh-CN`，日文文本也按该语言配置验收，不宣称提供完整 locale 选择器；新增语言配置另行评估。

### 4.2 两个引擎使用同一份字体事实

现有链：`platform/fonts.ts::prepareFontPayloads/readFontPayload` → `FontPayload { face, bytes }` → `LoadedFontFaces.load` → Worker `FontFaceSet`。`prepareFontPayloads` 对 generic 返回空数组；按名称选择字体时倾向常规体。`LoadedFontFaces` 为全名、family 等建立别名，不能仅凭这些别名证明 HB 选中了相同脸。

新会话字体记录包含：规范化 SFNT 内容哈希、原 face 身份、weight/style、variation、唯一内部 CSS family、覆盖信息、实际 fallback 顺序与代次。它是内存资源描述，不写入 TextStyle 或项目 JSON。

| 来源 | 传递与选择决定 |
|---|---|
| 本机 TTF/OTF | 复用 fonts.list/readFace；同一 SFNT 字节同时交 `new FontFace(唯一内部名, bytes, descriptors)` 与 `new hb.Blob → Face → Font` |
| TTC/dfont | 沿现有 `metadata.ts::standaloneFont` 拆成单脸，保留所有表；交给 HB 的 face index 为 0，不能再拿原集合 index 索引拆出文件 |
| WOFF/WOFF2 | 现有 standaloneFont 对这两种压缩格式原样返回，不能直接视为 HB 可读 SFNT；建议 CPU 字体 worker 使用 `fontverter@2.0.0` 的 sfnt 转换（内部为成熟的 wawoff2 / woff2sfnt-sfnt2woff），两端都消费转换后同一字节，不手写解码或通过 fontkit subset 丢表。[fontverter 文档](https://github.com/papandreou/fontverter)、[Google woff2 的 wasm 封装](https://github.com/fontello/wawoff2) |
| 用户导入字体 | 当前进入全局字体库，按相同路径交付；不另建票内字体目录 |
| “项目字体” | 当前 `catalog.ts::filterFonts('project')` 是已使用名称筛选，不是随项目携带的文件集合。本票支持项目所用且已安装/导入的字体；项目目录里未登记的字体先走现有导入。项目字体自动发现、随包与跨设备绑定不纳入本票，也不假装已经实现 |
| generic 与缺失脸 | 新版按已登记的明确平台候选表解析 sans/serif/mono，选定实际脸和字节；Win/macOS 分别验证。若缺指定字体沿现有警告与回退，不凭 `sans-serif` 字符串让 HB 自己猜 |

回退顺序：指定精确脸 → 同 family 合适字重/样式 → 已准备的系统 CJK/Latin/emoji 候选 → 系统默认文字脸。针对一个完整字素（包括 VS、组合符、ZWJ）查询 cmap/variation glyph，并整簇试 shape；缺失字形再换下一脸。避免把 emoji ZWJ 序列和基字/附加符拆到两个字体。相邻同脸同样式同 script 的簇合并后整形，不能每个字素独立 shape 破坏上下文。

Pretext、HB 与 DOM 对照均用内部唯一名字和同一实际脸，不允许两端分别走不可见系统 fallback。所有候选仍缺字时记录 missing-glyph，使用明确替代字形并暴露警告；不能把 tofu 当实验通过。OS 的默认替补不等于跨平台一致，本票不自动分发商业字体。

可变字体对两端设置相同命名实例轴值；自动 opsz 的不一致在实验 2 定位后统一显式轴值。真实 bold/italic 脸优先；现有 fauxItalic/fauxBold 由既有外观变换执行且计入墨迹范围，不让 HB advance 加一次、绘制再加一次。

为保护旧版：新增精确脸使用内部别名；不在旧别名下覆盖字体，不撤掉旧版仍持有的 FontFace。旧库继续消费原加载路径，新库按新资源端口取同字节事实；WOFF/SFNT 规范化仅用于该新请求，原 readFace 的旧返回行为不被统一改写。

### 4.3 wasm 装载、缓存和释放

- Pretext 为 JS；harfbuzzjs 的运行 ESM 与实际 npm wasm 文件一起收入冻结目录，使用模块相对 URL，离线加载。约 174 KB 的 brotli 数值不作为安装体积或内存预算；实际未压缩文件、wasm heap 和首实例成本由实验记录。
- 为 `text.mjs / flex.mjs / table.mjs` 采用共同 ready 外壳，顶层 await 完成 HarfBuzz 初始化后暴露同步排版。现有 flex 的 Yoga ready 外壳可复用发行模式；不能把上游顶层 await 塞进目前 ES2020 bundle 后假定能工作。
- 同一 Worker、同一冻结 URL 只初始化一次，多个素材共享实例；不同冻结版的 HB、Pretext 和缓存隔离。不同预览/导出 Worker 不共享可变 wasm memory；跨 Worker 传字体副本或专用可转移 buffer，不能 detach PAL 缓存中的原 buffer。
- 并发字体请求按内容哈希合并；SFNT 字节、Face、不同轴值 Font、轮廓分层缓存，按实际内存软预算回收，活跃布局引用的资源 pin 住。不得以大字体/字体数量作为硬拒绝条件。
- harfbuzzjs 1.6.4 的包装对象使用 `FinalizationRegistry` 跟踪原生销毁，没有可假定的公共 `destroy()`。复用 Buffer、及时断开淘汰对象引用；内存峰值必须实测，不能声称 LRU 淘汰立刻归还 wasm heap。Worker 关闭释放整个实例；若实验 4 证明 GC 行为不够稳定，再单独评审带注销的显式 dispose 补丁，禁止手动 free 后由 finalizer 二次释放。[helpers.ts](https://github.com/harfbuzz/harfbuzzjs/blob/v1.6.4/src/helpers.ts)
- 加载失败走已有错误链，日志记录阶段、字体哈希/脸、库版本、耗时，不静默换引擎。取消/关闭后迟到资源不得装入新会话；字体变化统一使 prepare、shape、layout、轮廓/栅格、作者帧和宿主预渲染缓存失效。

### 4.4 许可证义务

- Henji 自有冻结库继续按项目 Apache-2.0 发行；保留已有 Yoga/Zod 声明。
- Pretext 顶层 MIT 之外，LICENSE 包含 Chromium/WebKit BSD 条款、ICU/Unicode/ICU4X 等第三方全文。复制整个固定版本 LICENSE 与实际随包来源声明，不只登记一个 MIT。[Pretext 完整 LICENSE](https://github.com/chenglou/pretext/blob/v1.0.0/LICENSE)
- harfbuzzjs 保留 MIT 全文；wasm 内 HarfBuzz 15.0 保留其 COPYING 及实际构建所含声明。[harfbuzzjs LICENSE](https://github.com/harfbuzz/harfbuzzjs/blob/v1.6.4/LICENSE)、[HarfBuzz COPYING](https://github.com/harfbuzz/harfbuzz/blob/15.0.0/COPYING)
- fontverter 为 BSD-3-Clause；实施锁定其传递依赖后逐项收入 wasm、Google woff2/Brotli 等实际分发许可。字体是独立许可对象，实验用 OFL 等允许再分发的字体保留许可证；系统商业字体只在本机读，不入 fixture 或安装包。
- 声明同时进入冻结 NOTICE 和现有 `scripts/third-party-licenses/author-libs/`/许可证生成链，不另造许可系统。本次未执行打包许可审计。

## 5. 从断行到字位和绘制

### 5.1 排版流水线

1. 沿当前 parse/validate 入口规范化富文本、样式和约束，保存原文 UTF-16 映射。沿用大小写、smallCaps、上/下标等已有转换；显示文本与原文范围分别保存。换行正规化不能丢失原文坐标。
2. 分段落、字素和样式 run；合并相邻等样式的整形上下文，按 script/direction/font 再分 run。方向继承先解析，连字/组合符使用整段上下文；字素边界以固定的 Pretext grapheme 数据和适配规则为准，不混用不同 Unicode 版本的索引。
3. Pretext 产生合法断点、禁则、空白/soft-hyphen 处理及标点挤压决策；注入 HB run 度量与 spacing 后选择行。富文本走其 rich-inline 的跨样式段规则，不能先逐 span 排行再拼接。[rich-inline.ts](https://github.com/chenglou/pretext/blob/v1.0.0/src/rich-inline.ts)
4. 在最终行边界按相同上下文重新 shape，设置准确 font/script/language/direction/feature range。使用 `Buffer.addText` 的 UTF-16 cluster 偏移，结合字素映射组成 glyph run；advance/offset 从 font units 按字号/upem 换成作品像素，HB 的 y 向上变为画布 y 向下。
5. 把最终 advance、字间附加距离、行首/尾 trim 和可见 soft hyphen 纳入同一几何结果；再应用 justify、align、anchor、baseline。fit 每次用同一管线重排；fit/截断/省略范围/墨迹与外观范围保留当前语义。
6. 内部保存 glyph ID、font 实例键、cluster 源范围、glyph origins、轮廓/彩色绘制引用；外部依旧得到 `TextLayout`。`drawText` 使用这份内部计划，不重新用 `fillText(单个字符)` 整形普通轮廓字。

### 5.2 宽度的唯一权威

最终绘制几何以 HarfBuzz 字位加排版附加距离为准；Pretext 决定合法断点及行策略，但必须使用同一份度量。记录三份独立数值：未修改 Pretext 的 Canvas 行宽、注入 HB 后的行宽、最终绘制计划行宽，不能仅比较两个都来自同一数组的总和。

`Wline = Σ HB.xAdvance + Σ tracking/kerning/中英间距 + Σ justify − 尚未由 HB feature 实现的 trim`，并排除按 CSS 规则悬挂的尾空白。由 halt/chws 已实现的压缩绝不再减一次。

若最终 reshape 使候选行超宽，回到 Pretext 已有候选断点重新 fit，再 reshape；禁止额外写一套断行、整体横向压缩、平均摊差、改画布宽度或挪末字遮掩差异。计算必须覆盖实际候选，不能以任意迭代上限吞掉未收敛。

实验 2 建议几何阈值为每行绝对误差 ≤ 1/64 作品像素，且临界宽度断点零差；该阈值属于本设计的审批项，不冒充原计划已有阈值。超差先检查实际脸、轴、feature、字距、行边缘与空白。发布前没有解释并修复的几何差异即失败；不能用“以 HB 为准”免除与 DOM 的验收。

### 5.3 各排版责任

| 项目 | 唯一责任与规则 |
|---|---|
| UAX#14、避头尾 | Pretext 固定版本规则。超窄行的紧急断字也沿其规则，保留差异证据，不再维护手写标点名单 |
| `wrap` | 新版省略 wrap 时用 normal 断行（英文单词优先、CJK 禁则）。`word` 对应 normal + 单词过长时紧急断字；显式 `grapheme` 保留强制字素切断语义，对照 DOM `line-break:anywhere`，不宣称该模式仍有禁则；`none` 仅显式换行。默认改变只发生于新冻结版 |
| 标点挤压 | Pretext 决定位置/上下文/行边缘，HB 执行精确 feature range 与字形 offset。通常由相应标点的 `halt` 完成；对有 `chws` 的字体按实际 shaping 结果去重，不能整段同时强开 halt/chws。无相应 feature 的字体不虚构半角字形，也不挤压轮廓。实验 3 核对开口标点的墨迹原点，不只核对总宽 |
| 中英间距 | 本库薄层，按 CSS Text 4 的 ideograph-alpha/ideograph-numeric 字类边界提供附加间距，不插字符；建议默认 1/8 相邻表意字体 em。已有空白、行首/尾不重复加，CJK 标点不一概当汉字；该距离参与选断点并在换行边缘回收。[CSS text-autospace](https://www.w3.org/TR/css-text-4/#text-autospace-property) |
| 两端对齐 | 本库薄层，复用现有 align 枚举：默认末行不拉伸，justify-center/right 控制末行，justify-all 包含末行。优先分配合法词间空白，再分配允许的 CJK 字素间隙；不拆连写簇、不在禁则标点之间硬塞距离。只扩展空隙，不缩放 glyph；无法扩展的单簇行保持自然宽 |
| `tracking / kerning` | 保留现有千分之一 em 单位；数字 kerning 的额外间距与自动 kern 开关按现有含义映射。不能把 Canvas letterSpacing 与手加 tracking 同时生效 |
| glyph 整形与轮廓 | HarfBuzz 负责 GSUB/GPOS、ligature、mark、advance/offset；通过 glyphToPath/glyphToJson 取轮廓，不能按 Unicode 再到 opentype.js 查另一枚 glyph |

### 5.4 字素动画、连字与受限路径

- 一个字素可能对应多个 glyph，多个字素可能共用一个 glyph cluster。内部建立多对多关系；公开 graphemes 保留原文逻辑顺序，不按 glyph 个数改索引。
- 一个字素的所有 glyph 一起应用 `GraphemePose`。跨字素连字默认视为不可分组：组内位姿相同才画一次；位置可读但继续标记 `native-estimate`，不能标记成可任意拆画的 `individual`。
- 跨字素簇的不同位姿或部分选择不通过裁切轮廓制造“半个连字”。需要逐字强拆时使用已有 `forceGraphemes:true`，在排版前关闭可选连字并按字素重新整形；必要连写仍不可拆时，返回清楚的“不支持独立位姿”错误，作者可改为逐词/整簇揭示。新旧模式的差别记录进技能，不能承诺阿拉伯连写可无损逐字飞散。
- 首阶段不新增完整 UAX#9 实现。已支持的复杂双向段落保留既有原生整段路径及 `x=null/unavailable` 语义；不伪造逐字坐标。这是明确兼容路径，记录原因；混合 bidi 不算新引擎准确字位通过样本，另保留回归项。若需扩展，评审成熟 bidi 库，禁止自己写重排算法。
- 彩色 emoji 不把空轮廓当成功：优先使用 harfbuzzjs paint/PNG 能力并复用现有 Canvas 外观层；不支持的彩色格式允许完整字素的原生 Canvas 栅格路径，必须用同一实际字体并验证 advance 与墨迹，不把彩色 emoji 当可描边生长或可挤出的矢量字。[字体绘制 API](https://github.com/harfbuzz/harfbuzzjs/blob/v1.6.4/src/font.ts)
- 新版静态与逐字状态共享同一次 shape；落定时不切换到另一种字体整形。底板、阴影、外描边、填充、内描边和装饰线继续沿既有层次，文字观察事实来自实际绘制后的几何，不丢弃截断/超框证据。

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

## 7. 绘制成本与缓存

- 默认普通轮廓字按输出像素密度由 OffscreenCanvas 2D 绘制。shape 和轮廓构造不随时间重跑；逐字位姿每帧只遍历已排出的 glyph、变换并绘制 Path2D。新的逐字默认路径不沿用旧版固定最高 4× 图集放大。
- 每帧成本分开测：位姿求值/路径提交、2D 栅格、外观合成、纹理上传、宿主合成。含阴影/多描边时同一字有多层像素成本；4K 整屏上传和运动模糊多采样不能只计一次 HB 排版时间。
- 静态内容继续用既有图层 `pose/cacheKey`、录制和位图复用；Path2D 在现有 recorder 中可能导致 live 绘制，必须测实际沿用，不能把缓存 Path2D 误报为缓存了输出像素。只在同内容/变换/采样密度/颜色空间命中时沿用栅格；推近时重新按目标密度栅格，不把低清缓存贴大。
- 排版键：冻结版本及适配摘要 + 原文/富文本结构 + 实际样式 + 宽度/fit/截断/方向 + 实际字体内容哈希/轴/回退链/代次 + spacing/features。颜色不影响断行但影响绘制；geometry cache 与 appearance cache 可拆，不能遗漏任一影响字段。
- 分层缓存：字体字节/Face；shape run；Pretext prepare（不含宽度）；最终 layout（含宽度）；glyph outline（font+axes+glyph）；必要的 raster（含实际分辨率、外观和颜色空间）。动画时间与 GraphemePose 不进排版键。所有缓存只保留可重建数据，不落进项目格式。
- 对连续变化的宽度/字号采取内存软预算和 LRU，淘汰不改变仍由作者持有的只读布局；恢复所需字体资源须有 pin 或可重新准备的明确生命周期。缓存关闭和字体切换不得留下已释放 Path2D/Bitmap 的引用。
- 超大中文字体成本包括读取/解压、跨边界复制、FontFace 解析、HB blob 复制、cmap/shape 懒初始化。先按需求加载具体脸和 fallback，不把系统全部字体传进 Worker。缓存共享同脸字节、不同轴值共享 Face；避免为每个作者素材复制完整 CJK 字体。
- 不预设绝对速度。建议性能目标待审批：典型 200 可见字、1080p、60fps 的文字绘制与栅格 P95 ≤ 4ms；同时以整段播放跳帧比例、实时合成 p90 和导出一致性验收。1000 字、4K、多个阴影作为压力样本报告退化，不作为输入硬上限。
- 日志复用 `createLogger/createMainLogger`、现有 Worker 日志回传和 `recordVideoEditPreparation('fontLoad', …)`；准备/失败按事件记录，逐帧细分只在性能采样期开启 debug/trace，不另建日志文件或查询 IPC。

## 8. 实验 1–8

本节是批准后的执行规格，本次结果全部为“未执行”。显卡暂停期间即使 OffscreenCanvas、软件渲染或无头 Electron 也不启动；Node 可执行项仅指后续获得实施授权后的 CPU 阶段。

裸 Node 不具备 Canvas/FontFace/DOM。CPU 规则测试使用明确的固定度量；HB 原型可直接消费 SFNT，但涉及 Pretext 的 Canvas 墨迹分类/emoji 探测时须注入此前真实窗口采集的 fixture，或标为等待窗口证据。不得以 Node 模拟 Canvas 的成功代替实验1–3、7的验收。

### 8.1 固定 200 条断行样本来源

每条 case 是“文本/样式/字体文件哈希/语言/宽度/wrap 配置”，不是只收集 200 个字符串。创建后冻结 case ID、来源链接/tag/行或生成器种子、许可；不得按首次跑分删困难样本。

| ID | 数量 | 具体来源与组成 |
|---|---:|---|
| R001–R020 | 20 | 本仓库 `author-text-motion.md / recipes-text.md / recipes-text-data.md` 及 `authorLibraries/textPixels.test.ts` 的现有标题/数据卡文字；取 10 条，每条普通宽和临界宽各一例，不读取外部视频工程 |
| P001–P060 | 60 | Pretext v1.0.0 的 `harness/` 已有用例与 accepted 记录对应输入，固定抽取 20 CJK 标点/禁则、20 空白/tab/soft-hyphen、10 Latin kern/ligature、10 假名/富文本跨 run；保留原 case ID，样本不够某类时从该类官方案例生成等价变体并标注 |
| U001–U040 | 40 | Unicode 固定版本 `LineBreakTest.txt` 与 `GraphemeBreakTest.txt` 选取 20 断行边界、20 emoji/VS/ZWJ/扩展汉字/组合符序列，包在自有短句中；Unicode 预期只验证规则层，最终 DOM 断点仍现场采集，不把 UAX 默认规则当 CSS oracle |
| H001–H080 | 80 | 自有短句生成器：8 类各 10 例——中英无空格、带已有空格、括号引号、连续句末标点、数字与单位/负数、URL/长词、显式换行与窄宽、粗细/字号切换的富文本。种子固定，宽度以接近断点的值为主 |
| 合计 | 200 | 至少保留少量 ≤24px 极窄案例；不因上游已知差异排除。复杂 mixed bidi 另列兼容回归，不塞入“新引擎字位已支持”结论 |

Unicode 版本与 Pretext 固定数据对齐，实施从 [Unicode 数据目录](https://www.unicode.org/Public/) 读取对应版本，保存具体版本 URL；不使用随时间漂移的 latest。实验字体优先采用固定文件的思源黑体/宋体 CJK、Noto/允许再分发的 Latin 与 emoji 字体，另加本机商业字体只做本机结果；所有报告记录真实文件名、哈希、脸与轴，不只写 family 名。新增字体 fixture/依赖须在实施阶段获得授权后准备。

### 8.2 统一 DOM 对照法

在正式 `test:reality` 真实 Electron 窗口的隔离资料目录注册本票专项场景；沿正式 author import、字体加载、Worker 与取帧链，不另造启动器。HTML 与 Worker 加载同一 SFNT，并等待 FontFace loaded/document.fonts.ready；记录 Electron/Chromium、OS、DPR、locale、字体哈希和冻结版本。

DOM 固定 border-box/content-box、font-size/weight/style、line-height、white-space、word-break、overflow-wrap、font-kerning、font-feature/variation、text-spacing-trim、text-autospace、letter-spacing。normal 基线为 pre-wrap、word-break normal、line-break auto、overflow-wrap break-word；显式 grapheme 与 none 分别设对应 CSS。需探测当前 Electron 是否支持 CSS 属性，不以忽略了属性的 DOM 当对照。

用 Text node + Range 采集原文范围所属行、边界和文本盒，不把每个字包成 span 破坏连写。Range 不能可靠证明 ligature 内单字的 ink origin；这部分用整行叠图/字形轮廓和 cluster 范围核对。分别输出断点差异、advance 差异、墨迹差异与抗锯齿差异；截图必须打开目视，不能只确认文件存在。

### 8.3 分实验执行和判据

| 实验 | Node/CPU 可做 | 必须真实 Electron/显卡解禁后做 | 判据与输出 |
|---|---|---|---|
| 1：200 条断行 | 样本生成、原文映射、固定规则数据与 Pretext walker 不变量；HB measurer 的 CPU 逻辑。伪 Canvas 宽度只验证算法，不算浏览器证据 | 同一 200 case 比较 DOM、未修改 Pretext、适配后正式作者输出；逐条比较可见行起止 UTF-16 偏移、硬换行与省略范围 | 断点 200/200 且逐行一致；任一失败保留，列明原因/修复/复测。升级 Electron、Pretext、HB 或字体后重跑相应基线 |
| 2：行宽 vs HB advance | TTF/OTF 下 shape、cluster、轴、feature、spacing/trim 算术与 source mapping | 对实验 1 同批取 Canvas Pretext、HB、DOM Range 的宽度；追加每个临界点 W−1/64、W、W+1/64，不用它们凑 200 数量 | 建议误差 ≤1/64 作品像素、临界断点一致；分别记录裸 advance 与最终 occupied width，不能混入尾空白悬挂后误报 |
| 3：开口标点与 halt/chws | 取 `「『（《【“` 及配对闭口、连续标点的 glyph ID、advance、offset；各做无特性/halt/chws/适配策略；覆盖有/无特性的字体 | 同字体、字号与行首/中/尾，1×和4×输出叠图 DOM；比较标点墨迹原点与相邻字的间距；静态/逐字落定互比 | 无位置性差异；AA 差异单列且目视无可辨双边，不以总宽相同替代字形正确。任何双重挤压阻断发布 |
| 4：大中文字体打开 | 用实际 10/30/60MB 附近字体或本机可取得的最大完整 CJK 字体，记录真实字节数；TTF/OTF/TTC/WOFF2 读取、解压、HB 实例与首 shape，Node worker_threads 内存/耗时 | 正式消息传输、Worker FontFace.load、两个引擎 ready、第一帧延迟；并发两素材/两 Worker、切字体、关闭后迟到结果、长时淘汰/GC | 冷启动和缓存命中分开，P50/P95/max、JS/wasm/进程内存；证实重工作不堵主线程、同 Worker 同字体只准备一次。无虚构冷磁盘缓存结论 |
| 5：逐字重画与推近 | layout/shape/outline 缓存命中与失效；无 Canvas 的位姿计算基准 | 20/200/1000 字，1080p/4K，静态、逐字位姿、描边阴影、推近1×→8×；旧版与新版同一场景；记录完整帧与上传 | 报作者提交/栅格/上传/合成 P50/P95/max，播放跳帧与 p90；建议典型200字 P95≤4ms；推近按新密度重画、落定无跳字；压力规模超预算如实报告 |
| 6：描边生长、立体字耗时 | 同一 HB 轮廓转 Path2D 指令/three.Shape 的 CPU 几何准备；用已内置 three SVGLoader/ExtrudeGeometry，不另写曲线离散/三角化；计洞/轮廓数与几何缓存 | 小标题与200字压力样本的描边揭示和一次挤出绘制，首帧/热帧成本、内存及截图；复用当前 three 路线 | 轮廓、洞与方向正确，缓存避免每帧挤出；不把结果解释为本票已交付三维字系统，不测试 hb-gpu |
| 7：回退 | 字素整簇选脸、缺字判定、UTF-16/代理对/ZWJ/VS 映射；同名字节变化与轴变化失效 | 指定脸故意缺 emoji/扩展汉字/假名，比较正式 Worker 与 DOM 的实际回退；Windows 与可取得的 macOS 分别验；彩色格式单列 | 同一 case 同一脸/序列与断点，簇不拆、无未报告缺字；只测 Win 就标明 macOS 未验，不能声称跨平台一致 |
| 8：tnum 与列宽 | 0–9、正负数、小数、百分比、空格/千分位的 HB advance；列 min/max/固定列/overflow 算法、无tnum字体诊断 | 表格在 DOM 使用 `font-variant-numeric:tabular-nums` 与相同字体，逐格对齐/换行、换数字长度、窄列叠图 | 支持 tnum 的数字 advance 同宽（HB font units 精确），符号不要求与数字同宽；列不重叠，换数值不发生意外横跳；简化表格与完整 CSS 分配差异显式列出 |

性能统一 5 次预热、30 次计量；冷启动用同一次专项中的独立 Worker 重建并明确“进程冷/字体冷/磁盘未清缓存”。正式产物性能验收走 `electron:prod` 对应生产构建及统一 Reality 启动路径；不能以 Vite 开发页或 Node 的时间宣称最终帧率。运行大字号字体、2D 栅格、截图、GPU/three 及 Electron 的所有部分现在均暂停。

## 9. 持久格式、作者 API 与兼容性裁定

依据 `docs/rules/persistence.md`：“作者接口 apiVersion、字段默认值/含义和数值范围变化”都属于持久语义；“库版本”与“宿主作者 API 版本”分别裁定。

| 变化 | 裁定 |
|---|---|
| 只增加自足的冻结库版本，宿主能力/序列化/旧版默认值均不变 | 不自动等于作者 API 升级；`libraries` 已能记录精确版本。旧冻结库不变是必要条件 |
| 本设计新增字节字体端口、准备屏障及库对宿主的就绪约定 | 属于宿主作者契约变化；建议 API 7→8，新 henji-layout `minApiVersion=8`。不因 draw/layoutText 参数没变而省略版本 |
| layoutTable、prepareTextFonts 新导出，默认断行/字素行为变化 | 用新冻结版本承载；旧类型包不改，旧作品不自动换库 |
| 内存排版/字体哈希/wasm/轮廓/栅格缓存 | 不落盘，不升项目格式；现有可重建缓存按引擎/资源身份失效 |
| 把新算法直接替换宿主 textStyle 或让旧作者库受新字体别名覆盖 | 改变旧画面语义，本设计不采用；若扩范围必须另做版本分流与迁移设计 |

当前登记事实：code-author-api 7、code-version 8、code-asset 13、剪辑内容 45、录制内容 48。升级 API 会改变被多种嵌套 schema 引用的最大合法版本，不能只修改一个常量。实施时从 `src/core/persistence/formats.ts` 顺向核对 code-version、code-asset、document.video_edit、document.screen_recording，以及实际嵌套这些记录的风格包/预设/交换包；凡权威 schema 或解释语义变化都登记逐版本迁移，按实际最新基线递增，不把此处数字写死进测试。

对于能包含 API8 记录的容器，旧程序不能正确解释新作者行为，最低可读版本提高到能读 API8 的格式版本；不能按“加了一个可选字段”豁免。只是外部包里装了新版本文档且包自身结构/语义未变的外壳，不机械升版本。实现前列出实际指纹与语义影响清单，完成嵌套读入口测试再更新 baseline/releasedCompatibility。

迁移保持旧记录中的 `apiVersion` 和 `libraries` 原值，保留旧源码与文件哈希；新程序接受旧作品并执行对应旧行为，不把 v4–7 的代码内容迁为 v8。打开时只内存升级，首次明确保存前按已有通道备份；旧程序遇到新最低可读版本返回“请升级”，不能打开后覆盖。

黄金样本由正式构造/导出入口追加，包括旧1.x作品、新2.x/API8作品、同文档混用、代码资产/嵌套录制/项目包读回、升级库后撤销。已发布样本与旧冻结摘要不可重生成。

助手覆盖判断：新排版仍通过已有代码工程写入、素材版本、升级、预览/取帧/复核操作调用；字体走已有 font 数据与导入入口。无需排版专用 MCP 工具或任意脚本能力。实施更新作者类型与技能并核对公共操作结果；新文字计划仍走 `textDrawObservation.ts` 的布局/绘制事实供助手复核，不能只更新技能文案而丢掉可读回结果。

## 10. 验证与分步实施

本次为 L0 文档任务：只核查路径、接口、引用和设计完整性，不执行 lint/tsc/Vitest/构建。当前工作区和 node_modules 联接点不变；不提交、合并或 push。

批准后的顺序：

1. **设计批准**：Claude 与指定审查员裁定第 11 节；批准前不写实现、测试、fixture 或 result.md。
2. **CPU 原型**：固定依赖/许可，先验证 HB 字体格式、cluster/轮廓、Pretext 三处适配接缝和共用度量；只跑实验 1–4、6–8 的 CPU 子项。此时不冻结正式发行目录、不接默认新作品。
3. **真实窗口可行性门**：显卡解禁后先跑实验 1–3、7、8；必须满足断点、几何及字形判据。失败先定位；需要大规模重写或改变选型时提交证据重新裁定，不边修边铺完整产品。
4. **资源生命周期与正式集成**：实现字体端口、准备、取消、版本隔离、缓存失效、API/容器迁移；验证预览、导出、样片、元数据及读回。旧宿主字体行为回归独立于新文字效果验收。
5. **文字与表格闭环**：完成 spacing/justify/fit/截断/appearance、逐字 cluster 策略、table；更新作者技能可执行示例，复用现有操作，不新增界面。方案得到实际试用确认后再保留必要自动测试。
6. **性能与兼容性**：完成实验 4–6 真机部分、缓存冷热/字体切换/旧作品混用/关闭重开；只测一次改前基线与一次改后完整场景，失败增量复测。结果写计划要求的 result.md 是后续阶段任务。
7. **冻结与验证**：在原型和迁移通过后冻结新版本；比对旧目录全字节摘要，离线装载新库与 wasm，核对生成类型和许可证。尚未批准发行或存在必要实验未验时，不把新版本设为已验收默认。

匹配测试范围与升级条件：

- 局部确定性算法/格式转换先用精确 CPU 测试。保留重点是原文映射、断点/feature 度量一致、cluster 不重复绘制、取消/迟到资源、字体代次失效、table 溢出及 tnum 失败；不复制登记表/版本号清单到断言。
- 复用直接消费者现有测试：`authorLibraries/layout.test.ts / precision.test.ts / release.test.ts / textPixels.test.ts`，`core/imaging/vectorContent/textDrawPlan.test.ts`，`platform/fonts.test.ts / fontFaces.test.ts`，字体 service/scanner 测试，代码版本与模块解析测试，以及真正受影响的持久读写测试。像素测试若依赖真实 Canvas/设备，归显式专项，不能混进 CPU 阶段偷跑。
- 共享核心/字体生命周期/Worker 契约阶段为 L2：精确消费者、所属 TypeScript 工程、依赖图、持久兼容及实际涉及的专项；core 被主进程引用时两套 tsc。`verify:changed` 必须显式本票文件并先 dry-run；package/锁文件不冒充该工具自动支持。
- 作者 API 核心公共契约和关键文字依赖正式替换符合 testing.md 的 L3 条件；在完整实施边界执行其全量质量门禁一次，不在每轮原型叠加全仓检查。仅需要新 Electron 运行产物时用 `electron:bundle`；性能正式验收按生产产物要求，不因为旧产物而自动跑 electron:build。
- 持久变化完成迁移/黄金样本后才执行 `persistence:baseline / persistence:release-snapshot / check:persistence-compat`；作者发行改动核对冻结与类型消费；导入边界变动做 `check:dependency-graph`，真实技能/能力注册有变化才执行对应检查。
- 有代码后的提交前审查按 AGENTS.md 派干净上下文，仅交目标、diff 与相关规则。当前设计不代替 Claude/指定审查员批准，不擅自启动实现审查代理。

## 11. 需要 Claude 与审查员裁定的点

1. **Pretext 窄适配**：批准固定源码补丁的测量注入、标点决策输出、边界 spacing 三处接缝；实验1–3失败且需更深改造时重新评估 CanvasKit。无补丁直接拼接无法满足同一度量。
2. **版本与范围**：建议新库2.0.0、作者API8；本票不改宿主内置文字布局、不做竖排和项目字体打包。API8会牵涉嵌套持久格式，不能作为“库内部替换”隐去。
3. **作者契约补充**：保留 layoutText/drawText/GraphemePose 形状，增加 prepareTextFonts 与 table 模块；默认正常断行/1⁄8em中英间距，跨字素连字只接受同组位姿，强拆用 forceGraphemes。若要求绝对不增加任何公开导出，应先收窄模块常量字体和表格能力，不能靠同步隐式文件读取实现。
4. **通过阈值**：断点200/200沿原计划；建议几何误差≤1/64作品像素、典型200字1080p文字阶段P95≤4ms，须批准后作为新增门槛。跨平台字体、彩色emoji与像素AA差异分别报告，不将它们包装成“已完全一致”。

批准状态：待 Claude 与指定审查员；实验1–8均未执行；显卡暂停约束继续有效。

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
