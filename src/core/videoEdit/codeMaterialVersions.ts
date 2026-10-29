import { CODE_AUTHOR_API_VERSION, CODE_AUTHOR_LIBRARIES_MIN_API_VERSION, codeMaterialDefinitionSchema } from './codeMaterialPersistence'
import type { CodeMaterialDefinition, CodeMaterialVersion } from './codeMaterialPersistence'
import { CodeMaterialError } from './codeMaterial/contract'
import type { CodeAuthorApiVersion, CodeAuthorProgram as CodeMaterialProgram } from './codeAuthorProgram'
import { addressCodeMaterialFiles, codeVersionContentKey, resolveCodeMaterialFiles, documentCodeSourceResolver, type CodeMaterialFiles, type CodeSourceResolver, type CodeComponentPin, type CodeFileReference } from './codeMaterial/sources'
import { expandPinnedCodeComponents } from './codeMaterial/components'
import { importedAuthorLibraries } from './codeMaterial/libraryImports'
import { authorLibraryCompatibilityError, latestAuthorLibraryVersions, authorLibraryVersion } from './codeMaterial/authorLibraries'

export type CodeSourceCompiler = (files: CodeMaterialFiles) => Promise<CodeMaterialProgram>
export interface CodeMaterialDefinitionResult { definition: CodeMaterialDefinition; program: CodeMaterialProgram }
/**
 * `libraries`：这一版明确要用的内置库（来自代码资产等）。`inheritedLibraries`：追加版本时前一个默认版本的内置库，
 * 没有明确给出时沿用，但只在新版本也编译为支持内置库的作者接口时才沿用。
 * `apiVersion`：固定按哪一版作者接口编译（代码资产按它记录的版本）；省略时新代码按当前作者接口编译。
 */
export interface CodeVersionPublication { imports: CodeComponentPin[]; name?: string; project?: { commit: string; entry: string }; libraries?: Readonly<Record<string, string>>; inheritedLibraries?: Readonly<Record<string, string>>; previousImports?: Readonly<Record<string, string>>; apiVersion?: CodeAuthorApiVersion; write(definitionId: string, name: string, files: CodeMaterialFiles, folder?: string): Promise<{ folder?: string; files: CodeFileReference[] }> }
const inheritedLibraries = (publication: Pick<CodeVersionPublication, 'libraries' | 'inheritedLibraries'>): Readonly<Record<string, string>> | undefined => publication.inheritedLibraries && Object.keys(publication.inheritedLibraries).length ? publication.inheritedLibraries : undefined
const explicitLibraries = (publication: Pick<CodeVersionPublication, 'libraries' | 'inheritedLibraries'>): Readonly<Record<string, string>> | undefined => publication.libraries && Object.keys(publication.libraries).length ? publication.libraries : undefined
/**
 * 编译出结果后才能决定新版本用哪些内置库：作者接口不够时，明确给出的库给出可照着改的报错，沿用的库直接不带。
 * 只记录编译产物实际使用的库，未导入的登记项不参与源码版本身份。
 */
function versionLibraries(publication: CodeVersionPublication, program: CodeMaterialProgram): Readonly<Record<string, string>> | undefined {
  const explicit = explicitLibraries(publication)
  const supported = program.apiVersion >= CODE_AUTHOR_LIBRARIES_MIN_API_VERSION
  if (explicit && !supported) throw new CodeMaterialError('COMPATIBILITY', `内置库（${Object.keys(explicit).join('、')}）从作者接口 v${CODE_AUTHOR_LIBRARIES_MIN_API_VERSION} 起可用，这份源码编译出的是 v${program.apiVersion}：请按 v${CODE_AUTHOR_LIBRARIES_MIN_API_VERSION} 编写源码，或不再使用内置库。`)
  for (const [library, version] of Object.entries(explicit ?? program.bundle.libraries ?? {})) {
    const error = authorLibraryCompatibilityError(library, version, program.apiVersion)
    if (error) throw new CodeMaterialError('COMPATIBILITY', error)
  }
  if (!supported) return undefined
  const used = program.bundle.libraries
  return used && Object.keys(used).length ? used : undefined
}
/** 对每个源码导入，明确版本优先，其次继承记录或历史缺省，最后才选兼容最新版。 */
export function codeVersionCompilation(files: CodeMaterialFiles, publication: Partial<CodeVersionPublication>): CodeMaterialFiles {
  const apiVersion = publication.apiVersion ?? CODE_AUTHOR_API_VERSION
  const choices = { ...latestAuthorLibraryVersions(apiVersion), ...publication.previousImports, ...inheritedLibraries(publication), ...explicitLibraries(publication) }
  const libraries = importedAuthorLibraries({ ...files, libraries: choices })
  return { ...files, apiVersion, libraries }
}
export function codeVersionInheritance(version: CodeMaterialVersion, resolver: CodeSourceResolver): Pick<CodeVersionPublication, 'inheritedLibraries' | 'previousImports'> {
  let previousImports: Readonly<Record<string, string>> = {}
  try { previousImports = importedAuthorLibraries({ ...expandPinnedCodeComponents(resolveCodeMaterialFiles(version, resolver), version.imports ?? [], resolver), libraries: version.libraries }) } catch { /* 源码缺失仍可保存修复版本，已记录的库继续保留。 */ }
  return { inheritedLibraries: version.libraries, previousImports }
}
/** Hash-addressed source is stored separately; IR is rebuildable cache. */
export async function makeCodeMaterialDefinition(source: string | CodeMaterialFiles, compile: CodeSourceCompiler, publication: CodeVersionPublication, identity?: { id: string; folder?: string }): Promise<CodeMaterialDefinitionResult> {
  const addressed = await addressCodeMaterialFiles(source)
  const contents = resolveCodeMaterialFiles(addressed, documentCodeSourceResolver())
  const program = await compile(codeVersionCompilation(expandPinnedCodeComponents(contents, publication.imports, documentCodeSourceResolver()), publication))
  const id = identity?.id ?? crypto.randomUUID(); const name = publication.name ?? program.name
  const libraries = versionLibraries(publication, program)
  const stored = await publication.write(id, name, contents, identity?.folder)
  const version = { id: crypto.randomUUID(), apiVersion: program.apiVersion, languageVersion: program.languageVersion, entry: addressed.entry, files: stored.files, ...(publication.project ? { project: publication.project } : {}), ...(publication.imports.length ? { imports: publication.imports } : {}), ...(libraries ? { libraries: { ...libraries } } : {}) }
  const definition = codeMaterialDefinitionSchema.parse({ id, name, ...(stored.folder ? { folder: stored.folder } : {}), defaultVersionId: version.id, versions: [version] })
  return { definition, program }
}
/** 历史源码由解析器读取，版本比较不能依赖素材目录的位置。 */
export async function appendCodeMaterialVersion(definition: CodeMaterialDefinition, source: string | CodeMaterialFiles, compile: CodeSourceCompiler, resolver: CodeSourceResolver, publication: CodeVersionPublication): Promise<CodeMaterialDefinitionResult & { versionId: string; kindUnverified?: true }> {
  const previousVersion = definition.versions.find(version => version.id === definition.defaultVersionId)
  if (!previousVersion) throw new CodeMaterialError('COMPATIBILITY', '固定代码版本不存在。')
  // 原有版本用来核对种类与语言版本。默认版本源码缺失或编译不过时依次改用其他历史版本，
  // 不挡住新版本；全部读不到才不核对种类（kindUnverified），由调用方记录。取消会在随后编译新版本时照常抛出。
  let previous: CodeMaterialProgram | undefined
  for (const version of [previousVersion, ...definition.versions.filter(value => value !== previousVersion).reverse()]) {
    // 已有版本按它自己的记录编译，v4 记录照旧按 v4 读取。
    try { previous = await compile({ ...expandPinnedCodeComponents(resolveCodeMaterialFiles(version, resolver), version.imports ?? [], resolver), apiVersion: version.apiVersion as CodeAuthorApiVersion, ...(version.libraries ? { libraries: version.libraries } : {}) }) } catch { continue }
    if (previous.apiVersion !== version.apiVersion || previous.languageVersion !== version.languageVersion) throw new CodeMaterialError('COMPATIBILITY', '源码语言版本与固定版本不一致。')
    break
  }
  const addressed = await addressCodeMaterialFiles(source)
  const versionPublication: CodeVersionPublication = { ...codeVersionInheritance(previousVersion, resolver), ...publication, name: definition.name, inheritedLibraries: publication.inheritedLibraries ?? previousVersion.libraries }
  // 内容键含内置库，而内置库要等编译出作者接口版本才定，所以已有版本在编译后、写文件前再找。
  const found: { version?: CodeMaterialVersion } = {}
  const result = await makeCodeMaterialDefinition(source, async files => {
    const program = await compile(files)
    if (previous && previous.kind !== program.kind) throw new CodeMaterialError('COMPATIBILITY', '生成素材与输入滤镜不能在同一定义中互换，请另建素材。')
    const key = codeVersionContentKey({ ...addressed, imports: publication.imports, libraries: versionLibraries(versionPublication, program), apiVersion: program.apiVersion })
    // 同源码的实际导入集合相同；只比较编译产物使用的库，排除未执行模块和被擦除的类型导入。
    found.version = definition.versions.find(version => codeVersionContentKey({ ...version, libraries: Object.fromEntries(Object.keys(program.bundle.libraries ?? {}).map(name => [name, authorLibraryVersion(name, version.libraries)!])) }) === key)
    return program
  }, { ...versionPublication, write: async (definitionId, name, files, folder) => found.version ? { files: found.version.files, folder: definition.folder! } : publication.write(definitionId, name, files, folder) }, definition)
  const version = result.definition.versions[0]
  const kind = previous ? {} : { kindUnverified: true as const }
  const existing = found.version
  if (existing) return { ...result, definition, versionId: existing.id, ...kind }
  return { ...result, definition: codeMaterialDefinitionSchema.parse({ ...definition, folder: result.definition.folder, versions: [...definition.versions, version] }), versionId: version.id, ...kind }
}
