import { describe, expect, it } from 'vitest'
import { createVideoEditDocument, changeVideoEditSequenceSettings, videoEditDocumentSchema, type VideoEditDocument } from './document'
import { makeVideoEditItemClip } from './projectItems'
import { applyVideoEditTimelineEdit, copyVideoEditClips } from './timelineEdits'
import { applyVideoEditTransitionPairs, dragVideoEditTransition, validateVideoEditTransitions, videoEditAudioTransitionClipGain, videoEditAudioTransitionGains, videoEditTransitionFit, videoEditTransitionMix, videoEditDefaultTransitionPairs, videoEditHandleFrame, videoEditTransitionAlignmentFields, videoEditTransitionDipColor, videoEditTransitionWindow, videoEditTransitionsAt, videoEditTransitionAmount } from './transitions'
import { reconcileVideoEditTimedContent } from './timedContent'
import { assertVideoEditLockedTracks } from './lockedTracks'
import { compileCodeMaterial } from './codeMaterial/compiler'
import { validateCodeMaterialDocument, videoEditCodeReferences } from './codeMaterialDocument'
import { codeMaterialContextForTransitionFrame } from './codeMaterialTiming'
import { prepareCodeMaterialParameters, evaluateCodeMaterialParameters } from './codeMaterialAnimation'
import { offsetVideoEditSource } from './time'

function fixture() {
  const document = createVideoEditDocument('转场剪辑'); const sequence = document.sequences[0]
  sequence.frameRate = { numerator: 60, denominator: 1 }
  document.media = [{ id: 'media', name: '原路径', kind: 'video', path: 'D:/original.mp4', durationSeconds: 10, width: 3840, height: 2160, hasAudio: true }]
  document.items = [{ id: 'item', name: '视频', kind: 'video', mediaId: 'media' }]
  const clip = makeVideoEditItemClip(document, 'item', sequence.id, { frame: 30, track: 1, duration: 60 })
  sequence.clips = [{ ...clip, id: 'left', sourceInUs: 1_000_000 }, { ...clip, id: 'right', start: 90, sourceInUs: 1_000_000 }]
  sequence.transitions = [{ id: 'dissolve', kind: 'cross_dissolve', leftClipId: 'left', rightClipId: 'right', durationFrames: 30 }]
  return { document, sequence }
}
const source = (kind: 'generator' | 'filter', mode = 'dynamic', duration = 10): string => `export default {apiVersion:1,name:"时间验证",kind:"${kind}",mode:"${mode}",width:3840,height:2160,durationSeconds:${duration},seed:0,parameters:{amount:{type:"number",title:"强度",default:.5,min:0,max:1,step:.01,animatable:true}},render(ctx){return ${kind === 'generator' ? '[rect({x:0,y:0,width:100,height:100,fill:[1,0,0,ctx.params.amount]})]' : 'sample(ctx.u,ctx.v)'};}}`
function addEffect(document: VideoEditDocument, mode = 'static', duration = 10) {
  const text = source('filter', mode, duration); const program = compileCodeMaterial(text)
  document.codeMaterials = [{ id: 'filter', name: '滤镜', defaultVersionId: 'filter-version', versions: [{ id: 'filter-version', source: text, apiVersion: 1, languageVersion: 1 }] }]
  document.sequences[0].clips[0].effects = [{ id: 'effect', name: '效果', enabled: true, amount: .5, code: { definitionId: 'filter', versionId: 'filter-version', parameters: { amount: .4 } } }]
  return program
}

describe('真实转场窗口、源余量和编辑持久契约', () => {
  it('偶数/奇数半开窗口以原切点居中，端点预乘混合强度完整到0/1', () => {
    const { sequence } = fixture(); const transition = sequence.transitions![0]
    for (const durationFrames of [2, 5, 30]) {
      transition.durationFrames = durationFrames
      const window = videoEditTransitionWindow(sequence, transition)
      expect(window).toMatchObject({ cut: 90, start: 90 - Math.floor(durationFrames / 2), end: 90 + Math.ceil(durationFrames / 2) })
      expect(videoEditTransitionAmount(window, window.start)).toBe(0)
      expect(videoEditTransitionAmount(window, window.end - 1)).toBe(1)
      expect(videoEditTransitionsAt(sequence, window.start - 1)).toEqual([])
      expect(videoEditTransitionsAt(sequence, window.end)).toEqual([])
      expect(videoEditTransitionsAt(sequence, window.end - 1)).toHaveLength(1)
      expect(() => videoEditTransitionAmount(window, window.end)).toThrow('半开')
    }
    expect(sequence.clips.map(clip => [clip.start, clip.sourceInUs])).toEqual([[30, 1_000_000], [90, 1_000_000]])
  })
  it('视频素材余量不足时按 PR 重复首尾帧而不是拒绝（4.3）', () => {
    const { document, sequence } = fixture(); sequence.frameRate = { numerator: 60000, denominator: 1001 }
    document.media[0].durationSeconds = 1 + 75 * 1001 / 60000
    sequence.clips[1].sourceInUs = 0
    expect(() => validateVideoEditTransitions(document)).not.toThrow()
    const fps = 60000 / 1001; const [left, right] = sequence.clips
    // 右片段从源开头开始：切点前的帧都停在它的第一帧
    expect(videoEditHandleFrame(right, 75, fps, document.media[0].durationSeconds)).toBe(right.start)
    expect(videoEditHandleFrame(right, 95, fps, document.media[0].durationSeconds)).toBe(95)
    // 左片段越过源结尾的部分停在源的最后一帧（至少是自己的最后一帧）
    const last = videoEditHandleFrame(left, 200, fps, document.media[0].durationSeconds)
    expect(last).toBeGreaterThanOrEqual(left.start + left.duration - 1)
    expect(last).toBeLessThan(200)
  })
  it('对齐决定窗口：起点切点整段在切点后，终点切点整段在切点前，自定义起点按切点前帧数', () => {
    const { sequence } = fixture(); const transition = sequence.transitions![0]
    expect(videoEditTransitionWindow(sequence, { ...transition, alignment: 'start' })).toMatchObject({ start: 90, end: 120 })
    expect(videoEditTransitionWindow(sequence, { ...transition, alignment: 'end' })).toMatchObject({ start: 60, end: 90 })
    expect(videoEditTransitionWindow(sequence, { ...transition, alignment: 'custom', framesBeforeCut: 10 })).toMatchObject({ start: 80, end: 110 })
    expect(videoEditTransitionAlignmentFields(30, 15)).toEqual({})
    expect(videoEditTransitionAlignmentFields(30, 0)).toEqual({ alignment: 'start' })
    expect(videoEditTransitionAlignmentFields(30, 30)).toEqual({ alignment: 'end' })
    expect(videoEditTransitionAlignmentFields(30, 7)).toEqual({ alignment: 'custom', framesBeforeCut: 7 })
  })
  it('拖过渡块：左缘改起点、右缘改终点、中间平移，夹在片段内且总跨着切点', () => {
    const { sequence } = fixture()
    const left = dragVideoEditTransition(sequence, 'dissolve', 'in', -10)
    expect(videoEditTransitionWindow(sequence, left)).toMatchObject({ start: 65, end: 105 })
    expect(left).toMatchObject({ durationFrames: 40, alignment: 'custom', framesBeforeCut: 25 })
    const right = dragVideoEditTransition(sequence, 'dissolve', 'out', 1000)
    expect(videoEditTransitionWindow(sequence, right)).toMatchObject({ start: 75, end: 150 })
    expect(dragVideoEditTransition(sequence, 'dissolve', 'in', 50)).toMatchObject({ durationFrames: 15, alignment: 'start' })
    const moved = dragVideoEditTransition(sequence, 'dissolve', 'move', -100)
    expect(moved).toMatchObject({ durationFrames: 30, alignment: 'end' })
    expect(videoEditTransitionWindow(sequence, moved)).toMatchObject({ start: 60, end: 90 })
    expect(dragVideoEditTransition(sequence, 'dissolve', 'move', 0)).not.toHaveProperty('alignment')
  })
  it('默认过渡：Ctrl+D 取目标轨道离播放头最近的编辑点，Shift+D 取所选片段两端，放不下时缩短并给相邻过渡让位', () => {
    const { sequence } = fixture(); sequence.transitions = []
    sequence.clips.push({ ...sequence.clips[1], id: 'third', start: 150, duration: 20 })
    expect(videoEditDefaultTransitionPairs(sequence, { mode: 'playhead', medium: 'video', frame: 140, tracks: [1] })).toEqual([{ leftClipId: 'right', rightClipId: 'third', medium: 'video' }])
    expect(videoEditDefaultTransitionPairs(sequence, { mode: 'playhead', medium: 'audio', frame: 140, tracks: [] })).toEqual([])
    const pairs = videoEditDefaultTransitionPairs(sequence, { mode: 'selection', clipIds: ['right'] })
    expect(pairs.map(pair => pair.rightClipId)).toEqual(['right', 'third'])
    const { sequence: applied, transitionIds } = applyVideoEditTransitionPairs(sequence, pairs, { durationFrames: 60 })
    expect(transitionIds).toHaveLength(2)
    const windows = applied.transitions!.map(transition => videoEditTransitionWindow(applied, transition))
    // 第一处 60 帧居中；第二处的右片段只有 20 帧，缩到 40 帧，且不与第一处重叠
    expect(windows.map(window => [window.start, window.end])).toEqual([[60, 120], [130, 170]])
    expect(applied.transitions!.every(transition => transition.kind === 'cross_dissolve')).toBe(true)
    // 再次应用即替换同一编辑点上的过渡
    const again = applyVideoEditTransitionPairs(applied, [pairs[0]], { durationFrames: 10, kind: () => 'dip_to_black' })
    expect(again.sequence.transitions).toHaveLength(2)
    expect(again.sequence.transitions![0]).toMatchObject({ id: transitionIds[0], kind: 'dip_to_black', durationFrames: 10 })
    expect(() => applyVideoEditTransitionPairs(sequence, [], { durationFrames: 30 })).toThrow('编辑点')
  })
  it('音频过渡挂在声音片段上，增益曲线恒定功率与恒定增益；黑场／白场经过纯色', () => {
    const { document, sequence } = fixture()
    document.items.push({ id: 'sound', name: '声音', kind: 'audio', mediaId: 'media' })
    sequence.clips.forEach(clip => { clip.kind = 'audio'; clip.track = 0; clip.itemId = 'sound' })
    expect(() => videoEditTransitionWindow(sequence, sequence.transitions![0])).toThrow('紧邻')
    sequence.transitions![0].kind = 'constant_power'
    expect(videoEditTransitionWindow(sequence, sequence.transitions![0])).toMatchObject({ start: 75, end: 105 })
    expect(videoEditTransitionsAt(sequence, 90)).toEqual([])
    expect(videoEditTransitionsAt(sequence, 90, 'audio')).toHaveLength(1)
    const [outgoing, incoming] = videoEditAudioTransitionGains('constant_power', .5)
    expect(outgoing ** 2 + incoming ** 2).toBeCloseTo(1)
    expect(videoEditAudioTransitionGains('constant_gain', .25)).toEqual([.75, .25])
    expect(videoEditTransitionDipColor('dip_to_white')).toEqual([1, 1, 1, 1])
    expect(videoEditTransitionDipColor('cross_dissolve')).toBeUndefined()
  })
  it('邻接、第三片段、同轨转场重叠与短片段均明确拒绝', () => {
    const { document, sequence } = fixture()
    sequence.clips[1].start++
    expect(() => validateVideoEditTransitions(document)).toThrow('紧邻'); sequence.clips[1].start--
    sequence.clips.push({ ...sequence.clips[0], id: 'third', start: 80, duration: 5 })
    expect(() => validateVideoEditTransitions(document)).toThrow('其他片段'); sequence.clips.pop()
    sequence.transitions!.push({ ...sequence.transitions![0], id: 'second' })
    expect(() => validateVideoEditTransitions(document)).toThrow('重叠'); sequence.transitions!.pop()
    sequence.transitions![0].durationFrames = 122
    expect(() => validateVideoEditTransitions(document)).toThrow('窗口超出')
  })
  it('动态生成器及附加滤镜都检查真实余量，静态负源曲线保持首点而不改原局部时钟', () => {
    const { document, sequence } = fixture(); const program = addEffect(document, 'dynamic', 2.24)
    expect(() => validateCodeMaterialDocument(document, () => program)).toThrow('余量不足')
    const text = source('generator', 'dynamic', 2.24); const generator = compileCodeMaterial(text)
    document.codeMaterials = [{ id: 'generator', name: '生成器', defaultVersionId: 'generator-version', versions: [{ id: 'generator-version', source: text, apiVersion: 1, languageVersion: 1 }] }]
    document.items = [{ id: 'item', name: '代码', kind: 'code', code: { definitionId: 'generator', versionId: 'generator-version', parameters: {} } }]
    sequence.clips.forEach(clip => { clip.kind = 'code'; clip.code = structuredClone(document.items[0].code); delete clip.effects })
    expect(() => validateCodeMaterialDocument(document, () => generator)).toThrow('余量不足')
    const staticProgram = compileCodeMaterial(source('generator', 'static'))
    const right = { ...sequence.clips[1], sourceInUs: 0 }
    const window = videoEditTransitionWindow(sequence, sequence.transitions![0])
    const instance = { parameters: {}, curves: { amount: [{ id: 'first', sourceInUs: 500000, sourceRemainder: { numerator: 0, denominator: 1 }, value: .2, interpolation: 'linear' as const }, { id: 'last', sourceInUs: 1_000_000, sourceRemainder: { numerator: 0, denominator: 1 }, value: .8, interpolation: 'linear' as const }] } }
    const prepared = prepareCodeMaterialParameters(staticProgram, instance)
    for (const frame of [75, 89, 90, 104]) {
      const context = codeMaterialContextForTransitionFrame(right, frame, sequence.frameRate, staticProgram, window)
      expect(context.localTime).toBe((frame - 90) / 60)
      expect(context.time).toBe(Math.max(0, (frame - 90) / 60))
      expect(evaluateCodeMaterialParameters(prepared, offsetVideoEditSource(right, frame - 90, sequence.frameRate, true)).amount).toBe(.2)
    }
  })
  it('拆分保留切点引用，双端移动保留，单端移开后过渡留在被移动片段一端（4.4）', () => {
    const { document, sequence } = fixture(); addEffect(document)
    const split = applyVideoEditTimelineEdit(document, sequence.id, { kind: 'split', clipIds: ['left'], frame: 60 })
    const outgoing = split.clips.find(clip => clip.start === 60)!
    expect(split.transitions![0].leftClipId).toBe(outgoing.id)
    expect(outgoing.effects![0].id).not.toBe(split.clips[0].effects![0].id)
    const moved = applyVideoEditTimelineEdit(document, sequence.id, { kind: 'adjust', clipIds: ['left', 'right'], mode: 'move', delta: 10 })
    expect(videoEditTransitionWindow(moved, moved.transitions![0]).cut).toBe(100)
    const before = JSON.stringify(document)
    // 右片段移开：过渡成为右片段入点的单侧过渡，保持时长、去掉对齐
    const right = applyVideoEditTimelineEdit(document, sequence.id, { kind: 'adjust', clipIds: ['right'], mode: 'move', delta: 20 })
    expect(right.transitions).toEqual([{ id: 'dissolve', kind: 'cross_dissolve', rightClipId: 'right', durationFrames: 30 }])
    expect(videoEditTransitionWindow(right, right.transitions![0])).toMatchObject({ side: 'in', start: 110, end: 140, cut: 110 })
    // 左片段移开：留在左片段出点
    const left = applyVideoEditTimelineEdit(document, sequence.id, { kind: 'adjust', clipIds: ['left'], mode: 'move', delta: -5 })
    expect(left.transitions).toEqual([{ id: 'dissolve', kind: 'cross_dissolve', leftClipId: 'left', durationFrames: 30 }])
    expect(videoEditTransitionWindow(left, left.transitions![0])).toMatchObject({ side: 'out', start: 55, end: 85 })
    // 裁剪入点让两端分开：同样留在被裁剪的片段一端
    const trimmed = applyVideoEditTimelineEdit(document, sequence.id, { kind: 'adjust', clipIds: ['right'], mode: 'in', delta: 10 })
    expect(trimmed.transitions![0]).toMatchObject({ rightClipId: 'right', durationFrames: 30 })
    expect(trimmed.transitions![0]).not.toHaveProperty('leftClipId')
    expect(JSON.stringify(document)).toBe(before)
  })
  it('单侧过渡：窗口整段在片段内，片段变短时缩短，放不下两帧时删除（4.4）', () => {
    const { document, sequence } = fixture(); addEffect(document)
    sequence.transitions = [{ id: 'head', kind: 'dip_to_black', rightClipId: 'right', durationFrames: 30, alignment: 'end' }, { id: 'tail', kind: 'cross_dissolve', leftClipId: 'left', durationFrames: 20 }]
    // 单侧过渡忽略对齐：入点那一侧从切点起
    expect(videoEditTransitionWindow(sequence, sequence.transitions[0])).toMatchObject({ side: 'in', start: 90, end: 120, cut: 90 })
    expect(videoEditTransitionWindow(sequence, sequence.transitions[1])).toMatchObject({ side: 'out', start: 70, end: 90, cut: 90 })
    expect(() => validateVideoEditTransitions(document)).not.toThrow()
    expect(() => videoEditTransitionWindow(sequence, { ...sequence.transitions![0], durationFrames: 61 })).toThrow('超出片段')
    expect(() => videoEditTransitionWindow(sequence, { id: 'none', kind: 'cross_dissolve', durationFrames: 10 })).toThrow('至少')
    const shorter = applyVideoEditTimelineEdit(document, sequence.id, { kind: 'adjust', clipIds: ['right'], mode: 'out', delta: -45 })
    expect(shorter.transitions!.find(value => value.id === 'head')).toMatchObject({ durationFrames: 15 })
    const tiny = applyVideoEditTimelineEdit(document, sequence.id, { kind: 'adjust', clipIds: ['right'], mode: 'out', delta: -59 })
    expect(tiny.transitions!.map(value => value.id)).toEqual(['tail'])
    // 拖单侧过渡：只有离开那一端的边缘改时长，另一缘与平移不动
    expect(dragVideoEditTransition(sequence, 'head', 'out', 10)).toMatchObject({ durationFrames: 40 })
    expect(dragVideoEditTransition(sequence, 'head', 'out', 1000)).toMatchObject({ durationFrames: 60 })
    expect(dragVideoEditTransition(sequence, 'head', 'in', -10)).toMatchObject({ durationFrames: 30 })
    expect(dragVideoEditTransition(sequence, 'tail', 'in', -100)).toMatchObject({ durationFrames: 60 })
    expect(dragVideoEditTransition(sequence, 'tail', 'move', 5)).toMatchObject({ durationFrames: 20 })
    // 只复制它挂着的那个片段时也带上单侧过渡
    const clipboard = copyVideoEditClips(document, sequence.id, ['right'])
    expect(clipboard.transitions!.map(value => value.id)).toEqual(['head'])
    const pasted = applyVideoEditTimelineEdit(document, sequence.id, { kind: 'place', clipboard, frame: 300, mode: 'overwrite' })
    const copy = pasted.transitions!.find(value => !['head', 'tail'].includes(value.id))!
    expect(videoEditTransitionWindow(pasted, copy)).toMatchObject({ side: 'in', start: 300 })
  })
  it('单侧过渡的画面混合与声音增益：从透明或纯色淡入、淡出到透明或纯色（4.4）', () => {
    const { sequence } = fixture()
    const head = videoEditTransitionWindow(sequence, { id: 'head', kind: 'cross_dissolve', rightClipId: 'right', durationFrames: 11 })
    // 交叉溶解借“经过纯色”的后半段，纯色为预乘透明：开头全透明、结尾全是片段
    expect(videoEditTransitionMix(head, head.start)).toEqual({ amount: .5, through: [0, 0, 0, 0] })
    expect(videoEditTransitionMix(head, head.end - 1)).toEqual({ amount: 1, through: [0, 0, 0, 0] })
    const tail = videoEditTransitionWindow(sequence, { id: 'tail', kind: 'dip_to_white', leftClipId: 'left', durationFrames: 11 })
    expect(videoEditTransitionMix(tail, tail.start)).toEqual({ amount: 0, through: [1, 1, 1, 1] })
    expect(videoEditTransitionMix(tail, tail.end - 1)).toEqual({ amount: .5, through: [1, 1, 1, 1] })
    // 普通过渡保持原参数
    const both = videoEditTransitionWindow(sequence, sequence.transitions![0])
    expect(videoEditTransitionMix(both, both.start)).toEqual({ amount: 0, through: undefined })
    // 声音：入点淡入、出点淡出，普通过渡左出右入
    const power = { ...head, transition: { ...head.transition, kind: 'constant_power' as const } }
    expect(videoEditAudioTransitionClipGain(power, 'right', 0)).toBeCloseTo(0)
    expect(videoEditAudioTransitionClipGain(power, 'right', 1)).toBeCloseTo(1)
    expect(videoEditAudioTransitionClipGain({ ...tail, transition: { ...tail.transition, kind: 'constant_gain' as const } }, 'left', .25)).toBeCloseTo(.75)
    expect(videoEditAudioTransitionClipGain({ ...both, transition: { ...both.transition, kind: 'constant_gain' as const } }, 'right', .25)).toBeCloseTo(.25)
  })
  it('编辑点含片段空白一端：Ctrl+D、Shift+D 放单侧过渡，再放普通过渡时替换同一切点的单侧过渡（4.4）', () => {
    const { sequence } = fixture(); sequence.transitions = []
    expect(videoEditDefaultTransitionPairs(sequence, { mode: 'playhead', medium: 'video', frame: 25, tracks: [1] })).toEqual([{ rightClipId: 'left', medium: 'video' }])
    expect(videoEditDefaultTransitionPairs(sequence, { mode: 'playhead', medium: 'video', frame: 160, tracks: [1] })).toEqual([{ leftClipId: 'right', medium: 'video' }])
    const selection = videoEditDefaultTransitionPairs(sequence, { mode: 'selection', clipIds: ['right'] })
    expect(selection).toEqual([{ leftClipId: 'left', rightClipId: 'right', medium: 'video' }, { leftClipId: 'right', medium: 'video' }])
    const { sequence: applied } = applyVideoEditTransitionPairs(sequence, [{ leftClipId: 'right', medium: 'video' }, { rightClipId: 'left', medium: 'video' }], { durationFrames: 100 })
    expect(applied.transitions!.map(value => videoEditTransitionWindow(applied, value)).map(window => [window.side, window.start, window.end])).toEqual([['out', 90, 150], ['in', 30, 90]])
    expect(applied.transitions![0]).not.toHaveProperty('alignment')
    // 右片段入点上的单侧过渡与左右之间的普通过渡在同一切点：放普通过渡即替换
    const single = applyVideoEditTransitionPairs(sequence, [{ rightClipId: 'right', medium: 'video' }], { durationFrames: 10 }).sequence
    expect(videoEditTransitionFit(single, { leftClipId: 'left', rightClipId: 'right' }, 30)).toEqual({ durationFrames: 30, framesBeforeCut: 15 })
    const replaced = applyVideoEditTransitionPairs(single, [{ leftClipId: 'left', rightClipId: 'right', medium: 'video' }], { durationFrames: 30 })
    expect(replaced.sequence.transitions).toHaveLength(1)
    expect(replaced.transitionIds[0]).toBe(single.transitions![0].id)
    expect(replaced.sequence.transitions![0]).toMatchObject({ leftClipId: 'left', rightClipId: 'right', durationFrames: 30 })
  })
  it('双端复制重映射转场及效果，覆盖保留原切点并在覆盖切点时移除，删除级联', () => {
    const { document, sequence } = fixture(); addEffect(document)
    expect(copyVideoEditClips(document, sequence.id, ['left']).transitions).toEqual([])
    const clipboard = copyVideoEditClips(document, sequence.id, ['left', 'right'])
    const pasted = applyVideoEditTimelineEdit(document, sequence.id, { kind: 'place', clipboard, frame: 210, mode: 'paste' })
    const copy = pasted.transitions![1]; expect(copy.id).not.toBe('dissolve')
    expect(videoEditTransitionWindow(pasted, copy).cut).toBe(270)
    expect(pasted.clips.filter(clip => clip.effects?.length).map(clip => clip.effects![0].id)).toHaveLength(2)
    expect(new Set(pasted.clips.flatMap(clip => clip.effects ?? []).map(effect => effect.id)).size).toBe(2)
    expect(() => videoEditDocumentSchema.parse({ ...document, sequences: [pasted] })).not.toThrow()
    const short = copyVideoEditClips(document, sequence.id, ['right']); short.clips[0].duration = 5
    const kept = applyVideoEditTimelineEdit(document, sequence.id, { kind: 'place', clipboard: short, frame: 50, mode: 'overwrite' })
    expect(kept.transitions![0].leftClipId).toBe(kept.clips.find(clip => clip.start === 55)!.id)
    const removed = applyVideoEditTimelineEdit(document, sequence.id, { kind: 'place', clipboard: short, frame: 88, mode: 'overwrite' })
    expect(removed.transitions).toEqual([])
    expect(applyVideoEditTimelineEdit(document, sequence.id, { kind: 'delete', clipIds: ['left'] }).transitions).toEqual([])
  })
  it('原始属性写入删除级联，锁定涵盖转场，fps只转换时长一次', () => {
    const { document, sequence } = fixture()
    const requested = structuredClone(document); requested.sequences[0].clips.pop()
    expect(reconcileVideoEditTimedContent(document, requested).sequences[0].transitions).toEqual([])
    sequence.tracks.find(track => track.index === 1)!.locked = true
    const changed = structuredClone(document); changed.sequences[0].transitions![0].durationFrames = 20
    expect(() => assertVideoEditLockedTracks(document, changed)).toThrow('锁定')
    const converted = changeVideoEditSequenceSettings(sequence, { frameRate: { numerator: 30, denominator: 1 } })
    expect(converted.transitions![0].durationFrames).toBe(15)
    expect(videoEditTransitionWindow(converted, converted.transitions![0])).toMatchObject({ cut: 45, start: 38, end: 53 })
    expect(() => validateVideoEditTransitions({ ...document, sequences: [converted] })).not.toThrow()
  })
  it('非默认固定滤镜版本进入打开剪辑的源码检查引用集合', () => {
    const { document } = fixture(); const program = addEffect(document)
    document.codeMaterials![0].versions.push({ ...document.codeMaterials![0].versions[0], id: 'held-version' })
    document.sequences[0].clips[0].effects![0].code.versionId = 'held-version'
    expect(videoEditCodeReferences(document).map(instance => instance.versionId)).toContain('held-version')
    expect(() => validateCodeMaterialDocument(document, () => program)).not.toThrow()
    document.sequences[0].clips[0].effects![0].code.parameters.amount = 5
    expect(() => validateCodeMaterialDocument(document, () => program)).toThrow()
  })
})
