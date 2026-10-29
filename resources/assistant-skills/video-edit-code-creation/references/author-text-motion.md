# 文字与动效

动效直接用 Canvas2D 与普通 JS 写；文字的量字、换行、对齐、描边阴影与自动缩字号交给内置排版库：`import { layoutText, drawText } from "henji-layout/text"`，与剪辑文字工具同一套引擎，画出来和文字工具一致。几个框按内容排成行列时用 `henji-layout/flex` 的 `layoutBoxes`。作者接口 v6 起可用（见 code-project 的内置库）。不要自己写量字、折行、两端对齐或多层描边。

## 文字参数与样式

每段可见文字声明两项参数并用 `layer` 绑定到同一图层 id：`text` 存内容，`textStyle` 存样式。用户点选图层即可改字、改样式；默认值跟随风格预设。

`textStyle` 的值是宿主补齐默认值后的完整样式对象，直接传给 `layoutText`：`fontFamily`、`fontWeight`、`fontSize`（作品像素）、`tracking`（千分之一 em）、`leading`（行距像素，0 为自动 1.25 倍）、`align`、`verticalAlign`、`fill`、`strokes`、`shadows`、`background`、`allCaps` 等。临时样式也可以只写部分字段，其余取默认。

```ts
import { layoutText, drawText } from "henji-layout/text"
export default {
  name: "样式标题", kind: "generator", mode: "static", width: 1920, height: 1080,
  params: [
    { key: "title", type: "text", title: "标题", default: "痕迹AI", maxLength: 80, multiline: true, layer: "title" },
    { key: "titleStyle", type: "textStyle", title: "标题样式", layer: "title", default: { fontSize: 120, fontWeight: 700 } }
  ],
  layers(params, width, height) {
    const layout = layoutText(params.title, params.titleStyle, {
      maxWidth: width - 320, maxLines: 3, fit: { minFontSize: 48 },
      anchor: { x: width / 2, y: height / 2, horizontal: .5, vertical: .5 }
    })
    const { x, y, width: w, height: h } = layout.box
    return [{ id: "title", bounds: [x, y, x + w, y + h], draw(ctx) { drawText(ctx, layout) } }]
  }
}
```

## layoutText 与 drawText

`layoutText(text, style, options)` 只排版不绘制，返回的布局对象原样交给 `drawText(ctx, layout)`；不要展开、复制或 JSON 往返，否则 drawText 认不出。

| options | 作用 |
| --- | --- |
| `maxWidth` | 超过就折行（0 为不限）；中文按字、英文单词不拆开另设 `wrap: "word"`，`"none"` 只在 `\n` 处换行 |
| `maxLines`、`maxHeight` | 行数、高度上限。超出的整行默认截掉，`truncate: false` 保留；`maxHeight: 0` 表示一行都放不下，不限就不写 |
| `fit` | `{ minFontSize, maxFontSize? }`：放不下时在上下限内缩小字号，描边、阴影、行距同比缩放 |
| `box` | 固定放置盒 `{ width, height }`；`align`、`verticalAlign` 在盒内生效。不给时盒子就是文字本身 |
| `anchor` | `{ x, y, horizontal, vertical }`：盒子上比例点 (horizontal, vertical) 放到 (x, y)。不给时盒子左上在 (0, 0)，配合 `ctx.translate` 摆位置；锚点不跟 `align` 联动，左对齐文字要锚左边写 `horizontal: 0` |

返回值都是作品像素：`box`（底板、选框、遮罩按它算）、`lines`（每行 `text`、`x`、`y`、`width`、`height`、`baseline`）、`graphemes`（每个字素 `text`、`x`、`y` 为基线、`advance`、`line`、`style`）、`style`（缩字号后的实际样式，`fit.fontSize` 为实际字号）、`totalLines`，以及 `truncated`、`omittedRanges`、`overflow`。原文不能被静默截掉：`truncated` 为真时加 `fit`、加高盒子或分拍；用排版库画的文字，复核能检查超框。

drawText 按当前变换、`globalAlpha` 与 clip 绘制。同内容、样式、选项和字体代次的 `layoutText` 返回同一深度只读布局，可在 `layers()` 中调用。静态整段位图与逐字图集按布局、分辨率档位和颜色空间复用；每布局最多 4 张（包含整段层），LRU 淘汰时关闭。Canvas、pose 和字素 scale 自动选择最高 4× 分辨率，图集最低 2×，超大纹理会降档。更大放大需求可提高字号。带 `graphemes` 的调用全程沿用图集，落定不换抗锯齿路径；落定后可用 `cacheKey` 跳过整层录制。

## 逐字与逐词动画

绘制顺序是整段底板 → 所有字素的阴影/发光与外描边 → 各字填色及其内/居中描边 → 整段装饰线，字素的变换和透明度同时作用于上下两层。底板和装饰线不随字逐个出现或移动：默认首个字素可见就显示整段；在 `drawText` 选项传 `backgroundAndDecorationOpacity`（0–1）可单独隐藏或淡入淡出整段层，例如 `{ backgroundAndDecorationOpacity: clamp01(time / .3), graphemes: ... }`。

逐字动画只排整段，在一次 `drawText` 的 `graphemes` 回调里返回动画参数；字素簇各自栅格进共享图集，不会裁入相邻字的斜体像素。`x/y` 是相对排版位置的像素偏移，`scale/rotate` 围绕字素基线起点（旋转为弧度），`opacity` 为 0–1，返回 `null` 隐藏。容器先移动，子元素只晚一点跟随，透明度先于位移完成；不单独做原地淡入上浮：

```ts
import { layoutText, drawText } from "henji-layout/text"
const clamp01 = v => Math.min(1, Math.max(0, v))
const expoOut = t => t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)
export default {
  name: "逐字入场", kind: "generator", mode: "dynamic", width: 1920, height: 1080,
  params: [
    { key: "text", type: "text", title: "文字", default: "逐字入场", maxLength: 60, layer: "text" },
    { key: "style", type: "textStyle", title: "样式", layer: "text", default: { fontSize: 110, fontWeight: 700 } }
  ],
  layers(params, width, height) {
    const layout = layoutText(params.text, params.style, { maxWidth: width - 200, maxLines: 2, fit: { minFontSize: 48 }, anchor: { x: width / 2, y: height / 2, horizontal: .5, vertical: .5 } })
    const { x, y, width: w, height: h } = layout.box
    return [{ id: "text", bounds: [x, y, x + w, y + h + 48], pose: t => ({ y: (1 - expoOut(clamp01(t / .7))) * 96 }), draw(ctx, time) {
      drawText(ctx, layout, { graphemes: (g, i) => {
        const elapsed = time - .06 - i * Math.min(.012, .18 / Math.max(1, layout.graphemes.length - 1))
        return { y: (1 - expoOut(clamp01(elapsed / .6))) * layout.style.fontSize * .12, opacity: clamp01(elapsed / .3) }
      } })
    } }]
  }
}
```

- 字素模式会失去字素之间的连写和字距塑形；组合字素簇内部保持一起绘制。整段静态 drawText 保留原生整行塑形。字素的 `positionKind` 为 `"native-estimate"` 时，位置是整行塑形的推进估计：中文逐字没问题，英文字偶距、连字与组合字形逐字画会有细微差别，必要时改为逐词或整行裁切揭示。
- 逐词：按 `graphemes[i].line` 与原文范围（`source`）把字素归成词，词首 `x` 定位，让同一词的字素回调使用同一组进度；独立词卡片可各自排版并绘制。

同一帧所有排出的字素透明度都大于 0，复核才开始检查整段超框与截断；遗漏行仍来自整段布局事实。索引数量或数组也可用于明确的打字揭示，但平滑入场使用上面的回调。

揭示结束后仍保留 `graphemes` 参数，沿用同一图集；不要为“优化”切换成无选项的整段调用，否则两条路径的塑形与采样差异可能使边缘一闪。

## 盒子布局：layoutBoxes

`layoutBoxes(tree, { width, height })` 按 CSS flex 规则排一棵框树，返回以 id 为键的框 `{ x, y, width, height, contentBox, text? }`。节点 `style` 写 `flexDirection`（默认 `"row"`）、`gap`、`padding`、`margin`、`width`/`height`（数字或 `"50%"`）、`alignItems`、`justifyContent`、`flexGrow` 等；带 `text: { content, style, options }` 的节点自动量字，宽度跟内容走。绘制该节点文字时先 `ctx.translate(box.contentBox.x, box.contentBox.y)` 再 `drawText(ctx, box.text)`。人名条、卡片、标签组这类“底板包住几行字”的版式用它算，不手算宽高。id 不能重复，文字节点不能有子框。

1.2.0 起根节点省略宽高或写 `"auto"` 时按内容收缩，画幅 size 是尺寸上限与百分比参照；铺满画幅须显式写 `style: { width: "100%", height: "100%" }`。卡片可只给 width，height 随内容；整组居中放在图层 pose 中，或用显式满幅容器居中。

文字 `options.maxLines/maxHeight` 的测量高度按实际显示行数返回，不为遗漏行留白；`totalLines/truncated/omittedRanges` 仍保存完整事实。需要正文全部可读时用 fit、增宽或改版，不能用截断隐藏原文。

同一 row 用 `alignItems: "baseline"`（单项可用 `alignSelf: "baseline"`），标签、数值和单位按首行 `alphabeticBaseline` 自动对齐，不手写 y 补偿；嵌套容器沿用首个参考子节点的基线。用 `lines[0].baseline` 会混用中线，手工叠加会重复补偿。完整表格参数与数据卡见 recipes-text-data。

## 缓动、弹簧与随机

- 缓动是普通函数：`cubicOut = t => 1 - (1 - t) ** 3`、`backOut`、`elasticOut` 等按需要自己写；easing 参数值为名称或 `[x1,y1,x2,y2]`，用贝塞尔反解求值。
- 时间映射先夹到 0–1：`clamp01((time - start) / duration)`；超出区间保持端值，避免过冲闪烁。
- 随机必须可重现：用种子哈希而不是 `Math.random()`。

```text
const hash = (i, seed = 0) => { let h = Math.imul(i ^ seed, 0x9e3779b1); h ^= h >>> 15; h = Math.imul(h, 0x85ebca77); h ^= h >>> 13; return (h >>> 0) / 4294967296 }
```

- 运动模糊：需要曝光拖影的元素写成带 `pose` 的图层；整体快门、相位与采样上限写在模块 `motionBlur`。关闭某层写 `motionBlur: false`。
- 景深：pose 返回 `blur`（像素）并设 `blurShape: "lens"` 得到镜头散焦；默认 `gaussian`。
