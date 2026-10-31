import { glow, blur, chromaticAberration } from "henji-effects"
import { layoutText, drawText } from "henji-layout/text"

export default {
  name: "图层效果验收", kind: "generator", mode: "dynamic", width: 1280, height: 720, durationSeconds: 8,
  params: [
    { key: "background", type: "number", title: "背景 0透明 1黑 2深灰 3浅灰 4彩色", default: 2, min: 0, max: 4, step: 1 },
    { key: "strength", type: "number", title: "发光强度", default: 40, min: 0, max: 100, step: 1 },
    { key: "source", type: "number", title: "主体不透明度", default: 100, min: 0, max: 100, step: 1 },
    { key: "opacity", type: "number", title: "整层不透明度", default: 1, min: 0, max: 1, step: .01 },
    { key: "defocus", type: "number", title: "虚化像素", default: 8, min: 0, max: 80, step: 1 },
    { key: "lens", type: "boolean", title: "镜头散焦", default: false },
    { key: "motion", type: "boolean", title: "旋转与非等比缩放", default: false },
    { key: "onlyBackground", type: "boolean", title: "仅背景（下方片段）", default: false },
    { key: "order", type: "boolean", title: "先发光后模糊", default: false },
  ],
  layers(params, width, height) {
    const background = ["transparent", "black", "#242424", "#bcbcbc", "#245d85"][params.background]
    const label = layoutText("光晕 LIGHT", { fontSize: 70, fontWeight: 700, fill: { color: "#FFFFFF" } }, { anchor: { x: width / 2, y: height * .28, horizontal: .5, vertical: .5 } })
    const shape = (ctx: OffscreenCanvasRenderingContext2D, x: number, y: number) => {
      ctx.fillStyle = "white"; ctx.fillRect(x, y, 90, 5)
      ctx.fillStyle = "#ff3040"; ctx.fillRect(x, y + 24, 90, 3)
      ctx.fillStyle = "#3040ff"; ctx.fillRect(x, y + 48, 90, 3)
      ctx.fillStyle = "rgba(255,255,255,.5)"; ctx.beginPath(); ctx.arc(x + 45, y + 92, 22, 0, Math.PI * 2); ctx.fill()
    }
    const bg = { id: "background", draw(ctx: OffscreenCanvasRenderingContext2D) { if (params.background) { ctx.fillStyle = background; ctx.fillRect(0, 0, width, height) } } }
    if (params.onlyBackground) return [bg]
    return [bg,
      { id: "glow-title", bounds: [width / 2 - 300, height * .28 - 65, width / 2 + 300, height * .28 + 65], cacheKey: "title",
        effects: t => {
          const light = glow({ strength: params.strength, radius: 18 + t * 5, source_opacity: params.source, dither: 50 })
          const soft = blur({ sigma_fraction_height: .002 })
          return [...(params.order ? [light, soft] : [soft, light]), chromaticAberration({ amount: 8 })]
        },
        pose: t => ({ opacity: params.opacity, rotation: params.motion ? Math.sin(t) * .17 : 0, scaleX: params.motion ? 1.2 : 1, scaleY: params.motion ? .8 : 1 }),
        draw(ctx) { drawText(ctx, label) } },
      { id: "canvas-reference", bounds: [width * .22 - 100, height * .6 - 100, width * .22 + 200, height * .6 + 220],
        draw(ctx) { ctx.save(); ctx.filter = `blur(${params.defocus}px)`; shape(ctx, width * .22, height * .6); ctx.restore() } },
      { id: "gpu-defocus", bounds: [width * .65, height * .6, width * .65 + 100, height * .6 + 120],
        blurShape: params.lens ? "lens" : "gaussian", pose: () => ({ blur: params.defocus }),
        draw(ctx) { shape(ctx, width * .65, height * .6) } },
    ]
  },
}
