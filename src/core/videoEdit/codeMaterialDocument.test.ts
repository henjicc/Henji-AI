import { createVideoEditTestDocument as createVideoEditDocument } from './testFixtures'
import { describe, expect, it } from 'vitest'
import { compileCodeMaterial } from './codeMaterial/compiler'
import { evaluateCodeMaterial } from './codeMaterial/evaluate'
import { codeMaterialContextForFrame } from './codeMaterialTiming'
import { codeMaterialSource, validateCodeMaterialDocument } from './codeMaterialDocument'
import { videoEditDocumentSchema, videoEditComposition, splitVideoEditClip, adjustVideoEditClip } from './document'
import { makeVideoEditItemClip, makeVideoEditItemSequence } from './projectItems'

const source = (mode = 'dynamic') => `export default {apiVersion:1,name:"原创透明形状",kind:"generator",mode:"${mode}",width:3840,height:2160,durationSeconds:10,seed:42,parameters:{amount:{type:"number",title:"强度",default:.5,min:0,max:1,step:.01}},render(ctx){return [rect({x:${mode === 'dynamic' ? 'ctx.time*10' : '10'},y:10,width:100,height:100,fill:[1,0,0,ctx.params.amount]})];}}`
function setup(mode = 'dynamic') {
  const program = compileCodeMaterial(source(mode)); const document = createVideoEditDocument('代码剪辑')
  document.codeMaterials = [{ id: 'definition', name: program.name, defaultVersionId: 'version', versions: [{ id: 'version', apiVersion: 1, languageVersion: 1, source: source(mode) }] }]
  document.items.push({ id: 'item', name: program.name, kind: 'code', code: { definitionId: 'definition', versionId: 'version', parameters: { amount: .2 } } })
  const read = () => program; const sequence = document.sequences[0]
  sequence.frameRate = { numerator: 30000, denominator: 1001 }
  sequence.clips.push(makeVideoEditItemClip(document, 'item', sequence.id, { frame: 0 }, read))
  return { document, program, read, sequence }
}
describe('代码素材项与独立实例的剪辑约束', () => {
  it('插入、裁剪、拆分保持固定版本与连续源画面，参数对象独立', () => {
    const { document, program, read, sequence } = setup()
    expect(videoEditDocumentSchema.parse(document).sequences[0].clips[0].code?.versionId).toBe('version')
    validateCodeMaterialDocument(document, read)
    const original = sequence.clips[0]
    const second = makeVideoEditItemClip(document, 'item', sequence.id, { frame: 0 }, read)
    second.code!.parameters.amount = .8
    expect(original.code!.parameters.amount).toBe(.2); expect(document.items[0].code!.parameters.amount).toBe(.2)
    const before = codeMaterialContextForFrame(original, 150, sequence.frameRate, program)
    const trimmed = adjustVideoEditClip(videoEditComposition(document, sequence.id), original, { mode: 'in', delta: 30, track: 1 }, read)
    sequence.clips = [trimmed]
    const split = splitVideoEditClip(sequence, original.id, 100)
    const tail = split.clips[1]
    const after = codeMaterialContextForFrame(tail, 150, sequence.frameRate, program)
    expect(after.time).toBe(before.time); expect(evaluateCodeMaterial(program, after, tail.code!.parameters)).toEqual(evaluateCodeMaterial(program, before, original.code!.parameters))
    tail.code!.parameters.amount = .6; expect(split.clips[0].code!.parameters.amount).toBe(.2)
    const matched = makeVideoEditItemSequence(document, ['item'], {}, read)
    expect([matched.width, matched.height]).toEqual([3840, 2160])
  })
  it('静态延长不改源版本，动态越界、参数类型错误和失效源码引用拒绝', () => {
    const staticSetup = setup('static'); const sequence = staticSetup.sequence
    const extended = adjustVideoEditClip(videoEditComposition(staticSetup.document, sequence.id), sequence.clips[0], { mode: 'out', delta: 3000, track: 1 }, staticSetup.read)
    sequence.clips = [extended]; expect(extended.duration).toBeGreaterThan(3000); validateCodeMaterialDocument(staticSetup.document, staticSetup.read)
    const { document, read } = setup()
    document.sequences[0].clips[0].duration = 1000
    expect(() => validateCodeMaterialDocument(document, read)).toThrow('声明时长')
    document.sequences[0].clips[0].duration = 1; document.sequences[0].clips[0].code!.parameters.amount = '错误'
    expect(() => validateCodeMaterialDocument(document, read)).toThrow('有限数值')
    document.items[0].code!.versionId = 'missing'
    expect(() => codeMaterialSource(document, document.items[0].code!)).toThrow('固定代码版本')
    expect(() => videoEditDocumentSchema.parse(document)).toThrow('固定源码版本')
  })
  it('不允许把滤镜当生成器、代码绑定到普通片段或引用其他定义', () => {
    const { document, read } = setup()
    expect(() => validateCodeMaterialDocument(document, () => ({ ...read(), kind: 'filter' }))).toThrow('附加效果')
    const clip = document.sequences[0].clips[0]
    expect(() => videoEditDocumentSchema.parse({ ...document, sequences: [{ ...document.sequences[0], clips: [{ ...clip, kind: 'text' }] }] })).toThrow('普通片段')
    expect(() => videoEditDocumentSchema.parse({ ...document, sequences: [{ ...document.sequences[0], clips: [{ ...clip, code: { ...clip.code!, definitionId: 'other' } }] }] })).toThrow('所属定义')
    expect(() => makeVideoEditItemClip(document, 'item', document.sequences[0].id, { frame: 0 })).toThrow('尚未完成')
  })
})
