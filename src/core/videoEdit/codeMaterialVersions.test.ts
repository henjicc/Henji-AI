import { importedAuthorLibraries } from './codeMaterial/libraryImports'
import { addressCodeMaterialFiles, documentCodeSourceResolver, type CodeMaterialFiles } from './codeMaterial/sources'
import { testCodeSource } from './codeMaterial/sourceTestFixtures'
import { createVideoEditTestDocument as createVideoEditDocument } from './testFixtures'
import { describe, expect, it, vi } from 'vitest'
import { testAuthorBundle, testAuthorProgram } from '../../features/videoEdit/engine/videoEditAuthorTestFixtures'
import { CODE_AUTHOR_API_VERSION, codeMaterialDefinitionsSchema } from './codeMaterialPersistence'
import { appendCodeMaterialVersion, makeCodeMaterialDefinition, type CodeSourceCompiler, type CodeVersionPublication } from './codeMaterialVersions'
import { videoEditDocumentSchema } from './document'
import { codeVersionContentKey } from './codeMaterial/sources'
import { GOLDEN_SCENE_DECLARATION } from './scene/sceneTestFixtures'

const compile = async (source: CodeMaterialFiles) => testAuthorProgram({ ...testAuthorBundle(source), libraries: importedAuthorLibraries(source) })
const publication: CodeVersionPublication = { imports: [], async write(id, _name, files, folder) { return { folder: folder ?? id, files: (await addressCodeMaterialFiles(files)).files } } }
const source = (defaultValue = .5) => `export default {name:"原生素材",kind:"generator",width:3840,height:2160,durationSeconds:10,params:[{key:"amount",type:"number",title:"数量",default:${defaultValue},min:0,max:1,step:.01}],draw(ctx,t,p){ctx.globalAlpha=p.amount;ctx.fillRect(t,0,100,100);}}`
describe('作者接口与内置库版本保持一致', () => {
  it('可达文件导入解析失败时停止发布，并点名文件而非猜测库版本', async () => {
    const files = { entry: 'main.js', files: { 'main.js': 'import "./title.js"; ' + source(), 'title.js': 'import { layoutText } from "henji-layout/text"; const broken = "' } }
    expect(() => importedAuthorLibraries(files)).toThrow('title.js')
    await expect(makeCodeMaterialDefinition(files, compile, publication)).rejects.toThrow('title.js')
  })
  it('逐库解析明确、继承、历史缺省和新增导入；无记录旧源码原样保存复用', async () => {
    const text = 'import "henji-layout/text";' + source()
    const created = await makeCodeMaterialDefinition(text, compile, publication)
    expect(created.definition.versions[0].libraries).toEqual({ 'henji-layout': '1.2.0' })
    const frozen = structuredClone(created.definition)
    frozen.versions[0].libraries = { 'henji-layout': '1.1.0' }
    const preserved = await appendCodeMaterialVersion(frozen, text, compile, documentCodeSourceResolver(), publication)
    expect(preserved.versionId).toBe(frozen.defaultVersionId)
    expect(preserved.program.bundle.libraries).toEqual({ 'henji-layout': '1.1.0' })
    const old = structuredClone(created.definition); delete old.versions[0].libraries
    const saved = await appendCodeMaterialVersion(old, text, compile, documentCodeSourceResolver(), publication)
    expect(saved.versionId).toBe(old.defaultVersionId)
    expect(saved.program.bundle.libraries).toEqual({ 'henji-layout': '1.0.0' })
    const edited = await appendCodeMaterialVersion(old, text + '\n// 改动', compile, documentCodeSourceResolver(), publication)
    expect(edited.definition.versions.at(-1)?.libraries).toEqual({ 'henji-layout': '1.0.0' })
    const upgraded = await appendCodeMaterialVersion(old, text, compile, documentCodeSourceResolver(), { ...publication, libraries: { 'henji-layout': '1.1.0' } })
    expect(upgraded.versionId).not.toBe(old.defaultVersionId)
    expect(upgraded.definition.versions.at(-1)?.libraries).toEqual({ 'henji-layout': '1.1.0' })
    const three = await makeCodeMaterialDefinition('import "three";' + source(), compile, publication)
    const added = await appendCodeMaterialVersion(three.definition, 'import "three";' + text, compile, documentCodeSourceResolver(), publication)
    expect(added.definition.versions.at(-1)?.libraries).toEqual({ three: '0.186.1', 'henji-layout': '1.2.0' })
    const unchanged = await appendCodeMaterialVersion(three.definition, 'import "three";' + source(), compile, documentCodeSourceResolver(), publication)
    expect(unchanged.versionId).toBe(three.definition.defaultVersionId)
  })
  it('新代码按当前作者接口编译并记录，带上实际导入的内置库', async () => {
    const inputs: CodeMaterialFiles[] = []
    // 模拟打包器报告源码导入了 three。
    const importsThree: CodeSourceCompiler = async files => { inputs.push(files); const program = await compile(files); return { ...program, bundle: { ...program.bundle, libraries: { three: '0.186.1' } } } }
    const { definition } = await makeCodeMaterialDefinition('import "three";'+source(), importsThree, publication)
    expect(inputs[0]).toMatchObject({ apiVersion: CODE_AUTHOR_API_VERSION }); expect(inputs[0].libraries).toEqual({ three: '0.186.1' })
    expect(definition.versions[0]).toMatchObject({ apiVersion: inputs[0].apiVersion, libraries: { three: '0.186.1' } })
    // 追加版本按前一版记录的库版本解析，并照旧记录。
    const next = await appendCodeMaterialVersion(definition, 'import "three";'+source(.6), importsThree, documentCodeSourceResolver(), publication)
    expect(inputs.at(-1)).toMatchObject({ apiVersion: CODE_AUTHOR_API_VERSION, libraries: { three: '0.186.1' } })
    expect(next.definition.versions.find(version => version.id === next.versionId)).toMatchObject({ apiVersion: inputs.at(-1)?.apiVersion, libraries: { three: '0.186.1' } })
    // 未导入的库不参与版本身份，避免原样保存产生重复版本。
    expect((await makeCodeMaterialDefinition(source(), compile, publication)).definition.versions[0].libraries).toBeUndefined()
  })

  it('已有 v4 记录照旧按 v4 编译核对，内容键不变；固定为 v4 的资产重建后仍是 v4', async () => {
    const inputs: CodeMaterialFiles[] = []
    const recording: CodeSourceCompiler = async files => { inputs.push(files); return compile(files) }
    const { definition: created } = await makeCodeMaterialDefinition(source(), recording, { ...publication, apiVersion: 4 })
    expect(created.versions[0].apiVersion).toBe(4)
    const legacy = created.versions[0], key = codeVersionContentKey(legacy)
    const appended = await appendCodeMaterialVersion(created, source(.7), recording, documentCodeSourceResolver(), publication)
    // 前一版按自己的 v4 记录编译核对，不报“源码语言版本与固定版本不一致”。
    expect(inputs[1]).toMatchObject({ apiVersion: 4 })
    const kept = appended.definition.versions.find(version => version.id === legacy.id)!
    expect(kept).toEqual(legacy); expect(codeVersionContentKey(kept)).toBe(key)
    expect(appended.definition.versions.find(version => version.id === appended.versionId)?.apiVersion).toBe(appended.program.apiVersion)
  })

  it('候选还原到某个 v4 版本的原源码时得到当前接口的新版本，程序与记录的作者接口一致', async () => {
    const { definition } = await makeCodeMaterialDefinition(source(), compile, { ...publication, apiVersion: 4 })
    const legacy = definition.versions[0]
    // 先改一版再改回原源码：与 v4 那版源码完全相同。
    const changed = await appendCodeMaterialVersion(definition, source(.7), compile, documentCodeSourceResolver(), publication)
    const restored = await appendCodeMaterialVersion({ ...changed.definition, defaultVersionId: changed.versionId }, source(), compile, documentCodeSourceResolver(), publication)
    const version = restored.definition.versions.find(value => value.id === restored.versionId)!
    expect(restored.versionId).not.toBe(legacy.id)
    // 登记元数据时按这条核对（videoEditCodeState 的“源码语言版本与检查结果不一致”）。
    expect(version.apiVersion).toBe(CODE_AUTHOR_API_VERSION); expect(restored.program.apiVersion).toBe(version.apiVersion)
    expect(codeVersionContentKey(version)).not.toBe(codeVersionContentKey(legacy))
    // 源码和作者接口均未变化时，复用同一不可变版本。
    const again = await appendCodeMaterialVersion(restored.definition, source(), compile, documentCodeSourceResolver(), publication)
    expect(again.versionId).toBe(restored.versionId)
  })

  it('作者接口 v5 的代码可以声明片子数据参数；固定为 v4 时同一声明不通过', async () => {
    const film = `export default {name:"片子",kind:"generator",params:[{key:"film",type:"scene",title:"片子数据",schema:${JSON.stringify(GOLDEN_SCENE_DECLARATION)}}],draw(){}}`
    const { definition, program } = await makeCodeMaterialDefinition(film, compile, { ...publication, apiVersion: 5 })
    expect(definition.versions[0].apiVersion).toBe(5)
    expect(program.parameters[0]).toMatchObject({ key: 'film', type: 'scene', default: null })
    await expect(makeCodeMaterialDefinition(film, compile, { ...publication, apiVersion: 4 })).rejects.toThrow('film.type')
  })
})

describe('剪辑源码文件引用契约', () => {
  it('显式指定 v6 库却按 v5 编译时在写入前拒绝；旧版本升级不修改历史记录', async () => {
    const write = vi.fn(publication.write)
    await expect(makeCodeMaterialDefinition(source(), compile, { ...publication, write, apiVersion: 5, libraries: { 'henji-layout': '1.0.0' } })).rejects.toThrow(/作者接口 v6/)
    expect(write).not.toHaveBeenCalled()
    const legacy = await makeCodeMaterialDefinition(source(), compile, { ...publication, apiVersion: 5, libraries: { three: '0.186.1' } })
    const before = structuredClone(legacy.definition)
    const next = await appendCodeMaterialVersion(legacy.definition, source(.7), compile, documentCodeSourceResolver(), publication)
    expect(next.definition.versions[0]).toEqual(before.versions[0])
    expect(legacy.definition).toEqual(before)
  })
  it('内置库只在新版本也编译为 v5 时沿用；明确带库却编出 v4 时报出可照着改的原因', async () => {
    // 源码里带 /*v5*/ 的按作者接口 v5 编译，其余按 v4。
    const byApi: CodeSourceCompiler = async files => ({ ...await compile(files), apiVersion: files.files[files.entry].includes('/*v5*/') ? 5 : 4 })
    const libraries = { three: '0.186.1' }
    const { definition } = await makeCodeMaterialDefinition(`import "three";${source()}/*v5*/`, byApi, { ...publication, libraries })
    expect(definition.versions[0].libraries).toEqual(libraries)
    const v5 = await appendCodeMaterialVersion(definition, `import "three";${source(.6)}/*v5*/`, byApi, documentCodeSourceResolver(), publication)
    expect(v5.definition.versions.find(version => version.id === v5.versionId)?.libraries).toEqual(libraries)
    const v4 = await appendCodeMaterialVersion(definition, source(.7), byApi, documentCodeSourceResolver(), publication)
    expect(v4.definition.versions.find(version => version.id === v4.versionId)).not.toHaveProperty('libraries')
    await expect(makeCodeMaterialDefinition(source(), byApi, { ...publication, libraries })).rejects.toThrow('从作者接口 v5 起可用，这份源码编译出的是 v4')
  })
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
    expect(definitions[0].versions[0].files).toEqual(definition.versions[0].files)
    expect(definitions[0].versions[0]).not.toHaveProperty('result')
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
  it('默认版本读不到时用其他历史版本核对种类；全部读不到才放行并标明未核对', async () => {
    const { definition: first } = await makeCodeMaterialDefinition(source(), compile, publication)
    const second = await appendCodeMaterialVersion(first, source(.7), compile, documentCodeSourceResolver(), publication)
    const definition = { ...second.definition, defaultVersionId: second.versionId }
    const failing = (...defaults: string[]) => async (files: CodeMaterialFiles) => {
      if (Object.values(files.files).some(text => defaults.some(value => text.includes(`default:${value},`)))) throw new Error('模拟旧版本编译失败')
      return compile(files)
    }
    const filter = 'export default {name:"滤镜",kind:"filter",mode:"static",width:3840,height:2160,durationSeconds:10,params:[],createWebGPU(){return {draw(){}}}}'
    await expect(appendCodeMaterialVersion(definition, filter, failing('0.7'), documentCodeSourceResolver(), publication)).rejects.toThrow('不能在同一定义中互换')
    expect(await appendCodeMaterialVersion(definition, source(.9), failing('0.7'), documentCodeSourceResolver(), publication)).not.toHaveProperty('kindUnverified')
    expect(await appendCodeMaterialVersion(definition, source(.9), failing('0.5', '0.7'), documentCodeSourceResolver(), publication)).toMatchObject({ kindUnverified: true })
  })
})
