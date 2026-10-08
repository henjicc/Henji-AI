import { getPlatform } from '@/platform/runtime'
import { installCodeSourceReader, rememberCodeSource, loadCodeSourceReferences, addressCodeMaterialFiles, resolveCodeMaterialFiles, type CodeMaterialFiles, type CodeComponentPin } from '@/core/videoEdit/codeMaterial/sources'
import { pinCodeComponentImports, expandPinnedCodeComponents, codeComponentExportNames, codeComponentNameSchema, componentSourceMetadata, rewriteCodeComponentImports, type CodeComponentVersion, type CodeComponent } from '@/core/videoEdit/codeMaterial/components'
import { assetCodeSourceResolver, type CodeAsset } from '@/core/videoEdit/codeAsset'
import { documentCodeSourceResolver } from '@/core/videoEdit/codeMaterial/sources'
import type { CodeVersionPublication } from '@/core/videoEdit/codeMaterialVersions'
import { compileVideoEditCode } from './videoEditCodeState'
import { listVideoEditInstances, requireVideoEditInstance, publishVideoEdit } from './videoEditService'
import { videoEditDocumentSchema } from '@/core/videoEdit/document'

installCodeSourceReader(file => getPlatform().documents.readCodeFile(file))
export async function projectCodeComponents(projectId: string): Promise<CodeComponent[]> {
  const owner = requireVideoEditInstance(projectId)
  const components = await getPlatform().documents.listCodeComponents({ id: projectId, path: owner.session.documentMeta.path })
  for (const component of components) for (const version of component.versions) rememberCodeSource(version.hash, version.source)
  return components
}
export async function withdrawProjectCodeComponents(projectId: string, versions: readonly CodeComponentPin[]): Promise<void> {
  const owner = requireVideoEditInstance(projectId)
  for (const version of [...versions].reverse()) await getPlatform().documents.withdrawCodeComponent({ target: { id: projectId, path: owner.session.documentMeta.path }, location: version.location, hash: version.hash })
  publishVideoEdit(true)
}
export async function prepareCodeVersionPublication(projectId: string, files: CodeMaterialFiles, name?: string, pinnedImports?: CodeComponentPin[]): Promise<CodeVersionPublication> {
  const owner = requireVideoEditInstance(projectId); const target = { id: projectId, path: owner.session.documentMeta.path }
  const imports = pinnedImports ?? pinCodeComponentImports(files, await projectCodeComponents(projectId))
  await loadCodeSourceReferences({ files: [], imports })
  return { imports, name, async write(definitionId, materialName, contents, folder) {
    const result = await getPlatform().documents.writeCodeVersion({ target, definitionId, name: materialName, contents, ...(folder ? { folder } : {}) })
    for (const file of result.files) rememberCodeSource(file.hash, contents.files[file.path])
    return result
  } }
}
/** Publishing never executes author JS; the same restricted AST/IR compiler checks the module. */
export async function publishProjectCodeComponent(projectId: string, input: { name: string; source: string; description?: string }, signal?: AbortSignal, keepBoth = false): Promise<CodeComponentVersion> {
  const name = codeComponentNameSchema.parse(input.name)
  const owner = requireVideoEditInstance(projectId); const baseline = owner.document
  const source = input.source.startsWith('// henji-component ') ? componentSourceMetadata(input.source).source : input.source
  const exports = codeComponentExportNames(source)
  const contents: CodeMaterialFiles = { entry: '__check.ts', files: { '__check.ts': 'export default {languageVersion:3,apiVersion:1,name:"组件检查",kind:"generator",mode:"static",width:16,height:16,durationSeconds:1,seed:1,parameters:{},render(ctx){return [];}}', 'component.ts': source } }
  const imports = pinCodeComponentImports(contents, await projectCodeComponents(projectId), name)
  await loadCodeSourceReferences({ files: [], imports }); signal?.throwIfAborted()
  await compileVideoEditCode(expandPinnedCodeComponents(contents, imports, documentCodeSourceResolver()), signal)
  signal?.throwIfAborted()
  if (requireVideoEditInstance(projectId) !== owner || owner.document !== baseline) throw new Error('发布检查期间剪辑已改变，请重新发布。')
  const result = await getPlatform().documents.publishCodeComponent({ target: { id: projectId, path: owner.session.documentMeta.path }, name, source, description: input.description ?? '', exports, imports, keepBoth })
  rememberCodeSource(result.hash, result.source); publishVideoEdit(true)
  return result
}
/** Removal is intentionally absent from the create-only public collection. Explain live usages on refusal. */
export function refuseCodeComponentRemoval(name: string, version?: number): never {
  const references = listVideoEditInstances().flatMap(owner => (owner.document.codeMaterials ?? []).flatMap(definition => definition.versions.flatMap(source => {
    const used = (pins: readonly CodeComponentPin[]): boolean => pins.some(pin => pin.name === name && (version === undefined || pin.version === version) || used(pin.imports))
    return used(source.imports ?? []) ? [`${owner.document.name} / ${definition.name}`] : []
  })))
  throw new Error(references.length ? `此组件版本仍被素材引用：${[...new Set(references)].join('、')}。请先移除引用；已发布源码不会自动删除。` : '删除整个项目组件需要单独的破坏性授权；此集合只开放读取和发布新版本，不能删除用户可见源码文件。')
}
export interface CodeComponentReference { materialRef: { kind: string; id: string; label: string }; documentName: string; componentVersion: number }
/** Saved unopened clips are included; the current in-memory document overrides its saved snapshot. */
export async function codeComponentReferences(projectId: string, name?: string, version?: number): Promise<CodeComponentReference[]> {
  const owner = requireVideoEditInstance(projectId); const container = owner.session.documentMeta.container
  const component = name === undefined ? undefined : (await projectCodeComponents(projectId)).find(component => component.name === name)
  const normalize = (location: string): string => location.replace(/\\/g, '/').toLocaleLowerCase()
  const location = component?.versions[0]?.location
  const folder = location ? normalize(location).slice(0, normalize(location).lastIndexOf('/') + 1) : undefined
  const open = listVideoEditInstances().filter(value => JSON.stringify(value.session.documentMeta.container) === JSON.stringify(container))
  const documents = new Map(open.map(value => [value.document.id, value.document]))
  for (const summary of await getPlatform().documents.listDocuments({ kind: 'video_edit', container, includeMissing: false })) {
    if (!documents.has(summary.id)) documents.set(summary.id, videoEditDocumentSchema.parse((await getPlatform().documents.readDocument({ id: summary.id, path: summary.path })).content))
  }
  const references = new Map<string, CodeComponentReference>()
  const used = (pins: readonly CodeComponentPin[]): CodeComponentPin[] => pins.flatMap(pin => [
    ...((name === undefined || (folder ? normalize(pin.location).startsWith(folder) : pin.name === name)) && (version === undefined || pin.version === version) ? [pin] : []), ...used(pin.imports),
  ])
  for (const document of documents.values()) for (const definition of document.codeMaterials ?? []) for (const source of definition.versions) for (const pin of used(source.imports ?? [])) {
    const id = `${document.id}:${definition.id}`
    references.set(`${id}:${pin.name}@${pin.version}`, { materialRef: { kind: 'video_edit.code_material', id, label: definition.name }, documentName: document.name, componentVersion: pin.version })
  }
  return [...references.values()]
}
export async function importAssetCodeComponents(projectId: string, asset: CodeAsset, signal?: AbortSignal): Promise<CodeAsset> {
  const resolver = assetCodeSourceResolver(asset); const imported = new Map<string, CodeComponentVersion>()
  const visit = async (pin: CodeComponentPin, chain: string[]): Promise<CodeComponentVersion> => {
    const key = `${pin.name}@${pin.version}:${pin.hash}`
    if (chain.includes(key)) throw new Error('代码资产组件存在循环依赖，不能导入。')
    if (chain.length >= 64) throw new Error('代码资产组件依赖超出编译深度。')
    const known = imported.get(key); if (known) return known
    const dependencies: CodeComponentVersion[] = []
    for (const child of pin.imports) dependencies.push(await visit(child, [...chain, key]))
    const { source, metadata } = componentSourceMetadata(resolver.read(pin.hash, pin.location, `@组件/${pin.name}`))
    const rewritten = rewriteCodeComponentImports(source, pin.imports, dependencies)
    const result = await publishProjectCodeComponent(projectId, { name: pin.name, source: rewritten, description: metadata.description }, signal, true)
    imported.set(key, result); return result
  }
  const imports: CodeComponentVersion[] = []
  try { for (const pin of asset.sourceVersion.imports ?? []) imports.push(await visit(pin, [])) }
  catch (error) { await withdrawProjectCodeComponents(projectId, [...imported.values()]); throw error }
  const contents = resolveCodeMaterialFiles(asset.sourceVersion, resolver)
  const files = Object.fromEntries(Object.entries(contents.files).map(([path, source]) => [path, rewriteCodeComponentImports(source, asset.sourceVersion.imports ?? [], imports)]))
  const addressed = await addressCodeMaterialFiles({ ...contents, files })
  const pin = (version: CodeComponentVersion): CodeComponentPin => ({ name: version.name, version: version.version, location: version.location, hash: version.hash, imports: version.imports })
  return { ...asset, sourceVersion: { ...asset.sourceVersion, entry: addressed.entry, files: addressed.files, imports: imports.map(pin) }, codeSources: [...addressed.codeSources, ...[...imported.values()].map(value => ({ hash: value.hash, source: value.source }))] }
}
