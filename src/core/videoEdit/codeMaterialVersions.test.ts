import { describe, expect, it } from 'vitest'
import { compileCodeMaterial } from './codeMaterial/compiler'
import { codeMaterialDefinitionsSchema } from './codeMaterialPersistence'
import { appendCodeMaterialVersion, makeCodeMaterialDefinition } from './codeMaterialVersions'
import { createVideoEditDocument, videoEditDocumentSchema } from './document'

const compile = async (source: string) => compileCodeMaterial(source)
const source = (defaultValue = .5) => `export default {apiVersion:1,name:"原生素材",kind:"generator",mode:"dynamic",width:3840,height:2160,durationSeconds:10,seed:42,parameters:{amount:{type:"number",title:"数量",default:${defaultValue},min:0,max:1,step:.01}},render(ctx){return [rect({x:ctx.time,y:0,width:100,height:100,fill:[1,0,0,ctx.params.amount]})];}}`
describe('工程内嵌源码契约', () => {
  it('源码版本追加不可变，保存重读不跟随默认版本或保存IR', async () => {
    const { definition } = await makeCodeMaterialDefinition(source(), compile)
    const published = await appendCodeMaterialVersion(definition, source(.7), compile)
    expect(published.definition.defaultVersionId).toBe(definition.defaultVersionId)
    expect(definition.versions).toHaveLength(1); expect(published.definition.versions).toHaveLength(2)
    const document = createVideoEditDocument('内嵌源码工程')
    const json = JSON.stringify({ ...document, codeMaterials: [{ ...published.definition, defaultVersionId: published.versionId }] })
    const loaded = videoEditDocumentSchema.parse(JSON.parse(json))
    const definitions = codeMaterialDefinitionsSchema.parse(loaded.codeMaterials)
    expect(Object.keys(definitions[0].versions[0])).toEqual(['id', 'apiVersion', 'languageVersion', 'source'])
    expect(json).not.toContain('bindings')
    expect(videoEditDocumentSchema.parse(document)).not.toHaveProperty('codeMaterials')
    expect(() => videoEditDocumentSchema.parse({ ...loaded, codeMaterials: [{ ...definitions[0], id: document.sequences[0].id }] })).toThrow('重复标识')
  })
  it('编译失败不追加版本，拒绝伪造语言标签', async () => {
    const { definition } = await makeCodeMaterialDefinition(source(), compile)
    await expect(appendCodeMaterialVersion(definition, source().replace('return [', 'while(true){}return ['), compile)).rejects.toThrow('const')
    expect(definition.versions).toHaveLength(1)
    const forged = { ...definition, versions: definition.versions.map(version => ({ ...version, languageVersion: 2 as const })) }
    await expect(appendCodeMaterialVersion(forged, source(), compile)).rejects.toThrow('语言版本')
  })
})
