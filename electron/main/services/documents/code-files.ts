import { createHash } from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { DocumentTarget } from '../../../../src/core/documents/types'
import type { DocumentKindRegistry } from '../../../../src/core/documents/kinds'
import { CODE_AUTHOR_SOURCE_MAX_BYTES, codeFilePathSchema, componentFileReferences, type CodeComponentPin, type CodeFileReference } from '../../../../src/core/videoEdit/codeMaterial/sources'
import { componentSourceMetadata, packageComponentSource, type CodeComponent, type CodeComponentVersion } from '../../../../src/core/videoEdit/codeMaterial/components'
import type { DiscardCodeFilesRequest, PublishCodeComponentRequest, WriteCodeVersionRequest, WithdrawCodeComponentRequest } from '../../../../src/core/videoEdit/codeMaterial/storageContract'
import { isPathInside, type PathStyle } from '../../../../src/core/storage/pathSyntax'
import { sameEntryName } from '../../../../src/core/documents/naming'
import { createFileExclusively } from '../fs/no-overwrite'
import { CodeGitRepository } from './code-git'
import { gitCodeLocation, parseGitCodeLocation } from '../../../../src/core/storage/gitCodeLocation'
import type { MainLogger } from '../logging/main-logger'
import type { DocumentWorkspace } from './workspace'
import type { DocumentRepository } from './repository'

const digest = (source: string): string => createHash('sha256').update(source, 'utf8').digest('hex')
export function codeFolderName(name: string): string {
  const value = [...name].map(character => character.charCodeAt(0) < 32 ? '_' : character).join('').replace(/[<>:"/\\|?*]/g, '_').replace(/[. ]+$/, '').trim() || '代码素材'
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value) ? `_${value}` : value
}
/** Shared code path boundary for publication and container transfers. */
export async function ensureCodeLocation(root: string, target: string, style: PathStyle, create = false, created?: string[]): Promise<void> {
  const codeRoot = path.join(root, '代码')
  if (!isPathInside(style, codeRoot, target) || target === codeRoot) throw new Error('代码文件位置越界，必须位于此文档所在项目的“代码”文件夹内。')
  // Check each existing ancestor before mkdir/open, including junctions and symbolic links.
  const relative = path.relative(root, target); let current = root
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part)
    const stat = await fsp.lstat(current).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error })
    if (stat?.isSymbolicLink()) throw new Error('代码文件位置包含链接，不能写入或读取项目之外的文件。')
    if (!stat && create && current !== target) { await fsp.mkdir(current); created?.push(current) }
  }
  const realRoot = await fsp.realpath(root); const parent = await fsp.realpath(path.dirname(target)).catch(() => null)
  if (parent && !isPathInside(style, realRoot, parent)) throw new Error('代码文件真实位置越界，请移除指向项目外的链接。')
}

/** Ordinary visible text files; the existing document container and exclusive-file primitive own I/O. */
export class DocumentCodeFiles {
  private readonly cache = new Map<string, { source: string; bytes: number }>()
  private cacheBytes = 0
  /** Compensation retains immutable objects. Only component discovery is withdrawn. */
  private readonly pending = new Map<string, { root: string; component: boolean }>()
  async discard(request: DiscardCodeFilesRequest): Promise<void> {
    const retained = new Set(request.retainedLocations)
    const visit = (value: unknown): void => {
      if (typeof value === 'string') retained.add(value)
      else if (Array.isArray(value)) value.forEach(visit)
      else if (value && typeof value === 'object') Object.values(value).forEach(visit)
    }
    for (const row of this.workspace.catalog.listDocuments({ includeDrafts: true, includeMissing: true })) {
      if (this.kinds.get(row.kind)?.storage === 'folder') continue
      const saved = await this.repository.read({ id: row.id, path: row.path }).catch(error => {
        this.logger.warn('文档无法检查，保留代码发布', { event: 'documents.code.discard_kept', error }); return null
      })
      if (!saved) return
      visit(saved.content)
    }
    for (const file of request.files) {
      const owned = this.pending.get(file.location)
      if (!owned || retained.has(file.location)) continue
      if (owned.component) await this.exclusive(owned.root, () => new CodeGitRepository(path.join(owned.root, '代码')).withdrawLocked(file.location, file.hash))
      this.pending.delete(file.location)
    }
  }
  constructor(private readonly workspace: DocumentWorkspace, private readonly repository: DocumentRepository, private readonly logger: MainLogger,
    private readonly kinds: Pick<DocumentKindRegistry, 'get'>) {}
  private async root(target: DocumentTarget): Promise<string> {
    const read = await this.repository.read(target)
    return (await this.workspace.resolveContainer(read.meta.container)).root
  }
  private async safe(root: string, target: string, create = false, created?: string[]): Promise<void> {
    await ensureCodeLocation(root, target, this.workspace.style, create, created)
  }
  async read(file: CodeFileReference): Promise<string> {
    const reference = parseGitCodeLocation(file.location)
    if (reference) {
      const roots = [this.workspace.layout().root, ...this.workspace.catalog.listProjects().filter(project => !project.missing).map(project => project.path)]
      const root = roots.find(root => path.resolve(reference.repository) === path.join(root, '代码'))
      if (!root) throw new Error(`${file.path} 的源码位置无效，请重新打开原项目。`)
      try { return await new CodeGitRepository(reference.repository).read(file.location, file.hash) }
      catch (error) { this.logger.warn('源码版本读取失败', { event: 'documents.code.read.failed', error, context: { file: file.path } }); throw error }
    }
    const location = path.resolve(file.location)
    const roots = [this.workspace.layout().root, ...this.workspace.catalog.listProjects().filter(project => !project.missing).map(project => project.path)]
    const root = roots.filter(root => isPathInside(this.workspace.style, path.join(root, '代码'), location)).sort((a, b) => b.length - a.length)[0]
    if (!path.isAbsolute(file.location) || !root) throw new Error(`${file.path} 的源码位置无效，请重新打开原项目。`)
    try {
      await this.safe(root, location)
      const stat = await fsp.stat(location)
      if (!stat.isFile() || stat.size > CODE_AUTHOR_SOURCE_MAX_BYTES) throw new Error(`${file.path} 不是可读取的源码文件或超过16MiB，请恢复原文件。`)
      const bytes = await fsp.readFile(location); const hash = createHash('sha256').update(bytes).digest('hex')
      if (hash !== file.hash) throw new Error(`${file.path} 的源码内容校验失败，请从项目备份恢复原版本后重试。`)
      const known = this.cache.get(hash)
      const source = known?.source ?? new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
      if (known) this.cache.delete(hash)
      else this.cacheBytes += source.length * 2 + hash.length * 2 + 96
      this.cache.set(hash, known ?? { source, bytes: source.length * 2 + hash.length * 2 + 96 })
      while (this.cacheBytes > 32 * 1024 ** 2) {
        const oldest = this.cache.keys().next().value!; this.cacheBytes -= this.cache.get(oldest)!.bytes; this.cache.delete(oldest)
      }
      return source
    } catch (error) {
      this.logger.warn('源码文件读取失败', { event: 'documents.code.read.failed', error, context: { file: file.path } })
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`${file.path} 的源码文件缺失，请从项目备份恢复到原位置后重新打开剪辑。`)
      if (['EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw new Error(`${file.path} 的源码文件无法读取，请检查项目文件夹权限后重试。`)
      throw error
    }
  }
  async writeVersion(request: WriteCodeVersionRequest): Promise<{ folder: string; files: CodeFileReference[] }> {
    const root = await this.root(request.target)
    return this.exclusive(root, async () => {
      for (const file of Object.keys(request.contents.files)) codeFilePathSchema.parse(file)
      const repository = new CodeGitRepository(path.join(root, '代码'))
      let folder = request.folder
      if (folder && (folder !== codeFolderName(folder) || ['组件库', '.', '..'].includes(folder))) throw new Error('素材目录越界或名称无效。')
      const stem = codeFolderName(request.name)
      for (let suffix = 1; ; suffix++) {
        const candidate = folder ?? (suffix === 1 ? stem : `${stem} (${suffix})`)
        const marker = path.join(root, '代码', '素材', candidate, '.definition')
        await this.safe(root, marker)
        const owner = await fsp.readFile(marker, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error })
        if (owner && owner !== request.definitionId) {
          if (folder) throw new Error('素材目录属于另一份代码定义，请重新创建素材。')
          continue
        }
        if (folder && owner === null) {
          const content = (await this.repository.read(request.target)).content as { codeMaterials?: { id: string; folder?: string }[] }
          if (!content.codeMaterials?.some(definition => definition.id === request.definitionId && definition.folder === folder)) throw new Error('素材目录不属于此代码定义。')
        }
        folder = candidate; break
      }
      const versions = (await repository.versions('素材')).filter(value => value.name === folder)
      const legacyDirectory = path.join(root, '代码', folder)
      await this.safe(root, path.join(legacyDirectory, '.probe'))
      const legacy = await fsp.readdir(legacyDirectory).catch(error => { if (error.code === 'ENOENT') return []; throw error })
      const ordinal = Math.max(0, ...versions.map(value => value.version), ...legacy.map(value => /^v\d+$/.test(value) ? Number(value.slice(1)) : 0)) + 1
      const result = await repository.writeLocked({ kind: '素材', name: folder, version: ordinal, files: { ...request.contents.files, '.definition': request.definitionId } })
      const files = result.files.filter(file => file.path !== '.definition')
      for (const file of files) this.pending.set(file.location, { root, component: false })
      return { folder, files }
    })
  }
  private async exclusive<T>(root: string, operation: () => Promise<T>): Promise<T> {
    this.logger.info('代码文件写入开始', { event: 'documents.code.write.start' })
    try {
      await this.workspace.ensureInternalFolder(root)
      const result = await new CodeGitRepository(path.join(root, '代码')).exclusive(operation)
      this.logger.info('代码文件写入完成', { event: 'documents.code.write.completed' }); return result
    } catch (error) { this.logger.warn('代码文件写入失败', { event: 'documents.code.write.failed', error }); throw error }
  }
  async list(target: DocumentTarget): Promise<CodeComponent[]> {
    const root = await this.root(target); const library = path.join(root, '代码', '组件库')
    const directories = await fsp.readdir(library, { withFileTypes: true }).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error })
    const records: Array<{ location: string; source: string; hash: string; previousHash: string | null; name: string; metadata: ReturnType<typeof componentSourceMetadata>['metadata'] }> = []
    for (const directory of directories) {
      if (!directory.isDirectory() || directory.isSymbolicLink()) continue
      for (const file of await fsp.readdir(path.join(library, directory.name))) {
        if (!/^v\d+(?: \(\d+\))?\.ts$/.test(file)) continue
        const location = path.join(library, directory.name, file); await this.safe(root, location)
        const stat = await fsp.stat(location); if (stat.size > CODE_AUTHOR_SOURCE_MAX_BYTES) throw new Error('项目组件源码超过16MiB，请恢复原文件。')
        const source = await fsp.readFile(location, 'utf8'); const hash = digest(source)
        const integrity = `${location}.sha256`; await this.safe(root, integrity)
        const expected = await fsp.readFile(integrity, 'utf8').catch(() => null)
        if (expected !== hash) throw new Error(`项目组件 ${directory.name} 内容校验失败，请恢复原组件后重试。`)
        const { metadata } = componentSourceMetadata(source)
        records.push({ location, source, hash, previousHash: expected, name: directory.name, metadata })
      }
    }
    const repository = new CodeGitRepository(path.join(root, '代码'))
    for (const version of await repository.versions('组件')) {
      const location = gitCodeLocation({ oid: version.oid, repository: repository.dir, filepath: `组件/${version.name}/main.ts` })
      const source = await repository.sourceAt(version.oid, `组件/${version.name}/main.ts`)
      const hash = digest(source)
      records.push({ location, source, hash, previousHash: hash, name: version.name, metadata: componentSourceMetadata(source).metadata })
    }
    const recordsByHash = new Map(records.map(record => [record.hash, record]))
    const pins = new Map<string, CodeComponentPin>()
    const pin = (record: typeof records[number], chain: string[]): CodeComponentPin => {
      if (chain.includes(record.hash) || chain.length >= 64) throw new Error('项目组件存在循环依赖或超出编译深度，请恢复原组件。')
      const key = `${record.location}:${record.hash}`; const known = pins.get(key); if (known) return known
      const result = { name: record.metadata.name, version: record.metadata.version, location: record.location, hash: record.hash, imports: record.metadata.imports.map(request => {
        // 依赖文件可以在外部编辑；旧校验文件只用于找到原位置，不作为接受源码的条件。
        const original = records.filter(value => value.previousHash === request.hash && value.metadata.name === request.name && value.metadata.version === request.version)
        const named = records.filter(value => value.metadata.name === request.name && value.metadata.version === request.version)
        const child = recordsByHash.get(request.hash) ?? (original.length === 1 ? original[0] : named.length === 1 ? named[0] : undefined)
        if (!child) throw new Error(`项目组件 ${record.metadata.name} 引用的 ${request.name}@${request.version} 缺失或无法唯一定位，请恢复原组件文件。`)
        return { ...pin(child, [...chain, record.hash]), name: request.name, version: request.version }
      }) }
      pins.set(key, result); return result
    }
    const groups = new Map<string, CodeComponentVersion[]>()
    for (const record of records) {
      if (parseGitCodeLocation(record.location)) { if (await repository.isWithdrawn(record.location)) continue }
      else { const withdrawn = `${record.location}.withdrawn`; await this.safe(root, withdrawn); if (await fsp.stat(withdrawn).catch(() => null)) continue }
      const versions = groups.get(record.name) ?? []; versions.push({ ...pin(record, []), name: record.name, source: record.source, exports: record.metadata.exports, description: record.metadata.description }); groups.set(record.name, versions)
    }
    return [...groups].map(([name, versions]) => ({ name, latestVersion: versions.reduce((latest, value) => Math.max(latest, value.version), 0), versions: versions.sort((a, b) => a.version - b.version) }))
  }
  async publish(request: PublishCodeComponentRequest): Promise<CodeComponentVersion> {
    const root = await this.root(request.target)
    return this.exclusive(root, async () => {
      const library = await this.list(request.target); let name = request.name
      const existing = library.find(component => sameEntryName(component.name, name))
      if (request.keepBoth && existing) for (let suffix = 2; ; suffix++) { const candidate = `${request.name} (${suffix})`; if (!library.some(component => sameEntryName(component.name, candidate))) { name = candidate; break } }
      else if (existing) name = existing.name
      for (const file of componentFileReferences(request.imports)) await this.read(file)
      const repository = new CodeGitRepository(path.join(root, '代码'))
      const versions = (await repository.versions('组件')).filter(value => value.name === name)
      const directory = path.join(root, '代码', '组件库', name)
      await this.safe(root, path.join(directory, '.probe'))
      const legacy = await fsp.readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error })
      const version = Math.max(0, ...versions.map(value => value.version), ...legacy.map(value => Number(/^v(\d+)\.ts/.exec(value)?.[1] ?? 0))) + 1
      const source = packageComponentSource(request.source, { name, version, exports: request.exports, description: request.description, imports: request.imports.map(({ name, version, hash }) => ({ name, version, hash })) })
      const stored = await repository.writeLocked({ kind: '组件', name, version, files: { 'main.ts': source } })
      const file = stored.files[0]
      this.pending.set(file.location, { root, component: true })
      return { name, version, location: file.location, hash: file.hash, imports: request.imports, source, exports: request.exports, description: request.description }
    })
  }
  async withdraw(request: WithdrawCodeComponentRequest): Promise<void> {
    const root = await this.root(request.target)
    await this.exclusive(root, async () => {
      if (parseGitCodeLocation(request.location)) { await new CodeGitRepository(path.join(root, '代码')).withdrawLocked(request.location, request.hash); return }
      const libraryRoot = path.join(root, '代码', '组件库')
      if (!isPathInside(this.workspace.style, libraryRoot, request.location)) throw new Error('只能撤回本项目的组件发布。')
      await this.safe(root, request.location)
      const source = await this.read({ path: path.basename(request.location), location: request.location, hash: request.hash })
      componentSourceMetadata(source)
      const marker = `${request.location}.withdrawn`; await this.safe(root, marker)
      if (!(await fsp.stat(marker).catch(() => null))) await createFileExclusively(marker, Buffer.from(request.hash))
    })
  }
}
