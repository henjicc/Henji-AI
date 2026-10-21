# 文字与动效

文字和动效直接用 Canvas2D 与普通 JS 写。宿主只提供参数值与时间；量字、换行、逐字动画、缓动都在你的代码里完成。

## 文字参数与样式

每段可见文字声明两项参数并用 `layer` 绑定到同一图层 id：`text` 存内容，`textStyle` 存样式。用户点选图层即可改字、改样式；默认值跟随风格预设。

`textStyle` 的值是对象（未填字段由你兜底）：`fontFamily`、`fontWeight`、`fontStyle`、`fontSize`（作品像素）、`tracking`（千分之一 em）、`leading`（行距像素，0 为自动 1.25 倍）、`align`、`fill:{enabled,color}`、`strokes:[{enabled,color,width,position}]`、`shadows:[{enabled,color,opacity,angle,distance,blur}]`、`allCaps` 等。颜色为六位十六进制。

```ts
function applyStyle(ctx, style) {
  const size = style.fontSize ?? 72
  ctx.font = `${style.fontStyle ?? "normal"} ${style.fontWeight ?? 400} ${size}px ${style.fontFamily ?? "sans-serif"}`
  ctx.letterSpacing = `${(style.tracking ?? 0) / 1000 * size}px`
  ctx.textBaseline = "alphabetic"
  return { size, lineHeight: style.leading || size * 1.25 }
}
function drawStyledText(ctx, text, x, y, style) {
  const { lineHeight } = applyStyle(ctx, style)
  const lines = String(style.allCaps ? text.toUpperCase() : text).split("\n")
  ctx.textAlign = style.align === "left" || style.align === "right" ? style.align : "center"
  lines.forEach((line, i) => {
    const at = y + i * lineHeight
    for (const stroke of style.strokes ?? []) if (stroke.enabled !== false && stroke.width > 0) {
      ctx.lineJoin = "round"; ctx.lineWidth = stroke.width * 2; ctx.strokeStyle = stroke.color; ctx.strokeText(line, x, at)
    }
    if (style.fill?.enabled !== false) { ctx.fillStyle = style.fill?.color ?? "#ffffff"; ctx.fillText(line, x, at) }
  })
}
export default {
  name: "样式标题", kind: "generator", mode: "static", width: 1920, height: 1080,
  params: [
    { key: "title", type: "text", title: "标题", default: "痕迹AI", maxLength: 80, multiline: true, layer: "title" },
    { key: "titleStyle", type: "textStyle", title: "标题样式", layer: "title", default: { fontSize: 120, fontWeight: 700 } }
  ],
  layers(params, width, height) {
    return [{ id: "title", bounds: [160, 380, width - 160, 700], draw(ctx) { drawStyledText(ctx, params.title, width / 2, 560, params.titleStyle) } }]
  }
}
```

## 量字、换行与自适应

- `ctx.measureText(text)` 返回宽度与 `actualBoundingBoxAscent/Descent`；先设好 `ctx.font` 和 `letterSpacing` 再量。
- 自动换行自己写：中文逐字累加、英文按词累加，超过 `maxWidth` 折行。标题过长时按 `maxWidth / 实测宽度` 等比缩小字号，保证读得完。
- 字体在 Worker 中加载；缺字体会回退并提示，交付前用取帧确认实际字形。

## 逐字与逐词动画

用 `Array.from(text)`（正确处理中文与表情）拆字，按索引错峰：

```ts
const clamp01 = v => Math.min(1, Math.max(0, v))
const expoOut = t => t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)
export default {
  name: "逐字入场", kind: "generator", mode: "dynamic", width: 1920, height: 1080,
  params: [
    { key: "text", type: "text", title: "文字", default: "逐字入场", maxLength: 60, layer: "text" },
    { key: "style", type: "textStyle", title: "样式", layer: "text", default: { fontSize: 110, fontWeight: 700 } }
  ],
  layers(params, width, height) {
    return [{ id: "text", bounds: [100, 420, width - 100, 660], draw(ctx, time) {
      const style = params.style, size = style.fontSize ?? 110
      ctx.font = `${style.fontWeight ?? 700} ${size}px ${style.fontFamily ?? "sans-serif"}`
      ctx.fillStyle = style.fill?.color ?? "#ffffff"; ctx.textBaseline = "middle"
      const chars = Array.from(params.text), widths = chars.map(c => ctx.measureText(c).width)
      let x = (width - widths.reduce((a, b) => a + b, 0)) / 2
      chars.forEach((c, i) => {
        const p = expoOut(clamp01((time - i * .045) / .6))
        ctx.globalAlpha = p; ctx.fillText(c, x, 540 + (1 - p) * 48); x += widths[i]
      })
      ctx.globalAlpha = 1
    } }]
  }
}
```

## 缓动、弹簧与随机

- 缓动是普通函数：`cubicOut = t => 1 - (1 - t) ** 3`、`backOut`、`elasticOut` 等按需要自己写；easing 参数值为名称或 `[x1,y1,x2,y2]`，用贝塞尔反解求值。
- 时间映射先夹到 0–1：`clamp01((time - start) / duration)`；超出区间保持端值，避免过冲闪烁。
- 随机必须可重现：用种子哈希而不是 `Math.random()`。

```text
const hash = (i, seed = 0) => { let h = Math.imul(i ^ seed, 0x9e3779b1); h ^= h >>> 15; h = Math.imul(h, 0x85ebca77); h ^= h >>> 13; return (h >>> 0) / 4294967296 }
```

- 运动模糊：需要曝光拖影的元素写成带 `pose` 的图层；整体快门、相位与采样上限写在模块 `motionBlur`。关闭某层写 `motionBlur: false`。
- 景深：pose 返回 `blur`（像素）并设 `blurShape: "lens"` 得到镜头散焦；默认 `gaussian`。
