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

drawText 按当前变换、`globalAlpha` 与 clip 绘制。它每次重新栅格，静止的文字层放在 `mode: "static"` 的素材里，或在动画落定后给图层 `cacheKey`（键里带上文字与样式），否则这一层每帧重画。缩放较大的推近不要先排小字再 `ctx.scale` 放大，按最终字号排版。

## 逐字与逐词动画

逐字动画读 `layout.graphemes`，不拆字自己量。每个字素用自己的 `style` 单独排版，再平移到整段布局给出的位置：

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
    const glyphs = layout.graphemes.filter(g => g.x !== null && g.text.trim()).map(g => ({ g, one: layoutText(g.text, g.style) }))
    const { x, y, width: w, height: h } = layout.box
    return [{ id: "text", bounds: [x, y, x + w, y + h + 48], draw(ctx, time) {
      glyphs.forEach(({ g, one }, i) => {
        const p = expoOut(clamp01((time - i * .045) / .6)), at = one.graphemes[0]
        ctx.save(); ctx.globalAlpha = p
        ctx.translate(g.x - at.x, g.y - at.y + (1 - p) * 48)
        drawText(ctx, one); ctx.restore()
      })
    } }]
  }
}
```

- 字素的 `positionKind` 为 `"native-estimate"` 时，位置是整行塑形的推进估计：中文逐字没问题，英文字偶距、连字与组合字形逐字画会有细微差别，必要时改为逐词或整行裁切揭示。
- 逐词：按 `graphemes[i].line` 与原文范围（`source`）把字素归成词，词首 `x` 定位，或把每个词单独 layoutText。

## 盒子布局：layoutBoxes

`layoutBoxes(tree, { width, height })` 按 CSS flex 规则排一棵框树，返回以 id 为键的框 `{ x, y, width, height, contentBox, text? }`。节点 `style` 写 `flexDirection`（默认 `"row"`）、`gap`、`padding`、`margin`、`width`/`height`（数字或 `"50%"`）、`alignItems`、`justifyContent`、`flexGrow` 等；带 `text: { content, style, options }` 的节点自动量字，宽度跟内容走。绘制该节点文字时先 `ctx.translate(box.contentBox.x, box.contentBox.y)` 再 `drawText(ctx, box.text)`。人名条、卡片、标签组这类“底板包住几行字”的版式用它算，不手算宽高。id 不能重复，文字节点不能有子框。

## 缓动、弹簧与随机

- 缓动是普通函数：`cubicOut = t => 1 - (1 - t) ** 3`、`backOut`、`elasticOut` 等按需要自己写；easing 参数值为名称或 `[x1,y1,x2,y2]`，用贝塞尔反解求值。
- 时间映射先夹到 0–1：`clamp01((time - start) / duration)`；超出区间保持端值，避免过冲闪烁。
- 随机必须可重现：用种子哈希而不是 `Math.random()`。

```text
const hash = (i, seed = 0) => { let h = Math.imul(i ^ seed, 0x9e3779b1); h ^= h >>> 15; h = Math.imul(h, 0x85ebca77); h ^= h >>> 13; return (h >>> 0) / 4294967296 }
```

- 运动模糊：需要曝光拖影的元素写成带 `pose` 的图层；整体快门、相位与采样上限写在模块 `motionBlur`。关闭某层写 `motionBlur: false`。
- 景深：pose 返回 `blur`（像素）并设 `blurShape: "lens"` 得到镜头散焦；默认 `gaussian`。
