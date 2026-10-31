import { definePlanner, type EffectPlanner, type EffectPlannerFrame } from './effectPlanner'
import { Planner, ZERO, type VideoEditBuiltinTexture } from './effectPlan'
import type { VideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
import { planColorGrade } from '@/core/imaging/adjustments/plan'
import { SHARPEN_MIN_SIGMA_PX, sharpenSigma } from '@/core/videoEdit/sharpen'
import { recordingFrameBackground } from '@/core/videoEdit/recordingFrame'
import { chromaticAberrationPass, CHROMATIC_ENTRIES, CHROMATIC_WGSL } from './chromaticAberration'
import { planRecordingCursor } from './videoEditRecordingCursorPlan'
import { planRecordingZoom } from './videoEditRecordingZoomPlan'

const number = (params: VideoEditBuiltinParams, key: string): number => params[key] as number
function hexColor(value: string): [number, number, number] { return [1, 3, 5].map(index => parseInt(value.slice(index, index + 2), 16) / 255) as [number, number, number] }
/** 同一帧预览与导出共用确定的颗粒种子。 */
export function videoEditGrainSeed(frame: number): number { return (Math.max(0, Math.floor(frame)) * 7 + 1) % 65_521 }

/** 只负责分配工序容器与收口结果；效果回调只写自己的算法。 */
function passPlan(draw: (plan: Planner, params: VideoEditBuiltinParams, frame: EffectPlannerFrame, instance: Parameters<EffectPlanner['plan']>[2]) => void): EffectPlanner['plan'] {
  return (params, frame, instance) => {
    const plan = new Planner(frame.width, frame.height)
    draw(plan, params, frame, instance)
    return { width: frame.width, height: frame.height, scratch: plan.scratch, passes: plan.passes }
  }
}

export const BASIC_EFFECT_PLANNERS: readonly (EffectPlanner & { readonly entries: typeof CHROMATIC_ENTRIES | readonly [] })[] = [
  definePlanner({ id: 'color_grade', plan: (params, frame) => {
    const { width, height } = frame
    const H = frame.layer ? frame.layer.referenceSize.height * frame.layer.rasterScale : height
    const grade = planColorGrade(params, width, height, frame.layer ? [frame.layer.referenceSize.width * frame.layer.rasterScale, H] : [width, height])
    if (frame.layer) for (const pass of grade.passes) pass.uniforms = new Float32Array([...pass.uniforms, ...frame.layer.rasterOrigin, frame.layer.contentBounds.width * frame.layer.rasterScale, frame.layer.contentBounds.height * frame.layer.rasterScale])
    return grade
  } }),
  definePlanner({ id: 'sharpen', plan: passPlan((plan, params, frame) => {
    const { height } = frame
    const H = frame.layer ? frame.layer.referenceSize.height * frame.layer.rasterScale : height
    const blurred = plan.alloc()
    const sigma = Math.max(SHARPEN_MIN_SIGMA_PX, sharpenSigma(number(params, 'radius')) * H)
    plan.gaussian('input', blurred, sigma, sigma, true)
    plan.pass('unsharp', blurred, 'output', [number(params, 'amount') / 100 * 3, number(params, 'threshold') / 100 * 0.25, 0, 0], ZERO, 'input')
  }) }),
  definePlanner({ id: 'black_white', plan: passPlan(plan => {
    plan.pass('black_white', 'input', 'output')
  }) }),
  definePlanner({ id: 'invert', plan: passPlan(plan => {
    plan.pass('invert', 'input', 'output')
  }) }),
  definePlanner({ id: 'mosaic', plan: passPlan((plan, params, frame) => {
    const { width, height } = frame
    const H = frame.layer ? frame.layer.referenceSize.height * frame.layer.rasterScale : height
    const block = number(params, 'block_size') / 100 * 0.1 * H
    if (block < 1) { plan.pass('copy', 'input', 'output'); return }
    plan.pass('mosaic', 'input', 'output', [block / width, block / height, 0, 0])
    if (frame.layer) {
      const local = frame.layer
      plan.passes.at(-1)!.uniforms = new Float32Array([...plan.passes.at(-1)!.uniforms, (local.rasterOrigin[0] + local.contentBounds.width * local.rasterScale / 2) / width, (local.rasterOrigin[1] + local.contentBounds.height * local.rasterScale / 2) / height, 1, 0])
    }
  }) }),
  definePlanner({ id: 'vignette', plan: passPlan((plan, params, frame) => {
    const { width, height } = frame
    plan.pass('vignette', 'input', 'output', [number(params, 'amount') / 100, 0.15 + number(params, 'midpoint') / 100 * 0.8, 0.05 + number(params, 'feather') / 100 * 0.9, width / height], [...hexColor(String(params.color)), 0])
  }) }),
  definePlanner({ id: 'film_grain', plan: passPlan((plan, params, frame) => {
    const { height } = frame
    const H = frame.layer ? frame.layer.referenceSize.height * frame.layer.rasterScale : height
    // 降分辨率时每个栅格像素覆盖更多独立颗粒，振幅随平均后的方差衰减。
    const cell = (0.0005 + number(params, 'size') / 100 * 0.0035) * H; const scale = Math.min(1, Math.max(1e-3, frame.renderScale ?? 1))
    const visible = Math.min(1, scale * Math.max(1, cell / scale))
    plan.pass('grain', 'input', 'output', [number(params, 'amount') / 100 * 0.25 * visible, cell, videoEditGrainSeed(frame.frame), params.monochrome === false ? 0 : 1])
  }) }),
  definePlanner({ id: 'chromatic_aberration', entries: CHROMATIC_ENTRIES, wgsl: CHROMATIC_WGSL, plan: passPlan((plan, params, frame) => {
    const { width, height } = frame
    const pass = chromaticAberrationPass(params, width, height, false, frame.layer)
    if (pass) {
      plan.pass(pass.entry, 'input', 'output', pass.a, pass.b, undefined, pass.c)
      if (frame.layer) plan.passes.at(-1)!.uniforms = new Float32Array([...plan.passes.at(-1)!.uniforms, ...pass.spatial])
    } else plan.pass('copy', 'input', 'output')
  }) }),
  definePlanner({ id: 'crop', plan: passPlan((plan, params, frame) => {
    const { width, height } = frame
    const H = frame.layer ? frame.layer.referenceSize.height * frame.layer.rasterScale : height
    const feather = Math.max(1, number(params, 'feather') / 100 * 0.05 * H)
    plan.pass('crop', 'input', 'output', [number(params, 'left') / 100, number(params, 'top') / 100, 1 - number(params, 'right') / 100, 1 - number(params, 'bottom') / 100], [feather / width, feather / height, 0, 0])
  }) }),
  definePlanner({ id: 'recording_frame', preview: false, plan: passPlan((plan, params, frame, instance) => {
    const { width, height } = frame
    const H = frame.layer ? frame.layer.referenceSize.height * frame.layer.rasterScale : height
    // 内容（片段在画面中的外接矩形，缺省整幅）按边距等比放进画面中央；投影是内容透明度的高斯模糊，背景不透明。
    const [x0, y0, x1, y1] = instance.frameContent ?? [0, 0, 1, 1]
    const pad = number(params, 'padding') / 100 * H; const contentWidth = (x1 - x0) * width; const contentHeight = (y1 - y0) * H
    const fit = contentWidth >= 1 && contentHeight >= 1 ? Math.max(0, Math.min((width - 2 * pad) / contentWidth, (H - 2 * pad) / contentHeight)) : 0
    const placedWidth = contentWidth * fit / width; const placedHeight = contentHeight * fit / H
    const content = plan.alloc()
    plan.pass('recording_frame_content', 'input', content, [0.5 - placedWidth / 2, 0.5 - placedHeight / 2, 0.5 + placedWidth / 2, 0.5 + placedHeight / 2], [x0, y0, x1, y1], undefined, [number(params, 'radius') / 100 * H, fit > 0 ? 1 / fit : 1, 0, 0])
    const strength = number(params, 'shadow') / 100
    let shadow: VideoEditBuiltinTexture = content
    if (strength > 0 && fit > 0) { shadow = plan.alloc(); const sigma = (0.008 + 0.032 * strength) * H; plan.gaussian(content, shadow, sigma, sigma, false) }
    const [from, to] = recordingFrameBackground(params)
    plan.pass('recording_frame_compose', shadow, 'output', [...from, 0.65 * strength], [...to, 0.018 * strength], content, [Math.SQRT1_2, Math.SQRT1_2, 0, 0])
  }) }),
  definePlanner({ id: 'flip', plan: passPlan((plan, params) => {
    plan.pass('flip', 'input', 'output', [params.axis !== 'vertical' ? 1 : 0, params.axis !== 'horizontal' ? 1 : 0, 0, 0])
  }) }),
  definePlanner({ id: 'chroma_key', plan: passPlan((plan, params) => {
    const [r, g, b] = hexColor(String(params.key_color)); const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    plan.pass('chroma_key', 'input', 'output', [(b - y) / 1.8556, (r - y) / 1.5748, 0.02 + number(params, 'tolerance') / 100 * 0.3, 0.002 + number(params, 'softness') / 100 * 0.2], [number(params, 'spill') / 100, 0, 0, 0])
  }) }),
  definePlanner({ id: 'recording_cursor', preview: false, plan: (_params, frame, instance) => planRecordingCursor(instance.cursorDraws ?? [], frame.width, frame.height) }),
  definePlanner({ id: 'recording_zoom', preview: false, plan: (_params, frame, instance) => planRecordingZoom(instance.zoom, frame.width, frame.height) }),
]
