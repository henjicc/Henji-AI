import { expect, it, vi } from 'vitest'
import { collectVideoEditCodeMotion } from './codeMotionReview'
import { compileCodeMaterial } from './codeMaterial/compiler'
import { layoutCodeText } from './codeMaterial/textLayout'
import { createVideoEditDocument, createVideoEditSequence, videoEditComposition, type VideoEditClip } from './document'
import { addLegacyVideoEditTracks } from './testFixtures'
import type { CodeTextMeasureRequest } from './codeMaterial/contract'
import { collectVideoEditReviewStructure, videoEditCrowdedReviewEvents, type VideoEditReviewRecord } from './review'

const source = (body: string): string => `export default {apiVersion:1,languageVersion:3,name:"复核",kind:"generator",mode:"dynamic",width:1000,height:1000,durationSeconds:20,seed:0,parameters:{},render(ctx){${body}}}`
const measure = (request: CodeTextMeasureRequest) => layoutCodeText(request, text => text.length * 10)
function fixture(body: string) {
  const program = compileCodeMaterial(source(body)), document = createVideoEditDocument('代码运动'), sequence = createVideoEditSequence('主')
  sequence.id = 'root'; addLegacyVideoEditTracks(sequence); document.sequences = [sequence]
  const clip: VideoEditClip = { id: 'code', itemId: 'code-item', name: '代码', kind: 'code', track: 1, start: 0, duration: 120, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: .5, y: .5, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '', code: { definitionId: 'definition', versionId: 'version', parameters: {} } }
  sequence.clips = [clip]
  const run = () => collectVideoEditCodeMotion(videoEditComposition(document, 'root'), { from: 0, to: 120 }, { version: program }, {}, measure)
  return { document, sequence, clip, program, run }
}
it('reads checked IR, finds a group move without multiplying it by its children, and retains independent child movement', async () => {
  const { run } = fixture('return [group({id:"parent",x:min(ctx.time,1)*200,y:0},[rect({id:"fixed",x:10,y:10,width:100,height:100}),rect({id:"moving",x:10,y:200+min(ctx.time,1)*100,width:100,height:100})])];')
  const result = await run(), moving = result.records.filter(record => record.kind === 'motion')
  expect(moving).toHaveLength(2)
  expect(moving.map(record => record.elementPath?.at(-1))).toEqual(['parent/0', 'moving/1'])
  expect(moving.map(record => record.peakSpeed)).toEqual([expect.closeTo(20, 4), expect.closeTo(10, 4)])
  expect(result.records.filter(record => record.kind === 'motion_hard_stop')).toHaveLength(2)
  expect(result.records.some(record => record.kind === 'motion_hold' && record.elementPath?.at(-1) === 'parent/0')).toBe(false)
})
it('does not mistake a growing child bound for movement of its fixed parent', async () => {
  const { run } = fixture('return [group({id:"parent",x:0,y:0},[rect({id:"child",x:10,y:10,width:100+ctx.time*100,height:100})])];')
  const result = await run()
  expect(result.records.some(record => record.kind === 'motion' && record.elementPath?.at(-1) === 'child/0')).toBe(true)
  expect(result.records.some(record => record.kind === 'motion' && record.elementPath?.at(-1) === 'parent/0')).toBe(false)
})
it('gets text bounds from the host, caches completed measurements and reports text/appearance changes', async () => {
  const { document, program } = fixture('return [text({id:"label",x:10,y:10,text:ctx.time<1?"A":"更长",fontSize:20}),rect({id:"flash",x:10,y:200,width:100,height:100,opacity:ctx.time<2?0:1})];')
  const host = vi.fn(async (request: CodeTextMeasureRequest) => measure(request))
  const result = await collectVideoEditCodeMotion(videoEditComposition(document, 'root'), { from: 0, to: 120 }, { version: program }, {}, host)
  expect(host).toHaveBeenCalledTimes(2)
  expect(result.records).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'code_change', timeline: { from: 30, to: 31 } }),
    expect.objectContaining({ kind: 'code_change', timeline: { from: 60, to: 61 } }),
  ]))
  await expect(collectVideoEditCodeMotion(videoEditComposition(document, 'root'), { from: 0, to: 120 }, { version: program }, {}, () => { throw new Error('字体不可用') })).rejects.toThrow('字体不可用')
})
it('keeps a one-frame jump and merges parent/child appearance evidence at the same frame', async () => {
  const { run } = fixture('return [group({id:"parent",x:ctx.time<1?0:300,y:0,opacity:ctx.time<2?1:0},[rect({id:"child",x:10,y:10,width:100,height:100})])];')
  const result = await run()
  expect(result.records.some(record => record.kind === 'motion' && record.timeline.from <= 30 && record.timeline.to > 30)).toBe(true)
  expect(result.records.filter(record => record.kind === 'code_change' && record.timeline.from === 60)).toHaveLength(1)
})
it.each([false, true])('source trim, speed and reverse keep placed paths and use the quantized mixed-rate clock: %s', async reverse => {
  const { document, clip, program } = fixture('return [rect({id:"moving",x:ctx.time*100,y:10,width:100,height:100})];')
  const child = createVideoEditSequence('子'); child.id = 'child'; child.frameRate = { numerator: 60, denominator: 1 }; addLegacyVideoEditTracks(child)
  child.clips = [clip]; clip.duration = 240; clip.sourceInUs = 1000000
  document.sequences.push(child); document.items.push({ id: 'nested', name: '嵌套', kind: 'sequence', sequenceId: 'child' })
  const wrapper: VideoEditClip = { ...clip, id: 'wrapper', kind: 'sequence', code: undefined, itemId: 'nested', duration: 30, speed: { numerator: 2, denominator: 1 }, ...(reverse ? { reverse: true as const, sourceInUs: 1000000 } : {}) }
  document.sequences[0].clips = [wrapper, { ...wrapper, id: 'again', start: 60 }]
  const result = await collectVideoEditCodeMotion(videoEditComposition(document, 'root'), { from: 0, to: 90 }, { version: program }, {}, measure)
  const moves = result.records.filter(record => record.kind === 'motion')
  expect(moves).toHaveLength(2)
  expect(moves.map(record => record.path.map(step => step.clipId))).toEqual([['wrapper', 'code'], ['again', 'code']])
  expect(moves.every(record => Math.abs(record.peakSpeed! - 20) < .0001)).toBe(true)
  expect(moves[1].timeline.from - moves[0].timeline.from).toBe(60)
})
it('does not invent evidence for missing IR or audio-driven frames', async () => {
  const { document, program } = fixture('return [rect({id:"audio",x:ctx.audio.level()*100,y:0,width:100,height:100})];')
  const root = videoEditComposition(document, 'root')
  const missing = await collectVideoEditCodeMotion(root, { from: 0, to: 120 }, {}, {}, measure)
  expect(missing.records).toEqual([expect.objectContaining({ kind: 'code_unavailable' })])
  const audio = await collectVideoEditCodeMotion(root, { from: 0, to: 120 }, { version: program }, {}, measure)
  expect(audio.sampledFrames).toBe(0)
  expect(audio.records).toEqual([expect.objectContaining({ kind: 'code_unavailable', detail: expect.stringContaining('声音驱动') })])
})
it('rejects whole oversized work rather than silently truncating a later instance', async () => {
  const { document, program, clip } = fixture('return [rect({x:0,y:0,width:100,height:100})];')
  clip.duration = 60001
  await expect(collectVideoEditCodeMotion(videoEditComposition(document, 'root'), { from: 0, to: 60001 }, { version: program }, {}, measure)).rejects.toThrow('60000帧实例预算')
})
it('shader internals remain explicitly unknown and never become a static-image claim', async () => {
  const { run } = fixture('return [shader({name:"SolidColor",x:0,y:0,width:100,height:100})];')
  const result = await run()
  expect(result.records).toEqual([expect.objectContaining({ kind: 'code_unavailable', elementPath: expect.any(Array) })])
})
it('parameter curves and element overrides are evaluated on the trimmed source clock', async () => {
  const { document, clip } = fixture('return [];')
  const program = compileCodeMaterial(source('return [rect({id:"box",x:ctx.params.amount,y:10,width:100,height:100})];').replace('parameters:{}', 'parameters:{amount:{type:"number",title:"位置",default:0,min:0,max:1000,step:1,animatable:true}}'))
  const point = (id: string, sourceInUs: number, value: number) => ({ id, sourceInUs, sourceRemainder: { numerator: 0, denominator: 1 }, value, interpolation: 'linear' as const })
  clip.sourceInUs = 1000000
  clip.code!.curves = { amount: [point('a', 0, 0), point('b', 4000000, 400)] }
  clip.elementOverrides = { box: { curves: { dx: [point('c', 0, 0), point('d', 4000000, 400)] } } }
  const result = await collectVideoEditCodeMotion(videoEditComposition(document, 'root'), { from: 0, to: 90 }, { version: program }, {}, measure)
  expect(result.records).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'motion', timeline: { from: 1, to: 90 }, peakSpeed: expect.closeTo(20, 4) })]))
  clip.elementOverrides.box.hidden = true
  expect((await collectVideoEditCodeMotion(videoEditComposition(document, 'root'), { from: 0, to: 90 }, { version: program }, {}, measure)).records).toEqual([])
})
it('transition handles evaluate code before the incoming cut without inventing a new local clock', async () => {
  const { document, sequence, clip, program } = fixture('return [rect({id:"box",x:ctx.localTime*100+200,y:10,width:100,height:100})];')
  sequence.clips = [{ ...clip, id: 'left', duration: 60, sourceInUs: 1000000 }, { ...clip, id: 'right', start: 60, duration: 60, sourceInUs: 1000000 }]
  sequence.transitions = [{ id: 'dissolve', kind: 'cross_dissolve', leftClipId: 'left', rightClipId: 'right', durationFrames: 30 }]
  const result = await collectVideoEditCodeMotion(videoEditComposition(document, 'root'), { from: 45, to: 75 }, { version: program }, {}, measure)
  expect(result.records.filter(record => record.kind === 'motion').map(record => record.subjectId)).toEqual(['left', 'right'])
  expect(result.records.filter(record => record.kind === 'motion').every(record => record.timeline.from === 46 && record.timeline.to === 75 && Math.abs(record.peakSpeed! - 10) < .0001)).toBe(true)
})
it('density coalesces a code entrance with its clip boundary and retains independent code elements', async () => {
  const { run, document } = fixture('return [group({id:"parent",x:min(ctx.time,1)*200,y:0},[rect({id:"child",x:10,y:10,width:100,height:100})])];')
  const result = await run(), root = videoEditComposition(document, 'root')
  const records: VideoEditReviewRecord[] = [...collectVideoEditReviewStructure(root, { from: 0, to: 120 }).records, ...result.records.map(record => ({ ...record, motionEvidence: { basis: 'code_structure' as const, elementPath: record.elementPath, suggestion: '观察' } }))]
  expect(videoEditCrowdedReviewEvents(records.filter(record => record.kind !== 'motion_hard_stop'), root.fps, 1.5)).toEqual([])
  const move = records.find(record => record.kind === 'motion')!
  const independent = { ...move, motionEvidence: { ...move.motionEvidence!, elementPath: ['independent/0'] } }
  expect(videoEditCrowdedReviewEvents([move, independent], root.fps, 1.5)).toHaveLength(1)
})
