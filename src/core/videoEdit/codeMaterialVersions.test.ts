import { addressCodeMaterialFiles, documentCodeSourceResolver, type CodeMaterialFiles } from './codeMaterial/sources'
import { testCodeSource } from './codeMaterial/sourceTestFixtures'
import { createVideoEditTestDocument as createVideoEditDocument } from './testFixtures'
import { describe, expect, it } from 'vitest'
import { testAuthorBundle, testAuthorProgram } from '../../features/videoEdit/engine/videoEditAuthorTestFixtures'
import { codeMaterialDefinitionsSchema } from './codeMaterialPersistence'
import { appendCodeMaterialVersion, makeCodeMaterialDefinition, type CodeVersionPublication } from './codeMaterialVersions'
import { videoEditDocumentSchema } from './document'

const compile = async (source: CodeMaterialFiles) => testAuthorProgram(testAuthorBundle(source))
const publication: CodeVersionPublication = { imports: [], async write(id, _name, files, folder) { return { folder: folder ?? id, files: (await addressCodeMaterialFiles(files)).files } } }
const source = (defaultValue = .5) => `export default {name:"原生素材",kind:"generator",width:3840,height:2160,durationSeconds:10,params:[{key:"amount",type:"number",title:"数量",default:${defaultValue},min:0,max:1,step:.01}],draw(ctx,t,p){ctx.globalAlpha=p.amount;ctx.fillRect(t,0,100,100);}}`
describe('剪辑源码文件引用契约', () => {
  it('作者版本经过正式追加与文档保存重读，只持久化源码引用', async () => {
    const v3 = source()
    const { definition } = await makeCodeMaterialDefinition(v3, compile, publication)
    const published = await appendCodeMaterialVersion(definition, v3.replace('fillRect(t,0,100', 'fillRect(t,0,120'), compile, documentCodeSourceResolver(), publication)
    const document = createVideoEditDocument('v3保存')
    const loaded = videoEditDocumentSchema.parse(JSON.parse(JSON.stringify({ ...document, codeMaterials: [published.definition] })))
    expect(loaded.codeMaterials![0].versions.map(version => version.languageVersion)).toEqual([4, 4])
    expect(testCodeSource(loaded, loaded.codeMaterials![0].versions[1])).toContain('fillRect(t,0,120')
    expect(loaded.codeMaterials![0].versions[1]).not.toHaveProperty('result')
  })
  it('源码版本追加不可变，保存重读不跟随默认版本或保存IR', async () => {
    const { definition } = await makeCodeMaterialDefinition(source(), compile, publication)
    const published = await appendCodeMaterialVersion(definition, source(.7), compile, documentCodeSourceResolver(), publication)
    expect(published.definition.defaultVersionId).toBe(definition.defaultVersionId)
    expect(definition.versions).toHaveLength(1); expect(published.definition.versions).toHaveLength(2)
    const document = createVideoEditDocument('内嵌源码剪辑')
    const json = JSON.stringify({ ...document, codeMaterials: [{ ...published.definition, defaultVersionId: published.versionId }] })
    const loaded = videoEditDocumentSchema.parse(JSON.parse(json))
    const definitions = codeMaterialDefinitionsSchema.parse(loaded.codeMaterials)
    expect(Object.keys(definitions[0].versions[0])).toEqual(['id', 'apiVersion', 'languageVersion', 'entry', 'files'])
    expect(json).not.toContain('bindings')
    expect(videoEditDocumentSchema.parse(document)).not.toHaveProperty('codeMaterials')
    expect(() => videoEditDocumentSchema.parse({ ...loaded, codeMaterials: [{ ...definitions[0], id: document.sequences[0].id }] })).toThrow('重复标识')
  })
  it('编译失败不追加版本，拒绝伪造语言标签', async () => {
    const { definition } = await makeCodeMaterialDefinition(source(), compile, publication)
    await expect(appendCodeMaterialVersion(definition, 'export default {', compile, documentCodeSourceResolver(), publication)).rejects.toThrow()
    expect(definition.versions).toHaveLength(1)
    const forged = { ...definition, versions: definition.versions.map(version => ({ ...version, languageVersion: 2 })) }
    expect(() => codeMaterialDefinitionsSchema.parse([forged])).toThrow()
  })
})
