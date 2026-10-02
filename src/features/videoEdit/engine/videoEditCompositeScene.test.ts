import { describe, expect, it } from 'vitest'
import { compileCodeMaterial } from '@/core/videoEdit/codeMaterial/compiler'
import type { CodeColor, CodeMaterialContext, CodeMaterialProgram } from '@/core/videoEdit/codeMaterial/contract'
import { validateCodeMaterialParameters } from '@/core/videoEdit/codeMaterial/parameters'
import { codeMaterialContextForFrame, codeMaterialContextForTransitionFrame } from '@/core/videoEdit/codeMaterialTiming'
import { buildVideoEditCompositePlan } from '@/core/videoEdit/compositing'
import { createVideoEditSequence } from '@/core/videoEdit/document'
import type { VideoEditClip, VideoEditComposition } from '@/core/videoEdit/document'
import { videoEditTransitionWindow } from '@/core/videoEdit/transitions'
import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { renderVideoEditCompositeScene, videoEditCompositeSurfaceKeys } from './videoEditCompositeScene'
import { VideoEditCodePicture } from './videoEditCodeGpu'
import type { VideoEditCodeGpu } from './videoEditCodeGpu'
import type { PreparedVideoEditEffect } from './videoEditCodeSources'
import type { VideoEditGpuCompositor, VideoEditPicture } from './videoEditGpuCompositor'

function clip(id: string, track = 1, patch: Partial<VideoEditClip> = {}): VideoEditClip {
  return { id, itemId: `item-${id}`, name: id, kind: 'image', track, start: 0, duration: 120, sourceInUs: 1e6,
    sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, brightness: 1, volume: 0, text: '', ...patch }
}
function composition(clips: VideoEditClip[]): VideoEditComposition {
  return { ...createVideoEditSequence(), width: 3840, height: 2160, frameRate: { numerator: 60, denominator: 1 }, fps: 60, clips, media: [], items: [], revision: 0 }
}
function plan(id: string, color: CodeColor, owner: VideoEditClip, frame: number, amount = 1, enabled = true, window?: { start: number; end: number }): PreparedVideoEditEffect {
  const program = compileCodeMaterial(`export default {apiVersion:1,name:"${id}",kind:"filter",mode:"dynamic",width:320,height:180,durationSeconds:20,seed:3,parameters:{gain:{type:"number",title:"强度",default:1,min:0,max:1,step:.01}},render(ctx){return rgba(${color.join(',')});}}`)
  const context = window ? codeMaterialContextForTransitionFrame(owner, frame, { numerator: 60, denominator: 1 }, program, window) : codeMaterialContextForFrame(owner, frame, { numerator: 60, denominator: 1 }, program)
  return { effect: { id, name: id, amount, enabled, code: { definitionId: `definition-${id}`, versionId: `version-${id}`, parameters: { gain: .75 } } },
    version: `version-${id}`, program, context, parameters: validateCodeMaterialParameters(program, { gain: .75 }), transitionHandles: Boolean(window) }
}
function expectPixel(actual: CodeColor, expected: CodeColor): void { actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 12)) }
const mix = (left: CodeColor, right: CodeColor, amount: number): CodeColor => left.map((value, index) => value + (right[index] - value) * amount) as CodeColor
const over = (below: CodeColor, above: CodeColor): CodeColor => above.map((value, index) => value + below[index] * (1 - above[3])) as CodeColor

/** Only the GPU/texture boundary is replaced. Inputs are uniform premultiplied fields;
 * the real scene chooses nodes, contexts, destinations and presentation order. */
function pixels(document: VideoEditComposition, reserved: ReadonlySet<string>, options: { onFilter?: () => void; offscreenCompletion?: Promise<void>; declineFinal?: boolean } = {}) {
  const device = {} as GpuDevice
  const data = new WeakMap<GpuTexture, CodeColor>(); const keys = new WeakMap<GpuTexture, string>()
  const targets = new Map<string, VideoEditCodePicture>()
  const formats = new Map<string, string>()
  const filters: Array<{ key: string; version: string; context: CodeMaterialContext; parameters: Readonly<Record<string, unknown>>; transitionHandles: boolean; input: CodeColor; output: CodeColor }> = []
  const mixes: Array<{ key: string; leftKey: string; rightKey: string; amount: number; output: CodeColor }> = []
  const draws: Array<{ target?: string; clips: VideoEditClip[]; inputKeys: string[]; pixel: CodeColor; deadline?: number }> = []
  let canvas: CodeColor = [0, 0, 0, 1]; let commits = 0
  function picture(key: string, value: CodeColor, width = document.width, height = document.height, format: 'rgba8unorm' | 'rgba16float' = 'rgba8unorm'): VideoEditCodePicture {
    const texture: GpuTexture = { createView: () => ({}), destroy: () => {} }
    data.set(texture, [...value]); keys.set(texture, key)
    return new VideoEditCodePicture(texture, width, height, device, format)
  }
  function pixel(picture: VideoEditPicture): CodeColor {
    if (!(picture instanceof VideoEditCodePicture)) throw new Error('测试像素边界只接受明确的预乘RGBA输入')
    const value = data.get(picture.texture)
    if (!value) throw new Error('没有对应输入纹理')
    return [...value]
  }
  function target(key: string, width: number, height: number): VideoEditCodePicture {
    expect(reserved.has(key)).toBe(true)
    expect({ width, height }).toEqual({ width: 3840, height: 2160 })
    if (!targets.has(key)) targets.set(key, picture(key, [0, 0, 0, 0], width, height))
    return targets.get(key)!
  }
  function literalFilter(program: CodeMaterialProgram): CodeColor {
    // A fixed uniform shader output is the pixel fixture, not a second IR interpreter.
    if (program.kind !== 'filter' || program.result.kind !== 'call' || program.result.op !== 'rgba') throw new Error('像素fixture必须是实际编译的常量RGBA滤镜')
    const values = program.result.args.map(argument => {
      if (argument.kind !== 'literal' || typeof argument.value !== 'number') throw new Error('fixture仅替换常量滤镜像素边界')
      return argument.value
    }) as CodeColor
    return [values[0] * values[3], values[1] * values[3], values[2] * values[3], values[3]]
  }
  const runtime: Pick<VideoEditCodeGpu, 'target' | 'filter' | 'mix'> = {
    target: async (key, width, height, format = 'rgba8unorm') => { formats.set(key, format); return target(key, width, height) },
    filter: async (key, version, program, context, parameters, input, transitionHandles = false) => {
      const destination = target(key, input.width, input.height)
      expect(destination.texture).not.toBe(input.texture)
      expect(input.owner).toBe(device)
      expect([context.width, context.height, input.width, input.height]).toEqual([3840, 2160, 3840, 2160])
      const output = literalFilter(program)
      filters.push({ key, version, context, parameters, transitionHandles, input: pixel(input), output })
      data.set(destination.texture, output); options.onFilter?.(); return destination
    },
    mix: async (key, left, right, amount) => {
      const destination = target(key, left.width, left.height)
      expect(destination.texture).not.toBe(left.texture); expect(destination.texture).not.toBe(right.texture)
      expect(left.owner).toBe(device); expect(right.owner).toBe(device)
      const output = mix(pixel(left), pixel(right), amount)
      mixes.push({ key, leftKey: keys.get(left.texture)!, rightKey: keys.get(right.texture)!, amount, output })
      data.set(destination.texture, output); return destination
    },
  }
  const compositor: Pick<VideoEditGpuCompositor, 'code' | 'draw'> = {
    code: async () => runtime as VideoEditCodeGpu,
    draw: async (document, clips, pictures, shouldPresent, deadline, destination) => {
      if (!shouldPresent() || !destination && options.declineFinal) return { presented: false, completion: Promise.resolve() }
      expect([document.width, document.height]).toEqual([3840, 2160])
      if (destination) expect(pictures.every(picture => !(picture instanceof VideoEditCodePicture) || picture.texture !== destination.texture)).toBe(true)
      let output: CodeColor = destination ? [0, 0, 0, 0] : [0, 0, 0, 1]
      clips.forEach((clip, index) => {
        const input = pixel(pictures[index])
        const transformed: CodeColor = [Math.min(input[3], input[0] * clip.brightness) * clip.opacity,
          Math.min(input[3], input[1] * clip.brightness) * clip.opacity, Math.min(input[3], input[2] * clip.brightness) * clip.opacity, input[3] * clip.opacity]
        output = over(output, transformed)
      })
      draws.push({ target: destination ? keys.get(destination.texture) : undefined, clips: structuredClone(clips),
        inputKeys: pictures.map(picture => picture instanceof VideoEditCodePicture ? keys.get(picture.texture)! : ''), pixel: output, deadline })
      if (destination) data.set(destination.texture, output)
      else { canvas = output; commits++ }
      return { presented: true, completion: destination ? options.offscreenCompletion ?? Promise.resolve() : Promise.resolve() }
    },
  }
  return { picture, pixel, targets, formats, filters, mixes, draws, compositor, canvas: () => canvas, commits: () => commits }
}

describe('正式合成场景的预乘RGBA编排与有界目标', () => {
  it('四个不同有效/关闭/零强度效果按原顺序处理，原几何和透明度只归一化一次', async () => {
    const owner = clip('visual', 1, { start: 10, x: .2, y: -.1, scale: .5, rotation: 30, opacity: .5 })
    const effects = [plan('red', [1, 0, 0, .8], owner, 30, .5), plan('disabled', [0, 1, 0, 1], owner, 30, 1, false),
      plan('zero', [0, 0, 1, 1], owner, 30, 0), plan('yellow', [.5, .5, 0, .4], owner, 30, .25)]
    owner.effects = effects.map(plan => plan.effect)
    const document = composition([owner]); const nodes = buildVideoEditCompositePlan(document.clips); const reserved = videoEditCompositeSurfaceKeys(nodes)
    const boundary = pixels(document, reserved); const original = structuredClone(owner)
    const result = await renderVideoEditCompositeScene(document, nodes, new Map([[owner.id, boundary.picture('raw', [.2, .1, 0, .5], 640, 360)]]), new Map([[owner.id, effects]]), boundary.compositor, 30, () => true, 1234)
    await result.completion
    expect(result.presented).toBe(true); expect(boundary.commits()).toBe(1)
    expect(boundary.filters.map(value => value.version)).toEqual(['version-red', 'version-yellow'])
    expectPixel(boundary.filters[0].input, [.1, .05, 0, .25])
    expectPixel(boundary.mixes.at(-1)!.output, [.3875, .06875, 0, .49375])
    expectPixel(boundary.canvas(), [.3875, .06875, 0, 1])
    for (const [index, filtered] of boundary.filters.entries()) {
      const originalPlan = effects[index === 0 ? 0 : 3]
      expect(filtered.context).toEqual({ ...originalPlan.context, width: 3840, height: 2160 })
      expect(filtered.parameters).toEqual({ gain: .75 }); expect(filtered.transitionHandles).toBe(false)
    }
    expect(boundary.draws[0].clips[0]).toEqual(original)
    expect(boundary.draws.at(-1)!.clips[0]).toMatchObject({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, brightness: 1 })
    expect(boundary.draws[0].deadline).toBeUndefined(); expect(boundary.draws.at(-1)!.deadline).toBe(1234)
    expect(owner).toEqual(original); expect(reserved.size).toBe(3); expect(boundary.targets.size).toBe(3)
  })
  it('四个有效效果轮用三个目标，不保留额外历史纹理或读写别名', async () => {
    const owner = clip('ordinary')
    const effects = [[1, 0, 0, .5], [0, .5, 0, .5], [0, 0, 1, .75], [1, 1, 1, .25]].map((color, index) => plan(`effect-${index}`, color as CodeColor, owner, 20, .5))
    owner.effects = effects.map(plan => plan.effect)
    const document = composition([owner]); const nodes = buildVideoEditCompositePlan([owner]); const reserved = videoEditCompositeSurfaceKeys(nodes)
    const boundary = pixels(document, reserved)
    const result = await renderVideoEditCompositeScene(document, nodes, new Map([[owner.id, boundary.picture('original', [.2, .1, .05, .5])]]), new Map([[owner.id, effects]]), boundary.compositor, 20, () => true)
    await result.completion
    expect(boundary.filters.map(value => value.version)).toEqual(effects.map(plan => plan.version))
    expect(boundary.mixes).toHaveLength(4); expect(reserved.size).toBe(3); expect(boundary.targets.size).toBe(3)
    expectPixel(boundary.mixes.at(-1)!.output, [.16875, .1625, .315625, .4375])
    expectPixel(boundary.canvas(), [.16875, .1625, .315625, 1])
    expect(boundary.draws).toHaveLength(2); expect(boundary.commits()).toBe(1)
  })
  it('调整层四分之一强度用四个目标保留原band，只末尾一次混合并替换原图', async () => {
    const base = clip('base', 1); const band = clip('band', 4, { kind: 'adjustment', adjustment: { fromTrack: 1 }, opacity: .25 })
    const effects = [[1, 0, 0, .5], [0, .5, 0, .5], [0, 0, 1, .75], [1, 1, 1, .25]].map((color, index) => plan(`band-${index}`, color as CodeColor, band, 20, .5))
    band.effects = effects.map(plan => plan.effect)
    const document = composition([base, band]); const nodes = buildVideoEditCompositePlan(document.clips); const reserved = videoEditCompositeSurfaceKeys(nodes)
    const boundary = pixels(document, reserved)
    const result = await renderVideoEditCompositeScene(document, nodes, new Map([[base.id, boundary.picture('base-picture', [.2, .1, .05, .5])]]), new Map([[band.id, effects]]), boundary.compositor, 20, () => true)
    await result.completion
    expect(reserved.size).toBe(4); expect(boundary.targets.size).toBe(4)
    expect(boundary.mixes.map(value => value.amount)).toEqual([.5, .5, .5, .5, .25])
    expect(boundary.mixes.at(-1)!.leftKey).toBe('composite:clip:band:0')
    expectPixel(boundary.pixel(boundary.targets.get('composite:clip:band:0')!), [.2, .1, .05, .5])
    expectPixel(boundary.mixes.at(-1)!.output, [.1921875, .115625, .11640625, .484375])
    expectPixel(boundary.canvas(), [.1921875, .115625, .11640625, 1])
    expect(boundary.draws.at(-1)!.clips.map(value => value.id)).toEqual(['band'])
    expect(boundary.draws.at(-1)!.clips[0].opacity).toBe(1)
    expect(boundary.commits()).toBe(1)
  })
  it('交叉溶解先处理两端原几何/opacity，再一次预乘mix；字幕及其他轨道留在外层', async () => {
    const lower = clip('lower', 0); const left = clip('left', 2, { duration: 60, opacity: .5, x: -.2, scale: .8, rotation: -10 })
    const right = clip('right', 2, { start: 60, duration: 60, opacity: .25, x: .2, scale: .6, rotation: 20 })
    const caption = clip('caption', 31, { kind: 'text', text: '真实字幕' })
    const document = composition([lower, left, right, caption])
    const window = videoEditTransitionWindow(document, { id: 'dissolve', kind: 'cross_dissolve', leftClipId: left.id, rightClipId: right.id, durationFrames: 5 })
    const nodes = buildVideoEditCompositePlan(document.clips, [window]); const reserved = videoEditCompositeSurfaceKeys(nodes)
    const boundary = pixels(document, reserved)
    const pictures = new Map([[lower.id, boundary.picture('lower-raw', [0, .2, 0, .4])], [left.id, boundary.picture('left-raw', [1, 0, 0, 1])],
      [right.id, boundary.picture('right-raw', [0, 0, 1, 1])], [caption.id, boundary.picture('caption-raw', [0, .1, 0, .2])]])
    const result = await renderVideoEditCompositeScene(document, nodes, pictures, new Map(), boundary.compositor, 60, () => true)
    await result.completion
    expect(boundary.mixes).toHaveLength(1); expect(boundary.mixes[0].amount).toBe(.5)
    expectPixel(boundary.mixes[0].output, [.25, 0, .125, .375]); expectPixel(boundary.canvas(), [.2, .2, .1, 1])
    expect(boundary.draws.filter(value => value.target).map(value => value.clips)).toEqual([[left], [right]])
    expect(boundary.draws.at(-1)!.clips.map(value => value.id)).toEqual(['lower', 'left', 'caption'])
    expect(boundary.draws.at(-1)!.inputKeys).toEqual(['lower-raw', 'composite:transition:dissolve', 'caption-raw'])
    expect(reserved.size).toBe(3); expect(boundary.commits()).toBe(1)
  })
  it('转场外延滤镜保留原源时钟、负localTime和transitionHandles，仅替换全序列尺寸', async () => {
    const left = clip('left', 1, { duration: 60 }); const right = clip('right', 1, { start: 60, duration: 60 })
    const document = composition([left, right]); const window = videoEditTransitionWindow(document, { id: 'dissolve', kind: 'cross_dissolve', leftClipId: left.id, rightClipId: right.id, durationFrames: 5 })
    const rightEffect = plan('right-filter', [0, 0, 1, .5], right, 59, 1, true, window); right.effects = [rightEffect.effect]
    const nodes = buildVideoEditCompositePlan(document.clips, [window]); const reserved = videoEditCompositeSurfaceKeys(nodes); const boundary = pixels(document, reserved)
    const result = await renderVideoEditCompositeScene(document, nodes, new Map([[left.id, boundary.picture('left-original', [1, 0, 0, 1])], [right.id, boundary.picture('right-original', [0, 1, 0, 1])]]), new Map([[right.id, [rightEffect]]]), boundary.compositor, 59, () => true)
    await result.completion
    expect(boundary.filters).toHaveLength(1)
    expect(boundary.filters[0]).toMatchObject({ transitionHandles: true, context: { ...rightEffect.context, width: 3840, height: 2160 }, parameters: { gain: .75 } })
    expect(boundary.filters[0].context.localTime).toBe(-1 / 60)
    expect(boundary.filters[0].context.time).toBeCloseTo(1 - 1 / 60, 12)
    expectPixel(boundary.mixes[0].output, [.75, 0, .125, .875]); expectPixel(boundary.canvas(), [.75, 0, .125, 1])
    expect(reserved.size).toBe(5); expect(boundary.commits()).toBe(1)
  })
  it('取消发生在离屏/filter之后时拒绝最终canvas提交，初始取消不分配任何目标', async () => {
    for (const initial of [false, true]) {
      const owner = clip('cancel'); const effect = plan('red', [1, 0, 0, 1], owner, 20); owner.effects = [effect.effect]
      const document = composition([owner]); const nodes = buildVideoEditCompositePlan(document.clips); let active = initial
      const boundary = pixels(document, videoEditCompositeSurfaceKeys(nodes), { onFilter: () => { active = false } })
      await expect(renderVideoEditCompositeScene(document, nodes, new Map([[owner.id, boundary.picture('original', [.2, 0, 0, .5])]]), new Map([[owner.id, [effect]]]), boundary.compositor, 20, () => active)).rejects.toMatchObject({ name: 'AbortError' })
      expect(boundary.commits()).toBe(0)
      expect(boundary.draws.every(value => value.target)).toBe(true)
      if (!initial) expect(boundary.targets.size).toBe(0)
    }
  })
  it('最终呈现边界拒绝旧画面时返回presented:false，不提交canvas', async () => {
    const owner = clip('final-cancel'); const document = composition([owner]); const nodes = buildVideoEditCompositePlan(document.clips)
    const boundary = pixels(document, videoEditCompositeSurfaceKeys(nodes), { declineFinal: true })
    const result = await renderVideoEditCompositeScene(document, nodes, new Map([[owner.id, boundary.picture('original', [1, 0, 0, 1])]]), new Map(), boundary.compositor, 20, () => true)
    await result.completion
    expect(result.presented).toBe(false); expect(boundary.commits()).toBe(0)
  })
  it('离屏GPU completion失败通过返回completion传播，不被成功的最终提交掩盖', async () => {
    const owner = clip('completion'); const effect = plan('red', [1, 0, 0, 1], owner, 20); owner.effects = [effect.effect]
    const document = composition([owner]); const nodes = buildVideoEditCompositePlan(document.clips)
    let reject!: (error: Error) => void
    const offscreenCompletion = new Promise<void>((_resolve, rejectPromise) => { reject = rejectPromise })
    const boundary = pixels(document, videoEditCompositeSurfaceKeys(nodes), { offscreenCompletion })
    const result = await renderVideoEditCompositeScene(document, nodes, new Map([[owner.id, boundary.picture('original', [.2, 0, 0, .5])]]), new Map([[owner.id, [effect]]]), boundary.compositor, 20, () => true)
    expect(result.presented).toBe(true); expect(boundary.commits()).toBe(1)
    const failure = new Error('离屏提交失败'); const rejection = expect(result.completion).rejects.toBe(failure)
    reject(failure); await rejection
  })
  it('高精度画面的转场端点归一化到 rgba16float 目标，八位端点目标格式不变', async () => {
    const left = clip('left', 2, { duration: 60 }); const right = clip('right', 2, { start: 60, duration: 60 })
    const document = composition([left, right])
    const window = videoEditTransitionWindow(document, { id: 'dissolve', kind: 'cross_dissolve', leftClipId: left.id, rightClipId: right.id, durationFrames: 5 })
    const nodes = buildVideoEditCompositePlan(document.clips, [window]); const boundary = pixels(document, videoEditCompositeSurfaceKeys(nodes))
    const pictures = new Map([[left.id, boundary.picture('ten-bit', [1, 0, 0, 1], 3840, 2160, 'rgba16float')], [right.id, boundary.picture('eight-bit', [0, 0, 1, 1])]])
    await (await renderVideoEditCompositeScene(document, nodes, pictures, new Map(), boundary.compositor, 60, () => true)).completion
    expect(boundary.formats.get('composite:clip:left:0')).toBe('rgba16float'); expect(boundary.formats.get('composite:clip:right:0')).toBe('rgba8unorm')
    expectPixel(boundary.canvas(), [.5, 0, .5, 1])
  })
})
