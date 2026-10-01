import { describe, expect, it } from 'vitest'
import { compileCodeMaterial } from './codeMaterial/compiler'
import { codeMaterialDefinitionsSchema, codeMaterialInstanceSchema } from './codeMaterialPersistence'
import { appendCodeMaterialVersion, bindCodeMaterialInstance, changeCodeMaterialInstanceVersion, makeCodeMaterialDefinition } from './codeMaterialVersions'
import { createVideoEditDocument, videoEditDocumentSchema } from './document'

const compile = async (source: string) => compileCodeMaterial(source)
const source = (defaultValue = .5, max = 1) => `export default {apiVersion:1,name:"原生素材",kind:"generator",mode:"dynamic",width:3840,height:2160,durationSeconds:10,seed:42,parameters:{amount:{type:"number",title:"数量",default:${defaultValue},min:0,max:${max},step:.01}},render(ctx){return [rect({x:ctx.time,y:0,width:100,height:100,fill:[1,0,0,ctx.params.amount]})];}}`
describe('工程内嵌源码与固定实例契约', () => {
  it('源码版本追加不可变、实例参数独立，保存重读不跟随默认版本或保存IR', async () => {
    const { definition } = await makeCodeMaterialDefinition(source(), compile)
    const first = await bindCodeMaterialInstance(definition, definition.defaultVersionId, { amount: .2 }, compile)
    const second = await bindCodeMaterialInstance(definition, definition.defaultVersionId, { amount: .8 }, compile)
    const published = await appendCodeMaterialVersion(definition, source(.7), compile)
    expect(published.definition.defaultVersionId).toBe(definition.defaultVersionId)
    expect(definition.versions).toHaveLength(1); expect(published.definition.versions).toHaveLength(2)
    const document = createVideoEditDocument('内嵌源码工程')
    const json = JSON.stringify({ ...document, codeMaterials: [{ ...published.definition, defaultVersionId: published.versionId }] })
    const loaded = videoEditDocumentSchema.parse(JSON.parse(json))
    const definitions = codeMaterialDefinitionsSchema.parse(loaded.codeMaterials); const instances = [first, second].map(value => codeMaterialInstanceSchema.parse(JSON.parse(JSON.stringify(value))))
    expect(instances.map(value => value.versionId)).toEqual([definition.defaultVersionId, definition.defaultVersionId])
    expect(instances.map(value => value.parameters.amount)).toEqual([.2, .8])
    expect(Object.keys(definitions[0].versions[0])).toEqual(['id', 'apiVersion', 'languageVersion', 'source'])
    expect(json).not.toContain('bindings')
    expect(videoEditDocumentSchema.parse(document)).not.toHaveProperty('codeMaterials')
    expect(() => videoEditDocumentSchema.parse({ ...loaded, codeMaterials: [{ ...definitions[0], id: document.sequences[0].id }] })).toThrow('重复标识')
  })
  it('编译或参数演进失败不替换有效版本，显式升级只作用于原实例', async () => {
    const { definition } = await makeCodeMaterialDefinition(source(), compile)
    const instance = await bindCodeMaterialInstance(definition, definition.defaultVersionId, { amount: .8 }, compile)
    const valid = await appendCodeMaterialVersion(definition, source(.4, 2), compile)
    const changed = await changeCodeMaterialInstanceVersion(valid.definition, instance, valid.versionId, compile)
    expect(changed.parameters.amount).toBe(.8); expect(instance.versionId).toBe(definition.defaultVersionId)
    const narrowed = await appendCodeMaterialVersion(valid.definition, source(.4, .5), compile)
    await expect(changeCodeMaterialInstanceVersion(narrowed.definition, instance, narrowed.versionId, compile)).rejects.toThrow('范围缩小')
    await expect(appendCodeMaterialVersion(definition, source().replace('return [', 'while(true){}return ['), compile)).rejects.toThrow('const')
    await expect(bindCodeMaterialInstance(definition, '丢失版本', {}, compile)).rejects.toThrow('固定代码版本')
    expect(definition.versions).toHaveLength(1)
  })
  it('版本切换检查原曲线与候选动画范围，拒绝伪造语言标签', async () => {
    const animated = source().replace('step:.01', 'step:.01,animatable:true')
    const { definition } = await makeCodeMaterialDefinition(animated, compile)
    const instance = { ...await bindCodeMaterialInstance(definition, definition.defaultVersionId, {}, compile), curves: { amount: [{ id: 'end', sourceInUs: 8_000_000, sourceRemainder: { numerator: 0, denominator: 1 }, value: .8, interpolation: 'linear' as const }] } }
    const shorter = await appendCodeMaterialVersion(definition, animated.replace('durationSeconds:10', 'durationSeconds:5'), compile)
    await expect(changeCodeMaterialInstanceVersion(shorter.definition, instance, shorter.versionId, compile)).rejects.toThrow()
    const disabled = await appendCodeMaterialVersion(definition, animated.replace('animatable:true', 'animatable:false'), compile)
    await expect(changeCodeMaterialInstanceVersion(disabled.definition, instance, disabled.versionId, compile)).rejects.toThrow()
    const forged = { ...definition, versions: definition.versions.map(version => ({ ...version, languageVersion: 2 as const })) }
    await expect(bindCodeMaterialInstance(forged, definition.defaultVersionId, {}, compile)).rejects.toThrow('语言版本')
    await expect(appendCodeMaterialVersion(forged, animated, compile)).rejects.toThrow('语言版本')
  })
})
