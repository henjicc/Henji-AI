import { describe, expect, it } from 'vitest'
import { buildVideoEditCompositePlan, validateVideoEditAdjustmentRanges, videoEditAdjustmentSchema, videoEditEffectSchema } from './compositing'
import type { VideoEditCompositeNode } from './compositing'
import { videoEditClipSchema } from './document'
import type { VideoEditClip } from './document'
import { videoEditTransitionWindow } from './transitions'

function clip(id: string, track: number, patch: Partial<VideoEditClip> = {}): VideoEditClip {
  return { id, itemId: `item-${id}`, name: id, kind: 'image', track, start: 0, duration: 120, sourceInUs: 0,
    sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 0, brightness: 1, text: '', ...patch }
}
const adjustment = (id: string, ownTrack: number, fromTrack: number, patch: Partial<VideoEditClip> = {}): VideoEditClip => clip(id, ownTrack, { kind: 'adjustment', adjustment: { fromTrack }, ...patch })
function shape(nodes: readonly VideoEditCompositeNode[]): unknown[] {
  return nodes.map(node => ({ kind: node.kind, id: node.kind === 'transition' ? node.window.transition.id : node.clip.id, range: [node.fromTrack, node.toTrack],
    ...(node.kind === 'adjustment' ? { children: shape(node.children) } : {}) }))
}
function leaves(nodes: readonly VideoEditCompositeNode[]): string[] {
  return nodes.flatMap(node => node.kind === 'adjustment' ? leaves(node.children) : node.kind === 'transition' ? [node.window.left.id, node.window.right.id] : [node.clip.id])
}

describe('调整图层的半开合成范围与唯一转场节点', () => {
  it('只替换指定下方画面范围，自身轨道、其他画面和声音不误纳入', () => {
    const clips = [clip('above', 5), clip('same-track', 4), clip('low', 0), clip('inside-high', 3),
      clip('audio', 2, { kind: 'audio', volume: 1 }), adjustment('band', 4, 1), clip('inside-low', 1)]
    const before = structuredClone(clips)
    validateVideoEditAdjustmentRanges({ clips })
    expect(shape(buildVideoEditCompositePlan(clips))).toEqual([
      { kind: 'clip', id: 'low', range: [0, 1] },
      { kind: 'adjustment', id: 'band', range: [1, 4], children: [
        { kind: 'clip', id: 'inside-low', range: [1, 2] }, { kind: 'clip', id: 'inside-high', range: [3, 4] },
      ] },
      { kind: 'clip', id: 'same-track', range: [4, 5] }, { kind: 'clip', id: 'above', range: [5, 6] },
    ])
    expect(clips).toEqual(before)
    expect(buildVideoEditCompositePlan([clip('audio-only', 0, { kind: 'audio' })])).toEqual([])
  })
  it('同轨外层在原数组前仍先处理内层，保留每个原图一次', () => {
    const clips = [adjustment('outer', 5, 0), clip('low', 0), adjustment('inner', 5, 2), clip('middle', 1), clip('high', 3), clip('inner-low', 2)]
    validateVideoEditAdjustmentRanges({ clips })
    const plan = buildVideoEditCompositePlan(clips)
    expect(shape(plan)).toEqual([{ kind: 'adjustment', id: 'outer', range: [0, 5], children: [
      { kind: 'clip', id: 'low', range: [0, 1] }, { kind: 'clip', id: 'middle', range: [1, 2] },
      { kind: 'adjustment', id: 'inner', range: [2, 5], children: [
        { kind: 'clip', id: 'inner-low', range: [2, 3] }, { kind: 'clip', id: 'high', range: [3, 4] },
      ] },
    ] }])
    expect(leaves(plan)).toEqual(['low', 'middle', 'inner-low', 'high'])
    expect(clips.map(value => value.id)).toEqual(['outer', 'low', 'inner', 'middle', 'high', 'inner-low'])
  })
  it('相同范围保持原数组的效果应用顺序，不按标识重排', () => {
    const first = adjustment('z-first', 4, 0); const second = adjustment('a-second', 4, 0)
    const clips = [first, clip('base', 0), second]
    validateVideoEditAdjustmentRanges({ clips })
    expect(shape(buildVideoEditCompositePlan(clips))).toEqual([{ kind: 'adjustment', id: 'a-second', range: [0, 4], children: [
      { kind: 'adjustment', id: 'z-first', range: [0, 4], children: [{ kind: 'clip', id: 'base', range: [0, 1] }] },
    ] }])
    expect(shape(buildVideoEditCompositePlan([second, clips[1], first]))).toEqual([{ kind: 'adjustment', id: 'z-first', range: [0, 4], children: [
      { kind: 'adjustment', id: 'a-second', range: [0, 4], children: [{ kind: 'clip', id: 'base', range: [0, 1] }] },
    ] }])
  })
  it('较早调整层ownTrack正好等于下一个fromTrack时保持独立，不按节点片段track误选', () => {
    const clips = [adjustment('second-band', 4, 2), clip('base', 0), adjustment('first-band', 2, 0), clip('boundary-picture', 2), clip('upper-picture', 3)]
    validateVideoEditAdjustmentRanges({ clips })
    expect(shape(buildVideoEditCompositePlan(clips))).toEqual([
      { kind: 'adjustment', id: 'first-band', range: [0, 2], children: [{ kind: 'clip', id: 'base', range: [0, 1] }] },
      { kind: 'adjustment', id: 'second-band', range: [2, 4], children: [
        { kind: 'clip', id: 'boundary-picture', range: [2, 3] }, { kind: 'clip', id: 'upper-picture', range: [3, 4] },
      ] },
    ])
  })
  it('空间交叉仅在时间半开范围重叠时拒绝，嵌套及独立范围允许', () => {
    const first = adjustment('first', 3, 0, { start: 0, duration: 100 })
    const crossing = adjustment('crossing', 5, 2, { start: 99, duration: 20 })
    expect(() => validateVideoEditAdjustmentRanges({ clips: [first, crossing] })).toThrow('交叉')
    expect(() => validateVideoEditAdjustmentRanges({ clips: [crossing, first] })).toThrow('交叉')
    expect(() => validateVideoEditAdjustmentRanges({ clips: [first, { ...crossing, start: 100 }] })).not.toThrow()
    expect(() => validateVideoEditAdjustmentRanges({ clips: [{ ...first, start: 20, duration: 100 }, { ...crossing, start: 0, duration: 20 }] })).not.toThrow()
    expect(() => validateVideoEditAdjustmentRanges({ clips: [first, adjustment('outer', 5, 0), adjustment('adjacent', 6, 5)] })).not.toThrow()
  })
  it('拒绝调整层非法几何、缺失范围和自身/上方范围，opacity仍为正式可调属性', () => {
    const base = adjustment('band', 4, 0)
    for (const patch of [{ x: .1 }, { y: .1 }, { scale: .5 }, { rotation: 10 }, { brightness: .5 }, { volume: 1 }, { text: '文字' }]) {
      expect(() => validateVideoEditAdjustmentRanges({ clips: [{ ...base, ...patch }] })).toThrow('作用范围')
    }
    const missing = { ...base }; delete missing.adjustment
    expect(() => validateVideoEditAdjustmentRanges({ clips: [missing] })).toThrow('下方')
    for (const fromTrack of [4, 5]) expect(() => validateVideoEditAdjustmentRanges({ clips: [adjustment('bad', 4, fromTrack)] })).toThrow('下方')
    expect(() => validateVideoEditAdjustmentRanges({ clips: [{ ...base, opacity: .25 }] })).not.toThrow()
    for (const value of [{ fromTrack: -1 }, { fromTrack: 31 }, { fromTrack: .5 }, { fromTrack: NaN }, { fromTrack: 0, extra: 1 }]) expect(videoEditAdjustmentSchema.safeParse(value).success).toBe(false)
  })
  it('构建器拒绝把已处理band局部拆给后续调整层，完整包含可以继续合成', () => {
    const first = adjustment('already-processed', 3, 0)
    const clips = [clip('low', 0), clip('middle', 2), first, adjustment('partial', 5, 2)]
    expect(() => buildVideoEditCompositePlan(clips)).toThrow('拆分')
    expect(() => buildVideoEditCompositePlan([...clips].reverse())).toThrow('拆分')
    const complete = buildVideoEditCompositePlan([clip('low', 0), clip('middle', 2), first, adjustment('complete', 5, 0)])
    expect(shape(complete)).toEqual([{ kind: 'adjustment', id: 'complete', range: [0, 5], children: [
      { kind: 'adjustment', id: 'already-processed', range: [0, 3], children: [
        { kind: 'clip', id: 'low', range: [0, 1] }, { kind: 'clip', id: 'middle', range: [2, 3] },
      ] },
    ] }])
  })
  it('真实转场窗口合并两端为一个节点，在下方调整层中不重复绘制任何端点', () => {
    const left = clip('left', 2, { start: 0, duration: 60 }); const right = clip('right', 2, { start: 60, duration: 60 })
    const window = videoEditTransitionWindow({ clips: [left, right] }, { id: 'dissolve', kind: 'cross_dissolve', leftClipId: left.id, rightClipId: right.id, durationFrames: 5 })
    expect({ start: window.start, end: window.end, cut: window.cut }).toEqual({ start: 58, end: 63, cut: 60 })
    // Either endpoint may be outside its ordinary clip interval at the requested frame.
    for (const visibleEndpoints of [[left, right], [left], [right], []]) {
      const plan = buildVideoEditCompositePlan([clip('lower', 0), ...visibleEndpoints, adjustment('band', 3, 2)], [window])
      expect(shape(plan)).toEqual([
        { kind: 'clip', id: 'lower', range: [0, 1] },
        { kind: 'adjustment', id: 'band', range: [2, 3], children: [{ kind: 'transition', id: 'dissolve', range: [2, 3] }] },
      ])
      expect(leaves(plan)).toEqual(['lower', 'left', 'right'])
      expect(plan[1].kind === 'adjustment' && plan[1].children[0].kind === 'transition' && plan[1].children[0].window).toBe(window)
    }
  })
})

describe('附加效果的封闭持久边界', () => {
  it('只接受有界强度与固定代码实例，并在片段中限制为四项', () => {
    const effect = { id: 'effect', name: '颜色调整', enabled: true, amount: .5, code: { definitionId: 'definition', versionId: 'version', parameters: { gain: .5 } } }
    expect(videoEditEffectSchema.parse(effect)).toEqual(effect)
    for (const amount of [0, 1]) expect(videoEditEffectSchema.safeParse({ ...effect, enabled: false, amount }).success).toBe(true)
    for (const patch of [{ id: '' }, { name: '  ' }, { amount: -.01 }, { amount: 1.01 }, { amount: NaN }, { amount: Infinity }, { enabled: 'true' }, { extra: 1 },
      { code: { ...effect.code, versionId: null } }, { code: { ...effect.code, source: '任意源码' } }, { code: { ...effect.code, parameters: { gain: NaN } } }]) {
      expect(videoEditEffectSchema.safeParse({ ...effect, ...patch }).success).toBe(false)
    }
    const effects = Array.from({ length: 4 }, (_, index) => ({ ...effect, id: `effect-${index}` }))
    expect(videoEditClipSchema.safeParse(clip('visual', 1, { effects })).success).toBe(true)
    expect(videoEditClipSchema.safeParse(clip('visual', 1, { effects: [...effects, { ...effect, id: 'fifth' }] })).success).toBe(false)
  })
})
