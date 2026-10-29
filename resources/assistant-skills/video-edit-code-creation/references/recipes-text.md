# 文字配方：揭示、遮罩与排版

配方只示范写法与常见做法，不是推荐风格；配色、时长、幅度按风格说明书或需求改。

先读 type 查已安装字体，author-text-motion 查文字参数、样式与排版库，templates 查换字自适应。终端光标和数字见 recipes-text-data；每帧从时间直接求画面，不累计打字状态。

## 逐字／逐词揭示

- 整段先用 `layoutText` 排好，一次 `drawText(ctx, layout, { graphemes: (g, i) => ({ y, opacity }) })` 给出每个字素的动画；不要另排单字。容器先动，字素仅晚约 .06 秒跟随，间隔约 .01 秒、局部位移约 .12 字号；不单独做原地淡入上浮。
- 底板按整段显示：默认首个字素可见就出现；需要淡入时传 `backgroundAndDecorationOpacity: clamp01(time / .3)`，它同时控制整段装饰线。所有字素的发光与外描边先画，再画各字填色及其内/居中描边，外描边不遮住正文。
- 错峰跨度为 (n−1)×间隔；建议 ≤0.6 秒，长标题分拍或压缩间隔，不删字。
- 复杂连字／组合字形逐字绘制会失去连写，必要时改为逐词或整行裁切揭示。中文关键词先按语义分段，每段作为独立 text 参数或 table 行。
- 逐词排连续短语时按排版结果的完整段宽度摆放并留间隔；横向排不下给 `maxWidth` 让排版库折行，不靠单字长度×字号估计。
- 随配音揭示必须有真实词级时刻；按时刻表或实例曲线求进度。按字数比例推算只叫近似，不能称逐词识别。

## 跟随容器，从线后升起

遮挡窗口固定在容器局部坐标，整组随容器滑入，文字稍晚从窗口下边缘跟进（大幅遮罩升起可用约 1.4 字高，轻入场用 0.3–0.6 字号）：用 `ctx.save()` → `ctx.rect` + `ctx.clip()` 固定窗口，再在窗口内移动文字。整组运动用 pose；窗口按排版结果的 `box` 定，换字后跟着变宽，末尾不会被裁。

```ts
import { layoutText, drawText } from "henji-layout/text"
const clamp01 = v => Math.min(1, Math.max(0, v))
const expoOut = t => t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)
export default {
  name: "线后文字揭示", kind: "generator", mode: "dynamic", width: 1920, height: 1080, durationSeconds: 5,
  params: [
    { key: "title", type: "text", title: "揭示文字", default: "让灵感浮出画面", maxLength: 80, layer: "window" },
    { key: "style", type: "textStyle", title: "文字样式", layer: "window", default: { fontSize: 96, fontWeight: 700, align: "left", fill: { color: "#e6f2fa" } } },
    { key: "ink", type: "color", title: "线颜色", default: "#e6f2fa" },
    { key: "enter", type: "number", title: "升起秒数", default: .65, min: .3, max: 1.2, step: .05 },
    { key: "each", type: "number", title: "字符间隔秒", default: .012, min: 0, max: .06, step: .005 }
  ],
  layers(params, width, height) {
    const layout = layoutText(params.title, params.style, { maxWidth: width * .84, maxLines: 1, forceGraphemes: true, fit: { minFontSize: 40 }, anchor: { x: width * .08, y: height / 2, horizontal: 0, vertical: .5 } })
    const { x: x0, y: y0, width: w, height: h } = layout.box, size = layout.style.fontSize
    const count = layout.graphemes.length
    const each = Math.min(params.each, .18 / Math.max(1, count - 1))
    return [{ id: "window", bounds: [x0, y0, x0 + w, y0 + h], pose: t => ({ x: (1 - expoOut(clamp01(t / .7))) * -96 }), draw(ctx, time) {
      ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, Math.max(1, w + size * .1), h); ctx.clip()
      drawText(ctx, layout, { graphemes: (g, i) => {
        const elapsed = time - .06 - i * each
        const p = expoOut(clamp01(elapsed / params.enter))
        return { y: (1 - p) * size * .12, opacity: clamp01(elapsed / (params.enter * .5)) }
      } })
      ctx.restore()
      ctx.strokeStyle = params.ink; ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(x0, y0 + h - 2); ctx.lineTo(x0 + Math.max(1, w) * clamp01((time - .1) / params.enter), y0 + h - 2); ctx.stroke()
    } }]
  }
}
```

整段布局每帧按内容和字体代次复用；返回值深度只读。不要对每个字另调 `layoutText`，否则整段的超框与截断无法随绘制复核。同一帧全部排出的字素透明度都大于 0 才视为揭示完成；完成后仍会报告原布局的遗漏行。分层图集至少按 2× 栅格化（超大纹理会降档），同档缓存复用，逐帧动画不重画；落定仍沿用同一图集和对齐方式，避免边缘闪变。

## 对齐、字距、行距

对齐、字距、行距都写在 textStyle 里交给排版库：`align` 管盒内左／中／右与两端对齐（`justify` 系列，末行对齐方式见枚举），`anchor` 管盒子放在哪；绕中心变换用排版结果的 `box` 作 pose 中心，不按可见字数移动锚点。

`tracking` 是千分之一 em，`leading` 是行距像素（0 为 1.25 倍字号）。标题行距 1.05–1.2 倍字号、正文 1.4–1.6 倍；大标题 tracking −10～−30，大写标签 +50～+150，中文正文 0～+20。

换字／字体后先看排版结果：`totalLines`、`truncated` 与 `fit.fontSize` 是否合理，再取帧检查孤字、下伸字母、边缘裁切、遮罩内逐字过冲。遮罩先全帧看关系再按标注放大，不能只凭排版数值验收。
