# 文字配方：揭示、遮罩与排版

配方只示范写法与常见做法，不是推荐风格；配色、时长、幅度按风格说明书或需求改。

先读 type 查已安装字体，author-text-motion 查文字参数与样式，templates 查换字自适应。终端光标和数字见 recipes-text-data；每帧从时间直接求画面，不累计打字状态。

## 逐字／逐词揭示

- 用 `Array.from(text)` 拆字，`ctx.measureText` 量每个字宽后逐个 `fillText`；常见起点：逐字间隔 1–2 帧，位移约 0.3–0.6 字号，透明度比位移先完成。
- 错峰跨度为 (n−1)×间隔；建议 ≤0.6 秒，长标题分拍或压缩间隔，不删字。
- 复杂连字／组合字形逐字绘制会失去连写，必要时改为逐词或整行裁切揭示。中文关键词先按语义分段，每段作为独立 text 参数或 table 行。
- 逐词排连续短语时按完整段宽度摆放并留间隔；横向排不下按语义换行，不靠单字长度×字号估计。
- 随配音揭示必须有真实词级时刻；按时刻表或实例曲线求进度。按字数比例推算只叫近似，不能称逐词识别。

## 从一条线后升起

遮挡窗口保持不动，文字从它的下边缘以下约 1.4 字高升到最终位置：用 `ctx.save()` → `ctx.rect` + `ctx.clip()` 固定窗口，再在窗口内移动文字。不要移动整个裁切区来假装窗口静止；换字后重新量宽，否则末尾被裁。

```ts
const clamp01 = v => Math.min(1, Math.max(0, v))
const expoOut = t => t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)
export default {
  name: "线后文字揭示", kind: "generator", mode: "dynamic", width: 1920, height: 1080, durationSeconds: 5,
  params: [
    { key: "title", type: "text", title: "揭示文字", default: "让灵感浮出画面", maxLength: 80, layer: "window" },
    { key: "style", type: "textStyle", title: "文字样式", layer: "window", default: { fontSize: 96, fontWeight: 700 } },
    { key: "ink", type: "color", title: "文字与线颜色", default: "#e6f2fa" },
    { key: "enter", type: "number", title: "升起秒数", default: .65, min: .3, max: 1.2, step: .05 },
    { key: "each", type: "number", title: "字符间隔秒", default: .045, min: 0, max: .12, step: .005 }
  ],
  layers(params, width, height) {
    const size = params.style.fontSize ?? 96, lineHeight = size * 1.2
    const x0 = width * .08, y0 = (height - lineHeight) / 2
    return [{ id: "window", bounds: [x0, y0, width * .92, y0 + lineHeight], draw(ctx, time) {
      ctx.font = `${params.style.fontWeight ?? 700} ${size}px ${params.style.fontFamily ?? "sans-serif"}`
      const chars = Array.from(params.title), widths = chars.map(c => ctx.measureText(c).width)
      const total = widths.reduce((a, b) => a + b, 0)
      const each = Math.min(params.each, .6 / Math.max(1, chars.length - 1))
      ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, Math.max(1, total + size * .1), lineHeight); ctx.clip()
      ctx.fillStyle = params.ink; ctx.textBaseline = "top"
      let x = x0
      chars.forEach((c, i) => {
        const start = .15 + i * each, p = expoOut(clamp01((time - start) / params.enter))
        ctx.globalAlpha = clamp01((time - start) / (params.enter * .5))
        ctx.fillText(c, x, y0 + (1 - p) * (lineHeight + size * .4)); x += widths[i]
      })
      ctx.restore()
      ctx.globalAlpha = 1; ctx.strokeStyle = params.ink; ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(x0, y0 + lineHeight - 2); ctx.lineTo(x0 + Math.max(1, total) * clamp01((time - .1) / params.enter), y0 + lineHeight - 2); ctx.stroke()
    } }]
  }
}
```

## 对齐、字距、行距

`ctx.textAlign` 决定 x 锚左／中／右，`ctx.textBaseline` 决定 y 锚；绕中心变换用稳定量字框作 pose 中心，不按可见字数移动锚点。

`ctx.letterSpacing` 是像素，按字号×em 换算；行距为字号倍数。标题行距 1.05–1.2、正文 1.4–1.6；大标题字距 −.01～−.03em，大写标签 +.05～+.15em，中文正文 0～+.02em。textStyle 的 tracking 是千分之一 em、leading 是作品像素，换算后再用。

换字／字体后测完整布局，检查孤字、下伸字母、边缘裁切、遮罩内逐字过冲。遮罩先全帧看关系再按标注放大，不能只凭量字数值验收。
