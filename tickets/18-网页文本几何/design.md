摘要：在现有网页页面会话与 html-in-canvas 捕获事务中，按作者声明读取 DOM Range 文本几何，与同票据画面一起交付。
摘要：输出视口 CSS 像素下的字素、词、行片段与字体声明；兼容 GraphemePose 的五个动画字段，不把排版矩形冒充字形、墨迹或真实基线。
摘要：复用 ticket 14 的逐帧 boxes 元数据、完整性判定与段族发布；本轮仅交设计，Claude 与审查员批准后实施，不改源码、不提交、不推送。

# Ticket 18 技术设计

## 1. 范围与基线

- 依据：[本票计划](./plan.md)、[总计划第 8 项](../../../Henji-AI-t18/docs/task/代码效果与渲染改进/以后再做.md)、[ticket 03](../03-网页取帧不阻塞与倍率跟随/plan.md)、[ticket 14 设计](../14-网页页面时间缓存/design.md)及其[最终裁定](../14-网页页面时间缓存/review.md)、[ticket 10 设计](../10-文字排版/design.md)、[ticket 15 最终裁定](../15-代码片段输出缓存/review.md)。裁定优先于尚未同步的设计正文。
- 只读核对日期：2026-11-01。工作目录 `D:/VibeCode/Henji-AI-t18`，分支 `task/18-网页文本几何`，HEAD `90103a8f3`；读取时本地 main 为 `1a915b959`。两者在本票相关的网页服务、作者接口、网页输入及参数实现中没有差异，新增提交是任务记录。未执行 fetch/pull/merge，未验证远端是否另有更新；实现前由 Claude 在安全边界吸收最新 main 并重新核对 10/14 的接口。
- 交付范围：按需采样、跨进程 DTO、作者读取接口、与 14 的元数据接缝，以及验证逐字效果输入的最小样片。不建设完整逐字效果库，不接管 11/12/13 的效果与风格件，不建设字形遮罩、背景修补或文字重排。
- 第一版自动采样覆盖舞台内普通 HTML Text 节点、中英混排、内联样式、换行、字素簇和双向文本的 Range 矩形。SVG text、Canvas 内绘字、表单内部文字、伪元素/列表标记、闭合 Shadow DOM、跨文档 iframe 没有本方案的自动字素几何；返回明确的覆盖边界，不通过 OCR 或另一套排版器补造。
- 本轮按 [testing.md 的 L0](../../../Henji-AI-t18/docs/rules/testing.md) 交付，仅核对引用、路径与契约。未启动 Electron、未跑 GPU/性能探针；没有实测通过的结论。node_modules 确认为指向主工作区的 Junction；不运行 npm install/ci/uninstall，不操作 9334，不访问 `D:/视频制作`。

## 2. 现有实现与技术选择

| 现有位置 | 已核实事实与接点 |
| --- | --- |
| [page.ts:102](../../../Henji-AI-t18/electron/main/services/web-source/page.ts#L102)、[page.ts:115](../../../Henji-AI-t18/electron/main/services/web-source/page.ts#L115) | `measureBoxesScript` 用 querySelector/getBoundingClientRect；`snapshotPaintScript` 在 paint 回调里提交舞台快照并量 boxes。新增文本采样进入同一个回调。 |
| [page.ts:477](../../../Henji-AI-t18/electron/main/services/web-source/page.ts#L477) | captureNow 负责 seek、等待上一幅绘制、快照与 compositor 回退；现有页面自定义 boxes 在 seek 后独立调用，不是文本精确采样入口。 |
| [pages.ts](../../../Henji-AI-t18/electron/main/services/web-source/pages.ts)、[videoFrameTypes.ts:241](../../../Henji-AI-t18/src/platform/contracts/videoFrameTypes.ts#L241) | captureWeb 已有 time/ticket/boxes/scale/latest，响应与共享纹理分开到达；扩展此请求和响应，不建文本 IPC 通道。 |
| [videoEditWebInputs.ts:159](../../../Henji-AI-t18/src/features/videoEdit/engine/videoEditWebInputs.ts#L159)、[videoEditWebInputs.ts:251](../../../Henji-AI-t18/src/features/videoEdit/engine/videoEditWebInputs.ts#L251) | 网页读键包含时间、倍率与 boxes；同帧异时刻分槽，取消与迟到纹理已有释放逻辑；最后画面与元数据在同一个 VideoEditWebPicture 上。 |
| [videoEditAuthorModule.ts:32](../../../Henji-AI-t18/src/features/videoEdit/engine/videoEditAuthorModule.ts#L32)、[author-api.d.ts:62](../../../Henji-AI-t18/resources/video-edit-author/author-api.d.ts#L62) | AuthorWebFrame 已提供 time/width/height/region/scale/duration/boxes；Canvas、layers、WebGL、WebGPU 共用 info.web。 |
| [text.ts:17](../../../Henji-AI-t18/src/features/videoEdit/authorLibraries/text.ts#L17)、[textDrawPlan.ts:78](../../../Henji-AI-t18/src/core/imaging/vectorContent/textDrawPlan.ts#L78) | GraphemePose 是动画回调的返回值，位置来自 TextLayout.graphemes；UTF-16 索引与字素不是 glyph ID。ticket 10 的 shapedText 同样保留五个姿态字段。 |
| [videoEditCodeFingerprint.ts:105](../../../Henji-AI-t18/src/features/videoEdit/engine/videoEditCodeFingerprint.ts#L105) | 指纹求值读取 info.web 会触发 web-layout-required，转保守路径；不能因新增几何把它换成假空对象。 |

选择浏览器原生 TreeWalker + Range + Intl.Segmenter，无新增依赖。Range 复用页面真实排版，避免逐字包 span 改变连写、字距和换行；Segmenter 负责 Unicode 字素/词边界，项目只写映射、采样和序列化薄层。[CSSOM View](https://drafts.csswg.org/cssom-view/#dom-range-getclientrects)、[ECMA-402 Segmenter](https://tc39.es/ecma402/#sec-intl.segmenter)。

不选 CDP DOMSnapshot 作为生产采样器：其 TextBoxSnapshot 是排版后的文本片段与 UTF-16 范围，缺少逐 glyph 轮廓；协议布局也不承诺稳定，另一次 CDP 请求不能绑定当前 paint。它只可用于隔离验收对照。[官方协议定义](https://github.com/ChromeDevTools/devtools-protocol/blob/master/pdl/domains/DOMSnapshot.pdl)。不选 Canvas measureText/henji-layout 重新排版网页：字体回退、CSS 与浏览器整形事实会被替换；不选拆字 DOM 库：其写入会改变被测页面。

Range 的盒是 advance 与字体度量决定的排版片段，不是紧贴墨迹的 glyph box；浏览器保留了整形不等于向 JS 暴露了整形器的全部事实。真实 glyph ID、实际回退字体、轮廓、精确 alphabetic baseline 均不从 Range 推断。

## 3. 按需声明与页面采样

### 3.1 作者声明

新增模块静态声明 `webText?: Readonly<Record<string, readonly string[]>>`，键为图片参数名，值为需要文本几何的 CSS 选择器。例如：

```ts
export default {
  name: '网页标题逐字动画',
  params: [{ key: 'page', type: 'image' }],
  webText: { page: ['#title', '#subtitle'] },
  // draw/layers/createWebGPU 从 info.web.page.text 读取同刻几何。
}
```

- 在 AuthorEffectMetadata/CodeAuthorProgram 中传递经过校验的声明，prepareCodeInputs 按参数当前求值结果下发；仅 `kind:'web'` 启用，空值/普通图片不采样。一个可替换图片参数不必永远绑定网页，不能因换成图片就使整个素材编译失败。
- 选择器与旧 boxes 一致，querySelector 取首个匹配元素，且目标必须属于当前舞台。无效 CSS 报具体选择器错误；找不到与超出舞台分开记录。重叠选择器复用内部测量，但按原键返回结果，字素索引只在各选择器内解释。
- 不新增 CodeWebReference 的持久字段；取景、时间及用户绑定继续走原类型。与“在引用上再加 text 选项”相比，静态声明让输入准备在绘制前知道需求，并避免把取帧能力分散进绑定值与新 UI，减少与 10 的多格式迁移冲突。
- 无声明时不遍历、不分段、不安装文本观察器、不增发页面脚本或 IPC；只要旧 boxes 的调用行为不变即可。

### 3.2 从原文到矩形

1. 在隔离世界建立舞台内目标 Text 节点与 UTF-16 偏移表。原文按 DOM 顺序连接，保留原始空白；BR、块级流边界另存 break offset，不靠 innerText 的空白折叠结果反推 DOM offset。排除 script/style/template 等非内容节点；隐藏文本保留原文索引，绘制状态另记。
2. 在每个连续文字流中使用 Intl.Segmenter 的 grapheme 粒度；locale 从元素有效 lang 取得，无 lang 时固定 zh-CN，记录 resolved locale 与分段契约。内联节点边界不拆断组合字素；不同块、BR 与替换元素阻断跨边界合并。字素 source 为半开 UTF-16 区间，跨 Text 节点时保留多段来源映射。
3. 复用 Range，按每个字素对应的 Text 节点子区间调用 getClientRects，立即复制数值。只测 Text 子区间，避免跨元素 Range 同时夹入元素边框盒；保留多个片段，不能只用 getBoundingClientRect 把多行、多方向空隙吞成大矩形。
4. word 粒度独立分段，记录 source、isWordLike 与成员字素。其 rects 来自成员片段的带行归属合并，不额外逐词重排；标点/空白保留为非词段。不能按固定字符数或空格拆中文。
5. 行数据提供 `lineFragments`：对完整 Text 节点 Range 获取浏览器实际换行后的片段，与字素片段建立包含关系。它是单个文字 run 的行片段，不冒充跨字号/上下标/bidi 的整条 CSS line box；不能确定共同视觉行时保留分片及 `line:null`，不按 y 接近就宣布同一行。普通等字号横排行可合并完全一致的行带，复杂排版仍返回可用的逐字/逐词 rects。
6. computed style 按唯一元素去重，记录 fontFamily/fontSize/fontWeight/fontStyle/fontStretch、lineHeight、letterSpacing、wordSpacing、direction、writingMode、fontFeatureSettings、fontVariationSettings、whiteSpace、textTransform 和 lang。它表示 CSS 声明/解析值；font-family 列表不能写成“实际命中字库”。textTransform 与源文字分别保存，不通过大小写转换猜显示 glyph 数量。

空白、零宽字符、display:none/visibility:hidden/opacity:0、取景外分别保留可判定状态；零宽不能一律当“没有字”。Range 不反映遮挡、clip-path、mask、阴影或字形外扩，`rects` 统一标明是 layout 范围；只计算与 region 的矩形交集，不声称就是最终可见墨迹。

旋转、斜切、透视及复杂 writing-mode 下只提供 Range 的视口轴对齐包围框，标为 `axis-aligned-bounds`，不反推四角、基线或旋转矩阵。合字、连写可能让多个字素共享或交叠盒；提供 overlap 事实，不把它们断言为可独立切开的 glyph。仅凭几何无法证明“没有连字”，本票不输出 independentGlyph=true。

## 4. 与画面同一时刻

- 唯一采样链：现有页面槽 → `await henjiWeb.seek(t)` → 字体就绪及页面状态稳定 → 同一次 requestPaint 的 paint 回调 → 同步采样 DOM/样式与提交舞台快照 → 主进程收妥纹理与 DTO → Worker 按票据组成不可变 picture。回调内不 await、不调用页面的异步几何 hook、不写 DOM/样式、不插测量 span。
- 沿现有 submitted/advance 屏障，只在几何值已复制且快照提交后允许下一次 seek。纹理和响应可任意先后到达；二者都校验同一来源内容代次、槽位、ticket、实际页面时间、view/scale 后才能交付。热重载、取消、旧槽销毁、倍率切换、超时、设备丢失均沿原生命周期丢弃整对，归还迟到纹理。
- 精确成立的前提仍是页面履行 henjiWeb.seek：完成后所有参与绘制的动画/异步状态已定位到 t，直到下一次 seek 不自主推进；paint 监听器不修改舞台。**同一个 JS 回调本身不是同步证明**：官方方案中 paint 内 DOM 改动要到下一次更新才进入显示列表，若别的监听器先改 DOM，读回的新布局会与旧显示列表错配。[HTML-in-Canvas 的 paint 时序](https://github.com/WICG/html-in-canvas#3-the-paint-event)。
- 捕获前后核对已观察的 DOM/style/font/scroll 代次，排空 MutationObserver 记录；核对受影响子树是否仍有自主运行的动画。发现变动、字体仍加载或舞台替换，标记 unsynchronized，本帧几何不进入精确消费/缓存，下一次正常请求重新捕获。观察器不能证明任意页面脚本的隐藏状态，页面契约仍是必要条件，不引入“检测所有时钟/随机”的承诺。
- 字体等待不仅发生在首次 READY_SCRIPT；seek 动态引入新字体时，也要等本帧字体准备结束再 requestPaint。字体错误给出状态，不能保存成“同一字体”的成功缓存。
- compositor 回退仍可服务未声明文本的旧消费者；有文本需求时返回 unavailable/capture-path，不能把 settleScript 后某次测量标为精确同刻，也不重启第二个网页采几何来配当前帧。精确渲染失败必须沿正式错误通道解释缺失原因。

### 4.1 HTML-in-Canvas 几何映射门槛

当前服务使用 WebGPU copyElementImageToTexture；最新提案改了 API 名称及 drawable 几何映射，不能照抄新文档升级当前捕获链。官方明确 WebGPU 不会自动确定 DOM 在目标纹理中的位置，updateElementGeometry 会影响 DOM 查询。[Chrome 官方几何说明](https://developer.chrome.com/docs/web-platform/html-in-canvas/concepts#update-an-elements-geometry)。

实施首个隔离探针必须核对当前 Electron/Chromium：舞台搬入 canvas 后 Range/元素盒的原点与缩放；新旧 geometry API 的实际存在性；geometry 更新是否影响当前/下一次测量。宿主舞台保持视口原点、无 border/padding/根 transform，CSS 尺寸等于 viewport；文本 DTO 归一回这一未裁切的视口 CSS 空间。仅当所用版本需要映射才能得到正确矩形时，在准备阶段建立与该空间一致的舞台几何映射，待其生效后再捕获；不把输出纹理倍率写进布局几何。

探针不能得到稳定同刻坐标时停止实施并回报 Claude，不通过“加几帧等待”、猜倍率或永久切 compositor 掩盖。最新 API 的存在不是当前 Electron 已支持的证据。

## 5. 作者端形状、坐标与姿态

新增 `AuthorWebFrame.text?`，按选择器返回 discriminated result；整个 DTO 深度只读、可结构化克隆，不跨进程传 DOM、Range、函数、Path2D 或 GPU 资源。实际帧的捕获身份属于宿主 DTO/缓存，不作为 UI 文案。

```ts
// 形状示意；共享纯 DTO 定义放 core，作者 .d.ts 与宿主类型保持一致。
type WebTextResult =
  | { status: 'ready'; geometry: WebTextGeometry }
  | { status: 'not-found' }
  | { status: 'unsupported' | 'unavailable'; reason: string }

interface WebTextGeometry {
  coordinateSpace: 'viewport-css'
  text: string
  breaks: readonly number[]
  fonts: readonly WebTextFont[]
  graphemes: readonly WebTextGrapheme[]
  words: readonly WebTextWord[]
  lineFragments: readonly WebTextLineFragment[]
  coverage: 'dom-text-only'
}
// WebTextGrapheme：text、source:{start,end}、fontIndices、rects、
// fragment→lineFragment 引用、bounds|null、pivot|null、baseline:null、
// positionKind:'range'、boundsKind:'axis-aligned-bounds'、overlap。
// Word：text/source/isWordLike/graphemeIndices/rects。
// LineFragment：rect、所含字素片段引用；跨样式不能证明同一行时不合并。
```

- `text` 属性省略＝未请求；not-found＝已测且选择器无匹配；匹配到空元素可 ready 且数组为空；unsupported/unavailable 不能转成空数组或 null。已有 boxes 的历史返回语义保持兼容，新的完整性判断另用显式 coverage，不复用 withSelectors 补 null 的做法。
- 字素保持逻辑原文顺序，UTF-16 source 与 ticket 10 一致；bidi 的视觉位置由 rects 表达，不通过按 x 排序改写回调索引。索引不是跨内容修改的稳定 ID，内容变化后不得沿用旧索引的选择结果。
- GraphemePose 直接使用 `henji-layout/text` 已有类型：`x/y` 相对位移、`scale` 缩放、`rotate` 弧度、`opacity` 透明度，省略为 0/0/1/0/1，null 隐藏。作者动画函数可返回同一形状；无需修改/重新冻结 henji-layout 库，也不把 WebTextGeometry 强转成 TextLayout 交给 drawText。
- DOM 没有精确 baseline API，本票 `baseline:null`。可用字素 bounds 中心作为显式 `pivot`；没有二维盒则为 null。与 ticket 10“围绕字素基线起点旋转/缩放”的区别必须保留：兼容的是字段、单位与动画回调方式，**不承诺旋转锚点相同**。要求真实基线锚点或字形轮廓的消费者须使用 ticket 10；不得用盒底当 alphabetic baseline。
- 字体、大小、advance 与 inkBounds 不混用：网页字素只公开 Range 盒宽，不把它命名为实际 shaping advance；本票不填假的 inkBounds、outline 或 glyph ID。

### 5.1 坐标换算

规范坐标原点为页面 viewport 左上，x 向右、y 向下，单位 CSS px；Range 已含当前页面滚动与后代 CSS transform，不再加 scrollX/scrollY。舞台根的视口约束见 4.1。几何保持浮点值，不逐字取整。

设 region=`[rx,ry,rw,rh]`，实际有效内容像素尺寸为 `W,H`，则：

```text
sx = W / rw                  sy = H / rh
xImage = (xCSS - rx) * sx     yImage = (yCSS - ry) * sy
u = (xCSS - rx) / rw          v = (yCSS - ry) / rh
```

W/H 使用本帧 capture 结果，不按请求 scale 重算；floor、纹理尺寸限制可能使 sx/sy 与名义 scale 有细小差别。共享 DTO 增加本帧 viewportToImage 仿射矩阵与有效内容尺寸，AuthorWebFrame 的历史 scale 字段不改含义。ticket 14 编码 padding 不进入 W/H；读取纹理的 UV 再通过其 validRect 映射到实际解码纹理。DPR 已影响网页实际排版/栅格及缓存环境，不能在上述公式里再乘一次。

网页图像放入作者画布时，再乘作者的图片放置矩阵；图层/片段/序列变换由既有合成器继续处理。作者姿态 x/y 与 ticket 10 都解释为作者逻辑画布像素：先把 CSS anchor 映射到作者空间，再加位移，再围绕该 anchor 施加旋转/缩放。preview renderScale 与导出像素尺寸只进入物理栅格换算，不改变 source 或逻辑字位。

示例：region=`[100,50,800,400]`，W/H=`1200,600`，CSS 点 `(120,70)` 对应 `(30,30)` 纹理像素、UV `(0.025,0.05)`；DPR=2 时结果仍如此。负坐标/部分裁切保留原始盒，采样矩形只在纹理边界裁切，枢轴不随裁切移动。

### 5.2 逐字效果消费边界

整页画面已混合文字、背景、遮挡与阴影；矩形切片会带走背景，重叠 Range 会重复取样，移动贴片也不会自动擦掉原字。本票交付几何，不把这件事包装成通用字形提取能力。

总计划“逐字飞散第一帧逐像素一致”的样片使用作者可控的纯文字网页来源：均匀纯色背景，无字形交叠和外扩阴影，字片移动后露出的作者底层使用相同背景色。现有 snapshot 输出采用 alphaMode:opaque，本票不以尚不存在的透明网页捕获为验收前提。消费端以不重叠的半开像素分区从同一输入纹理复制，每个源像素只出现一次；分区外残余保持原样，零姿态也经过分片重建，不能只在 t=0 画整图冒充通过。非零时刻同时验证字片移动且原位置不残留。采样覆盖不满足该前提的页面仍可用于高亮定位等效果，不能宣布可独立飞字。通用字形遮罩/干净背景另立范围，由 Claude 裁定，不在本票暗加第二轮截图或 DOM 隐藏重画。

## 6. ticket 14 的 boxes 元数据规则

1. 14 拥有页面会话、时间网格、物理/语义键、编码/解码、缓存目录、段锁、清理与信任。18 只向它已有的逐帧 boxes 元数据载荷增加可选 text 几何及 coverage；不新建几何缓存系统/目录/媒体通道。14 当前尚未交付完整时间缓存，不能写成已经接通。
2. 元数据绑定 14 的源内容/字体与存储环境、viewport/region、实际 DPR、rasterScale、F/φ、绝对帧序号与捕获契约；按其准确页面时间寻址，不另用浮点时间四舍五入生成几何键。14 最新裁定是 HEVC 4:4:4 硬编硬解可用才缓存，4:2:0 与软解不能因本票放行；macOS 先走实时。编码“无损”不等于 RGB 往返逐字节无损，精确观察仍走既有实时精度策略。
3. 像素段键不包含文本选择器。元数据 coverage 单独包含规范化后的 selectors、locale/分段契约、采样器版本与所支持的几何种类；有 A 不代表有 B，有元素 boxes 不代表有 text。像素变体可以供不同声明共享，不能为了选择器变化复制一套视频缓存。
4. 请求无文本：按原 14 规则命中。请求文本：只有对应帧的画面身份与所需全部 text coverage 齐全、状态可靠才命中；not-found 是完整的已测结果，字段缺失/旧缓存/失败是缺测，绝不能补 null 冒充不存在。unsupported 是明确能力边界，不能作为能做逐字效果的命中。
5. 同刻 metadata 缺失：本次整对回退实时，不能解码旧画面再开页测当前几何配上去。后台按 14 的段任务补齐；需要再次执行页面时重录并原子替换对应视频/元数据族，不把另一次不明身份的测量直接附到旧段。多批 selector coverage 只有属于同一已验证捕获身份才能合并；不能证明则放弃合并，按需要合并需求后重录。
6. 时间近似许可与画质许可独立。若节目预览获准使用近邻缓存帧，画面与几何必须一并来自同一实际 tFrame，作者看到实际页面时间；不能把 tFrame 的画面配 tRequest 的几何。精确、非网格、缺 coverage 或不可靠帧按 14 整对实时回退，不能因有 boxes 就默许近似。
7. 保存沿 14 的临时族→校验→原子 ready 清单：文本几何不完整只使该 coverage 不可用，不能向外发布半份 ready。已有只服务无文本请求的像素段可继续用；扩充 coverage 的发布不能破坏旧读者的租借。几何与段族一起计量、刷新与回收，句柄释放后清理；旧版本可重建缓存缺字段只当未覆盖，不迁移用户工程。
8. 后台录制只测当前有消费者声明的选择器；录制需求为空不扫整页文本。新增需求沿现有优先级合并，不另排第二条无上限的几何预热队列，前台抢占、取消、外来确认完全沿 14；首次执行前就需获准，不以“只读几何”为由绕过信任。

## 7. 性能、内存与失败

- DOM/Range 只能在网页自己的渲染线程执行；主进程协调请求和元数据 I/O，剪辑 Worker 消费值。一次 capture 的几何随原响应返回，避免每字 IPC。GPU 不参与 DOM 遍历，不读回网页像素来测文字。
- 首次成本约为选中 Text 节点、原文长度、字素数和返回片段数之和；字体/样式表去重。重叠选择器共享节点与字素测量。词盒复用字素结果；重叠检测使用排序扫描，避免所有字素两两比较。语义数组保持原文顺序，排序只用内部索引。
- 分段与节点映射可按文本/DOM 代次复用；矩形与 computed style 第一版每个被请求的精确帧重读。不靠 MutationObserver 未触发就跨帧复用布局，因为 CSS 动画、祖先变换、滚动、字体与媒体查询也会改位置。
- 无选择器/当前非网页为零采样。取消在进入页面脚本前检查；已开始的同步采样不能被 IPC 中断，不承诺瞬时抢占。完整采样不跨两个可变化的 paint 拼接；超出交互预算走既有上一幅完整 picture/同尺寸占位与超时规则，不悄悄截断字数、吞错或发布半个列表。
- 不新增字数、节点数、选择器数的拒绝硬上限；不沿用旧 boxes 的 64 个作为新 text 限额。实际消耗通过按需范围、代次复用、预算回收与可取消排队控制；极大目标的同步 Range 成本必须实测公开，不能声称无限规模都实时。
- 几何对象随 picture 租借持有；释放纹理时归还配套元数据引用。预览回退必须拿旧 picture 自带的旧几何/实际时间，不能用新结果覆盖；占位的 text 为 unavailable，不补空布局。旧 withSelectors 的补 null 只保留旧 boxes 兼容用途。
- 日志沿 main.web_source 与既有 features 域记录 text_geometry.start/completed/failed；逐帧耗时为 debug/trace，记录请求身份、节点/字素/片段数、采样/序列化毫秒、元数据字节、缺 coverage/不支持/不同步原因。正文、完整字体 URL、cookie/token 不进日志；不建查看器/查询通道。

实施后的性能验收固定同一页面与 seek 序列，采样关闭/开启对照：500 字素典型标题正文页、5000 字素多段页，另测无命中、空白、10 个重叠选择器、快速取消；1×/2×/4×、1080p/4K，冷热各区分。无声明页面的脚本/IPC 次数必须不增；500 字素额外采样+序列化目标 P95≤2ms，5000 字素目标 P95≤8ms，端到端另列，均为待验证预算而非性能事实。超预算先分析被选范围、重复布局刷新与序列化；不降低几何完整性。一次一个隔离探针、单项≤180秒，超过一分钟后台运行；不与其他票争用 GPU/构建产物。

## 8. 预计改动文件与并行边界

以下均为**批准后的预计源码范围**；本轮实际只写本 design.md。

| 文件或明确目录 | 本票职责 / 冲突处理 |
| --- | --- |
| `src/core/videoEdit/webTextGeometry.ts`（新增） | 纯 DTO、coverage 与坐标换算；无 DOM/Node/GPU 依赖，跨宿主使用相对导入。与 14 共享格式但不拥有其缓存实现。 |
| `electron/main/services/web-source/textGeometry.ts`（新增）、`page.ts`、`pages.ts` | 页面隔离世界采样脚本、同拍捕获、结果验证；与 14 冲突最高，先由 14 稳定 capture 返回信封/发布接缝，再串行接入，不复制 page.ts。 |
| `src/platform/contracts/videoFrameTypes.ts`、`electron/preload/video-frames-api.ts`、`electron/preload/api-video-frames.d.ts` | captureWeb 的可选 text 请求和 DTO 透传；preload 若已完全泛型透传则不产生无意义修改。不加通道，不改隔离选项。 |
| `src/core/videoEdit/codeAuthorProgram.ts`、`src/features/videoEdit/engine/videoEditAuthorModule.ts`、`videoEditAuthorParameters.ts`、`videoEditAuthorPrograms.ts` | webText 静态声明与 AuthorWebFrame.text；现有元数据缓存随引擎契约失效。与 10/11 的 API/声明扩展串行集成。 |
| `resources/video-edit-author/author-api.d.ts` | 作者可见类型与单位、锚点、覆盖边界说明；保持已有宿主/作者契约一致性测试。 |
| `src/features/videoEdit/engine/videoEditWebInputs.ts`、`videoEditRenderer.ts` 的 prepareCodeInputs | 汇总声明、请求覆盖、读键、完整 picture 与回退；与 14 的近似/精度和 15 的输入准备改动串行，不改效果执行器。 |
| `src/features/videoEdit/engine/videoEditCodeFingerprint.ts`、`src/core/videoEdit/renderCache.ts` | 核对现有网页依赖与保守回退；只在新增声明未被完整源码/契约身份覆盖时补入，不为几何另造指纹。 |
| `src/core/videoEdit/codeMaterialPersistence.ts`、`src/core/persistence/{formats.ts,formatMigrations.ts,schemaBaseline.json,releasedCompatibility.json}`、`tests/fixtures/persistence/code-author-api/` | 作者 API 登记和逐版本兼容配套，见第 9 节；具体版本在 10 合并后确定。 |
| 上述模块相邻的精确测试、`videoEditAuthorApiContract.test.ts`、现有 `scripts/lib/electronLaunch.cjs` 的调用方专项 | 测语义与生命周期；复用隔离启动器，不改启动器/不新增通用探针框架。新增专项脚本的位置在批准实现时与现有网页专项合并选定。 |
| 14 最终确定的逐帧元数据读写/清单 schema 文件 | 仅配合 text 扩展与 coverage 测试；当前无已交付的生产文件路径，不在设计里杜撰一个缓存服务。由 14 所有者确认文件所有权后串行改动。 |

- **10**：复用 GraphemePose 结构、UTF-16 与字素概念；不改其整形器、字体装载、冻结资源与 table。字体环境身份交给 14，网页 DOM 与 Worker 的字体事实不能混为一份。API 8 已被 10 规划占用，本票不能抢号。
- **11/12/13**：只提供文字位置和样片输入，不注册另一套效果描述符、逐字执行器或风格模板。后续效果通过现有 author layers/GPU 输入消费；本票无须改 `henji-effects` 冻结包。
- **14**：共用会话、实际时间、尺寸/精度、帧身份与元数据；本票实时路线可先实施，磁盘接线须待其正式契约稳定。解码服务、编码参数、原生库不属 18。
- **15**：以 review.md 最新裁定为准，第一版有网页/序列输入的代码片段不启用输出复用，本票保持该排除；不把早期设计的 GPU/RAM LRU 当已批准接口。将来开放时，输入身份必须含 text 查询/coverage、实际 tFrame 与几何契约；若缺事实则跳过缓存，frameKey 不能绕过网页布局依赖。

## 9. 作者 API、助手覆盖与兼容

- 静态声明与新增作者字段属于作者宿主接口增量，使用**合并后的下一个作者 API 版本**：若 10 已落 API 8，本票为 9；不改任何历史素材的 apiVersion，不重写冻结 henji-layout，也不因打开工程自动升级。旧 API 保持旧 boxes、绘制和指纹行为。
- 代码作者 API 在既有登记位置升版本、加单步迁移/黄金样本。必须沿 codeAuthorApiVersionSchema 的嵌入关系核对代码版本、剪辑内容、录制会话、代码资产、风格/模板及交换包；即使本票没有新增引用值字段，API 取值上界变化也可能改变这些格式的权威 schema 指纹。实际受影响的登记项分别升版本、迁移原样保留旧 apiVersion 并追加黄金样本，不能只改作者 API 数字。是否提高 minReaderVersion 依据各项已有字段含义与旧读者能否正确理解分别判断；不支持新 API 的旧宿主须明确拒绝执行，不能忽略声明画出错误结果。版本传播复用 10 合并后的链路，不能另写一套升级服务。
- webText 在源码中声明，CodeWebReference 无持久字段变化；几何与编译元数据都是可重建产物，沿现有缓存排除登记说明覆盖。若实施中必须把声明写入受保护的业务 schema，再按真实影响追加版本/迁移/样本，不在缓存 schema 上冒用项目版本。
- 按 henji-application-capability 分级为作者输入契约增量；现有 `video_edit.code_material.source/files` 通用实体写入负责创作，既有渲染/观察负责结果。本票不新建“设置文本几何”工具、实体或 UI 开关；Pi/MCP 不另写 schema。实例的完整网页正文不自动注入助手上下文。覆盖检查确认新作者 API 能经现有创建/更新/编译/取帧入口到达。
- 需要更新作者知识时进入现有作者 API 资源与正式技能源，不另建旁路说明；技能双份同步由 Claude 在批准的实施范围内决定具体文件。本设计不授予 npm 发布或依赖安装权限。

## 10. 验证、批准与停止边界

实施判 L2：共享作者契约、主进程捕获/IPC、异步取消、持久版本均命中升级条件；按 [testing.md](../../../Henji-AI-t18/docs/rules/testing.md) 裁剪，禁止因为改了 Electron 就跑整套发布构建。

| 风险 | 必需证据 |
| --- | --- |
| Unicode/来源映射 | 中英空白、代理对、组合符、ZWJ emoji、跨 inline 节点字素、BR、隐藏文本、双向文字；UTF-16 回读与 Range 起止一致，不以码点数代替字素数。 |
| 坐标/几何 | 非零 region、滚动、分数倍率、实际 DPR、奇数尺寸/padding、预览/导出不同 renderScale；包括布局溢出、字素共享盒、复杂行片段的明确边界。 |
| 同帧与生命周期 | 连续/倒序随机 seek、同帧两时刻分槽、响应/纹理倒序到达、取消、快速换倍率、热更新、字体迟到、paint 监听器写 DOM、降级与设备丢失；旧帧/新几何错配为 0。 |
| 14 缓存覆盖 | 无请求、已测不存在、缺字段、A/B selector 覆盖、旧缓存、损坏元数据、非网格、近邻时间、段族半写与回收；确认缺几何必整对回退，不以 null 伪造。 |
| 作者/兼容 | 所有四种入口能读到同一 DTO；API/库钉住不漂移，旧版本取帧画面不变；类型与正式编译/创建入口通过；不写只断言版本数字的测试。 |
| 像素目标 | 第 5.2 节的零姿态分片重建与原始网页纹理逐通道相等，非零姿态无原字残留；另对不满足前提的背景/连字/阴影样本证明未误称支持。14 编解码画质另按其门槛验，不混入此精确像素断言。 |

先跑改动文件对应精确测试、所属双工程 tsc 与实际涉及的 IPC/依赖专项；作者契约/格式变化追加 check:persistence-compat、check:assistant-capabilities。verify:changed 使用明确的本票文件清单，L2 先 dry-run，再选择直接消费者，不扫描共享脏工作区；不升级全量 test/build。真实捕获与像素/性能结论必须来自隔离 Electron + GPU，运行产物变化后才 electron:bundle；不借用 10/14 的历史实测作为本票证据。

本轮没有代码 diff，不发起实施前的代码审查或创建审查文档。设计交 Claude 与审查员批准；实施完成后按 AGENTS.md 做全新上下文的 L2 定向审查，最多三轮，才进入当时授权的提交边界。

Claude 需裁定的具体点：

1. 批准静态 `webText` 声明及 `info.web[参数].text`，保持网页引用值 schema 不变；在 10 合并后分配作者 API 号。
2. 批准第一版的 Range 排版盒、行片段与中心 pivot 边界；真实基线、glyph 轮廓、任意整页独立字形/干净背景不在本票。若要求它们，应先调整范围与方案，不能把估计值标成精确值。
3. 由 14 确定元数据 DTO/coverage 的最终文件与接入顺序；同刻几何映射探针失败或无法满足分片像素验收时停止回报，不自行改路线或降门槛。

## 11. Claude 裁定（11-01）
1. 批准静态 `webText` 声明与 `info.web[参数].text`，网页引用值 schema 不变；作者 API 号排在 ticket 10（API 8）之后，10 合并时由 Claude 分配（预计 API 9），实现期间用一处常量，合并时只改这一处。
2. 批准第一版范围：Range 排版盒、行片段、中心锚点；真实基线、字形轮廓、整页独立字形与干净背景不在本票。
3. 与 14 的接入顺序：先做实时取帧路径的几何（同刻同票据交付）与作者 DTO；缓存元数据接入等 14 的 boxes 元数据 DTO 定稿后再接（14 合并后的增量）。同刻映射探针或分片像素验收不过就停下回报。
设计不再单独送审（Codex 设计已逐条对齐 14/15 裁定），实现后按合并审查规则做一次 Opus xhigh 审查。
