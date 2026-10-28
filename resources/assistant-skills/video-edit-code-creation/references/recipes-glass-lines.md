# 玻璃、线条生长与圆角卡片

配方只示范写法与常见做法，不是推荐风格；配色、时长、幅度按风格说明书或需求改。

玻璃通常需要可辨背景：文字、网格、色带或真实画面；观感来自背后内容折射／磨砂、边光、投影。只有半透明填充与描边叫透明卡片，不称真实折射。

## 玻璃路线

| 组件／做法 | 适用与检查 |
| --- | --- |
| Glass（effect:shaders.Glass） | 局部透镜／自定义形状玻璃；refraction 0–2、blur 0–20、thickness 0–1、aberration 0–1；从低色差与适量边光起步 |
| FlutedGlass（effect:shaders.FlutedGlass） | 全屏条纹玻璃；查 shape/angle/frequency/refraction 等目录属性，不把它当局部圆角卡片 |
| GlassTiles（effect:shaders.GlassTiles） | 玻璃砖阵列折射，适合背景；tileCount/roundness/intensity 按实际目录单位 |
| Crystal | 棱面水晶透镜，强调切面，不能冒充柔和磨砂 |
| 代码滤镜 | createWebGPU 读 `inputs.current`，在形状内偏移采样（折射）、多点平均（磨砂）＋边光；不把空间模糊叫相机景深 |
| 代码生成器自身内容 | 在 Canvas 里对玻璃区域 `clip()` 后以 `ctx.filter = "blur(…)"` 重画自己的背景层；只能磨砂自己画的内容 |

Frost 是冰霜生成材质，不是模糊现有画面的滤镜。生成器读不到别的时间线轨道；要处理既有视频就加片段效果或代码滤镜。几何、遮罩、边光、投影共享同一布局参数，移动时一起变；侧转轮廓不能只跟中心与宽高，否则双轮廓。真实三维体积、镜头景深并不从二维玻璃自动得到。

磨砂从 Glass.blur 约 2–6 起试，不把 20 当默认；refraction 从 .3–.8 起试，观察边缘是否把文字拉成重影。先边缘高光再轻投影，同一光向；背景已经暗时用边缘明度差，别堆黑投影。Canvas 模糊半径是像素、内置模糊是强度、Glass.blur 是组件单位，三套量纲不互换。任何参数建议均须试帧。

## 线条、图标与卡片

- 描边生长用 `ctx.setLineDash([长度, 长度])` 与 `ctx.lineDashOffset = 长度 × (1 − 进度)`，长度可用 `Path2D` 估算或按折线段求和；只裁描边，不改变填充。无填充轮廓就只 `stroke()`。
- 单向从起点长出；双向从中点向两端长出，.6–1.2 秒 expoOut；多段图标各段同时从中间长出，形成统一性。
- SVG 图标的 d 字符串可直接 `new Path2D(d)` 绘制；SVG 里的滤镜、渐变定义不会生效。已有真实 Logo 走 image 参数；描边图标用已核对路径或项目组件，不手画近似 Logo、不用 emoji／符号字当图标。
- 一套图标统一线宽、端点与风格。1080p 主体图标可 300–500px，小图标 80–160px，线宽 2–4px 是起点，缩小帧看清楚再定。
- 圆角卡片用 `ctx.roundRect(x, y, w, h, r)`（r 可为 1–4 项数组）；圆角 16–32px，线宽 2–4px，按短边比例统一。文字驱动宽高时取 layoutText 的 `box`，圆角 ≤ 高度一半。

## 完整样例：磨砂透镜＋描边引导

背景色带由代码画出，透镜区域重画同一背景并模糊、加边光，标题与生长线保持清晰。文字、色彩、磨砂、线条节奏开放参数。

```ts
import { layoutText, drawText } from "henji-layout/text"
const clamp01 = v => Math.min(1, Math.max(0, v))
const expoOut = t => t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)
function backdrop(ctx, width, height, time) {
  ctx.fillStyle = "#0f1217"; ctx.fillRect(0, 0, width, height)
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = i % 2 ? "rgba(70, 160, 170, .35)" : "rgba(120, 90, 200, .25)"
    ctx.fillRect(0, height * (i / 6) + Math.sin(time * .5 + i) * 30, width, height / 12)
  }
}
export default {
  name: "磨砂透镜与引导线", kind: "generator", mode: "dynamic", width: 1920, height: 1080, durationSeconds: 5,
  params: [
    { key: "label", type: "text", title: "透镜说明", default: "看见信息的层次", maxLength: 64, layer: "label" },
    { key: "accent", type: "color", title: "引导色", default: "#99e0f2" },
    { key: "frost", type: "number", title: "磨砂像素", default: 12, min: 0, max: 40, step: 1 },
    { key: "seconds", type: "number", title: "线条生长秒数", default: .8, min: .3, max: 1.5, step: .1 }
  ],
  layers(params, width, height) {
    const cx = width * .5, cy = height * .5, r = height * .22
    const p = t => expoOut(clamp01((t - .2) / params.seconds))
    return [
      { id: "backdrop", draw(ctx, time) { backdrop(ctx, width, height, time) } },
      { id: "lens", bounds: [cx - r, cy - r, cx + r, cy + r], draw(ctx, time) {
        ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip()
        ctx.filter = `blur(${params.frost}px)`; backdrop(ctx, width, height, time); ctx.filter = "none"
        ctx.fillStyle = "rgba(255, 255, 255, .06)"; ctx.fillRect(cx - r, cy - r, r * 2, r * 2); ctx.restore()
        ctx.strokeStyle = "rgba(255, 255, 255, .35)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI * 1.1, Math.PI * 1.6); ctx.stroke()
      } },
      { id: "guide", draw(ctx, time) {
        const points = [[width * .52, height * .6], [width * .66, height * .75], [width * .88, height * .75]]
        const length = Math.hypot(points[1][0] - points[0][0], points[1][1] - points[0][1]) + points[2][0] - points[1][0]
        ctx.strokeStyle = params.accent; ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.lineJoin = "round"
        ctx.setLineDash([length, length]); ctx.lineDashOffset = length * (1 - p(time))
        ctx.beginPath(); ctx.moveTo(...points[0]); ctx.lineTo(...points[1]); ctx.lineTo(...points[2]); ctx.stroke(); ctx.setLineDash([])
      } },
      { id: "label", bounds: [width * .66, height * .78, width * .94, height * .86], draw(ctx, time) {
        ctx.globalAlpha = clamp01((time - .2 - params.seconds * .6) / .3)
        drawText(ctx, layoutText(params.label, { fontSize: 48, fontWeight: 600, align: "left", fill: { color: params.accent } }, { maxWidth: width * .28, maxLines: 2, fit: { minFontSize: 28 }, anchor: { x: width * .66, y: height * .78, horizontal: 0, vertical: 0 } }))
      } }
    ]
  }
}
```

检查磨砂前／后背景形状、线条抵达与文字出现的因果，透镜内不要再放清晰标题。按 review 全帧、小屏与标注局部看边缘；加载成功不证明玻璃观感、抗锯齿或长片性能。
