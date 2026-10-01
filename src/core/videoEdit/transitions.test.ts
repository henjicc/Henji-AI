import { describe, expect, it } from 'vitest'
import { createVideoEditDocument, changeVideoEditSequenceSettings, videoEditDocumentSchema, type VideoEditDocument } from './document'
import { makeVideoEditItemClip } from './projectItems'
import { applyVideoEditTimelineEdit, copyVideoEditClips } from './timelineEdits'
import { validateVideoEditTransitions, videoEditTransitionWindow, videoEditTransitionsAt, videoEditTransitionAmount } from './transitions'
import { reconcileVideoEditTimedContent } from './timedContent'
import { assertVideoEditLockedTracks } from './lockedTracks'
import { compileCodeMaterial } from './codeMaterial/compiler'
import { validateCodeMaterialDocument, videoEditCodeReferences } from './codeMaterialDocument'
import { codeMaterialContextForTransitionFrame } from './codeMaterialTiming'
import { prepareCodeMaterialParameters, evaluateCodeMaterialParameters } from './codeMaterialAnimation'
import { offsetVideoEditSource } from './time'

function fixture() {
  const document = createVideoEditDocument('转场工程'); const sequence = document.sequences[0]
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
  it('NTSC真实前后余量没有一帧或一微秒容差，前端负源不冻结', () => {
    const { document, sequence } = fixture(); sequence.frameRate = { numerator: 60000, denominator: 1001 }
    document.media[0].durationSeconds = 1 + 75 * 1001 / 60000
    sequence.clips[1].sourceInUs = 250250
    expect(() => validateVideoEditTransitions(document)).not.toThrow()
    sequence.clips[1].sourceInUs--
    expect(() => validateVideoEditTransitions(document)).toThrow('早于素材开始')
    sequence.clips[1].sourceInUs++
    document.media[0].durationSeconds -= .000001
    expect(() => validateVideoEditTransitions(document)).toThrow('余量不足')
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
  it('拆分保留切点引用，双端移动保留，单端破坏邻接整体拒绝', () => {
    const { document, sequence } = fixture(); addEffect(document)
    const split = applyVideoEditTimelineEdit(document, sequence.id, { kind: 'split', clipIds: ['left'], frame: 60 })
    const outgoing = split.clips.find(clip => clip.start === 60)!
    expect(split.transitions![0].leftClipId).toBe(outgoing.id)
    expect(outgoing.effects![0].id).not.toBe(split.clips[0].effects![0].id)
    const moved = applyVideoEditTimelineEdit(document, sequence.id, { kind: 'adjust', clipIds: ['left', 'right'], mode: 'move', delta: 10 })
    expect(videoEditTransitionWindow(moved, moved.transitions![0]).cut).toBe(100)
    const before = JSON.stringify(document)
    expect(() => applyVideoEditTimelineEdit(document, sequence.id, { kind: 'adjust', clipIds: ['right'], mode: 'move', delta: 1 })).toThrow('紧邻')
    expect(JSON.stringify(document)).toBe(before)
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
  it('非默认固定滤镜版本进入打开工程的源码检查引用集合', () => {
    const { document } = fixture(); const program = addEffect(document)
    document.codeMaterials![0].versions.push({ ...document.codeMaterials![0].versions[0], id: 'held-version' })
    document.sequences[0].clips[0].effects![0].code.versionId = 'held-version'
    expect(videoEditCodeReferences(document).map(instance => instance.versionId)).toContain('held-version')
    expect(() => validateCodeMaterialDocument(document, () => program)).not.toThrow()
    document.sequences[0].clips[0].effects![0].code.parameters.amount = 5
    expect(() => validateCodeMaterialDocument(document, () => program)).toThrow()
  })
})
