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
import { withFileLock } from '../fs/file-lock'
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
  /** Only files created by this process can be compensated; never infer ownership from a path. */
  private readonly pending = new Map<string, { root: string; files: CodeFileReference[]; owned: string[]; directory: string; directories: string[]; marker?: string }>()
  async discard(request: DiscardCodeFilesRequest): Promise<void> {
    const groups = [...new Set(request.files.map(file => this.pending.get(file.location)).filter(value => value !== undefined))]
    if (!groups.length) return
    const retained = new Set(request.retainedLocations.map(value => path.resolve(value).toLocaleLowerCase()))
    const visit = (value: unknown): void => {
      if (typeof value === 'string' && path.isAbsolute(value)) retained.add(path.resolve(value).toLocaleLowerCase())
      else if (Array.isArray(value)) value.forEach(visit)
      else if (value && typeof value === 'object') Object.values(value).forEach(visit)
    }
    // Fail closed if any saved document cannot be inspected, including documents in other projects.
    // Folder documents (web recordings) have no envelope content and never reference code files.
    for (const row of this.workspace.catalog.listDocuments({ includeDrafts: true, includeMissing: true })) {
      if (this.kinds.get(row.kind)?.storage === 'folder') continue
      visit((await this.repository.read({ id: row.id, path: row.path })).content)
    }
    for (const root of new Set(groups.map(group => group.root))) await this.exclusive(root, async () => {
      const requested = new Set(request.files.map(file => file.location))
      const libraryRoot = path.join(root, '代码', '组件库')
      for (const directory of await fsp.readdir(libraryRoot, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })) {
        if (!directory.isDirectory() || directory.isSymbolicLink()) continue
        for (const entry of await fsp.readdir(path.join(libraryRoot, directory.name))) {
          const location = path.join(libraryRoot, directory.name, entry)
          if (!entry.endsWith('.ts') || requested.has(location)) continue
          await this.safe(root, location)
          const { metadata } = componentSourceMetadata(await fsp.readFile(location, 'utf8'))
          for (const group of groups) if (group.files.some(file => metadata.imports.some(pin => pin.hash === file.hash))) group.files.forEach(file => retained.add(path.resolve(file.location).toLocaleLowerCase()))
        }
      }
      // A retained parent also protects dependencies included in this compensation batch.
      for (let changed = true; changed;) {
        changed = false
        for (const group of groups) if (group.files.some(file => retained.has(path.resolve(file.location).toLocaleLowerCase()))) {
          for (const file of group.files.filter(file => file.location.includes(`${path.sep}组件库${path.sep}`))) {
            const { metadata } = componentSourceMetadata(await fsp.readFile(file.location, 'utf8'))
            for (const child of groups) if (child.files.some(file => metadata.imports.some(pin => pin.hash === file.hash))) for (const file of child.files) {
              const key = path.resolve(file.location).toLocaleLowerCase()
              if (!retained.has(key)) { retained.add(key); changed = true }
            }
          }
        }
      }
      const removed: typeof groups = []
      for (const group of groups.filter(group => group.root === root)) {
        if (!group.files.some(file => this.pending.get(file.location) === group)) continue
        if (group.files.some(file => retained.has(path.resolve(file.location).toLocaleLowerCase()))) continue
        if (group.files.some(file => !request.files.some(candidate => candidate.location === file.location && candidate.hash === file.hash))) continue
        // 补偿只能删除本次写入且内容未变的文件；磁盘上的后续编辑属于用户。
        const unchanged = await Promise.all(group.files.map(async file => digest(await this.read(file)) === file.hash))
        if (unchanged.some(value => !value)) continue
        await this.removeOwned(group)
        group.files.forEach(file => this.pending.delete(file.location)); removed.push(group)
      }
      for (const group of removed) await this.removeOwned({ ...group, owned: [] })
    })
  }
  private async removeOwned(group: { root: string; owned: string[]; directory: string; directories: string[]; marker?: string }): Promise<void> {
    const parents = new Set(group.directories.filter(directory => directory !== path.join(group.root, '代码')))
    if (group.marker) parents.add(path.dirname(group.marker))
    for (const file of [...group.owned].reverse()) {
      await this.safe(group.root, file)
      await fsp.unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error })
    }
    for (const directory of [...parents].sort((a, b) => b.length - a.length)) {
      await this.safe(group.root, path.join(directory, '.probe'))
      if (group.marker && path.dirname(group.marker) === directory) {
        const entries = await fsp.readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error })
        if (entries.length === 1 && entries[0] === '.definition') await fsp.unlink(group.marker)
      }
      await fsp.rmdir(directory).catch(error => { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error })
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
    const location = path.resolve(file.location)
    const roots = [this.workspace.layout().root, ...this.workspace.catalog.listProjects().filter(project => !project.missing).map(project => project.path)]
    const root = roots.filter(root => isPathInside(this.workspace.style, path.join(root, '代码'), location)).sort((a, b) => b.length - a.length)[0]
    if (!path.isAbsolute(file.location) || !root) throw new Error(`${file.path} 的源码位置无效，请重新打开原项目。`)
    try {
      await this.safe(root, location)
      const stat = await fsp.stat(location)
      if (!stat.isFile() || stat.size > CODE_AUTHOR_SOURCE_MAX_BYTES) throw new Error(`${file.path} 不是可读取的源码文件或超过16MiB，请恢复原文件。`)
      const bytes = await fsp.readFile(location); const hash = createHash('sha256').update(bytes).digest('hex')
      if (hash !== file.hash) this.logger.debug('使用磁盘中的代码源码', { event: 'documents.code.content.changed', context: { file: file.path } })
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
      const group = { root, files: [] as CodeFileReference[], owned: [] as string[], directory: '', directories: [] as string[], marker: undefined as string | undefined }
      try {
      let folder = request.folder
      if (folder && (folder !== codeFolderName(folder) || folder === '组件库')) throw new Error('素材目录越界或名称无效。')
      if (!folder) {
        const stem = codeFolderName(request.name) === '组件库' ? '组件库素材' : codeFolderName(request.name)
        for (let suffix = 1; ; suffix++) {
          const candidate = suffix === 1 ? stem : `${stem} (${suffix})`
          const directory = path.join(root, '代码', candidate)
          await this.safe(root, path.join(root, '代码', '.probe'), true, group.directories)
          await this.safe(root, path.join(directory, '.definition'))
          try { await fsp.mkdir(directory); group.directories.push(directory); folder = candidate; break } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
            const owner = await fsp.readFile(path.join(directory, '.definition'), 'utf8').catch(() => '')
            if (owner === request.definitionId) { folder = candidate; break }
          }
        }
      }
      const directory = path.join(root, '代码', folder)
      group.directory = directory
      await this.safe(root, path.join(directory, '.definition'), true, group.directories)
      const owner = await fsp.readFile(path.join(directory, '.definition'), 'utf8').catch(() => null)
      if (owner !== null && owner !== request.definitionId) throw new Error('素材目录属于另一份代码定义，请重新创建素材。')
      if (owner === null) {
        const document = await this.repository.read(request.target)
        const content = document.content as { codeMaterials?: { id: string; folder?: string }[] }
        if (request.folder && !content.codeMaterials?.some(definition => definition.id === request.definitionId && definition.folder === folder)) throw new Error('素材目录不属于此代码定义。')
        await createFileExclusively(path.join(directory, '.definition'), Buffer.from(request.definitionId))
        group.marker = path.join(directory, '.definition')
      }
      const entries = await fsp.readdir(directory); let ordinal = entries.reduce((max, entry) => Math.max(max, /^v\d+$/.test(entry) ? Number(entry.slice(1)) : 0), 0) + 1
      let versionRoot: string
      for (;;) { versionRoot = path.join(directory, `v${ordinal}`); try { await fsp.mkdir(versionRoot); group.directories.push(versionRoot); break } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; ordinal++ } }
      group.directory = versionRoot
      const files = group.files
      for (const [file, source] of Object.entries(request.contents.files)) {
        codeFilePathSchema.parse(file); const location = path.join(versionRoot, ...file.split('/'))
        await this.safe(root, location, true, group.directories)
        await createFileExclusively(location, Buffer.from(source, 'utf8'))
        group.owned.push(location)
        files.push({ path: file, location, hash: digest(source) })
      }
      for (const file of files) this.pending.set(file.location, group)
      return { folder, files }
      } catch (error) {
        await this.removeOwned(group)
        throw error
      }
    })
  }
  private async exclusive<T>(root: string, operation: () => Promise<T>): Promise<T> {
    this.logger.info('代码文件写入开始', { event: 'documents.code.write.start' })
    try {
      const internal = await this.workspace.ensureInternalFolder(root)
      const result = await withFileLock(path.join(internal, 'code-files.lock'), operation)
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
        if (expected !== hash) this.logger.debug('使用磁盘中的项目组件', { event: 'documents.code.component.changed', context: { file } })
        const { metadata } = componentSourceMetadata(source)
        records.push({ location, source, hash, previousHash: expected, name: directory.name, metadata })
      }
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
      const withdrawn = `${record.location}.withdrawn`; await this.safe(root, withdrawn)
      if (await fsp.stat(withdrawn).catch(() => null)) continue
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
      const versions = library.find(component => component.name === name)?.versions ?? []; let version = (versions.at(-1)?.version ?? 0) + 1
      const directory = path.join(root, '代码', '组件库', name)
      const group = { root, files: [] as CodeFileReference[], owned: [] as string[], directory, directories: [] as string[] }
      try {
      await this.safe(root, path.join(directory, '.probe'), true, group.directories)
      for (const entry of await fsp.readdir(directory)) {
        const match = /^v(\d+)\.ts(?:\.sha256)?$/.exec(entry)
        if (match) version = Math.max(version, Number(match[1]) + 1)
      }
      const location = path.join(root, '代码', '组件库', name, `v${version}.ts`)
      const source = packageComponentSource(request.source, { name, version, exports: request.exports, description: request.description, imports: request.imports.map(({ name, version, hash }) => ({ name, version, hash })) })
      if (Buffer.byteLength(source, 'utf8') > CODE_AUTHOR_SOURCE_MAX_BYTES) throw new Error('项目组件含说明的源码文件超过16MiB，请拆分为多个组件。')
      await this.safe(root, location, true, group.directories)
      await createFileExclusively(`${location}.sha256`, Buffer.from(digest(source)))
      group.owned.push(`${location}.sha256`)
      await createFileExclusively(location, Buffer.from(source, 'utf8'))
      group.owned.push(location)
      group.files.push({ path: path.basename(location), location, hash: digest(source) })
      this.pending.set(location, group)
      return { name, version, location, hash: digest(source), imports: request.imports, source, exports: request.exports, description: request.description }
      } catch (error) { await this.removeOwned(group); throw error }
    })
  }
  async withdraw(request: WithdrawCodeComponentRequest): Promise<void> {
    const root = await this.root(request.target)
    await this.exclusive(root, async () => {
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
