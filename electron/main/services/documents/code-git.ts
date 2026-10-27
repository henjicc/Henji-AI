import { createHash } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import git from 'isomorphic-git'
import { gitCodeLocation, parseGitCodeLocation } from '../../../../src/core/storage/gitCodeLocation'
import { withFileLock } from '../fs/file-lock'

export const codeDigest = (source: string | Uint8Array): string => createHash('sha256').update(source).digest('hex')
const author = { name: '痕迹AI', email: 'code@henji.local' }
const queues = new Map<string, Promise<unknown>>()
const MAX_SOURCE_BYTES = 16 * 1024 ** 2
const cache = new Map<string, { source: string; hash: string }>()
let cacheBytes = 0
const recovery = '代码仓库无法使用，请保留“代码”文件夹并从备份恢复仓库；未保存的源码不要删除。'
export interface GitCodeVersion { kind: '素材' | '组件'; name: string; version: number; oid: string; tag: string }
export interface GitCodeWrite { kind: GitCodeVersion['kind']; name: string; version: number; files: Record<string, string> }

/** Git rejects spaces and a handful of ref characters. Preserve readable Chinese names. */
export const codeVersionTag = (kind: GitCodeVersion['kind'], name: string, version: number): string => `${kind}/${name.replace(/[%\s~^:?*[\\/]/g, value => `%${value.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`).replace(/\.\./g, '%2E%2E').replace(/@\{/g, '%40%7B').replace(/^\./, '%2E')}@v${version}`

/** All Git operations stay in the main-process storage service; no executable Git is needed. */
export class CodeGitRepository {
  readonly dir: string
  constructor(directory: string) { this.dir = path.resolve(directory) }
  protected get options() { return { fs, dir: this.dir } }

  async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const key = process.platform === 'win32' ? this.dir.toLowerCase() : this.dir
    const previous = queues.get(key) ?? Promise.resolve()
    const pending = previous.catch(() => undefined).then(async () => {
      await this.safePath('.git/HEAD')
      await new CodeGitRepository(path.dirname(this.dir)).safePath('.henji/code-git.lock')
      return withFileLock(path.join(path.dirname(this.dir), '.henji', 'code-git.lock'), operation, { timeoutMs: 60_000 })
    })
    queues.set(key, pending)
    try { return await pending } finally { if (queues.get(key) === pending) queues.delete(key) }
  }

  /** Reject symlinks/junctions, including .git and object paths. */
  async safePath(relative: string): Promise<void> {
    if (!relative || relative.split('/').some(part => !part || part === '..' || part === '.' || /[\\:\0]/.test(part))) throw new Error('代码仓库路径越界。')
    let current = path.parse(this.dir).root
    for (const part of [...this.dir.slice(current.length).split(path.sep), ...relative.split('/')]) {
      current = path.join(current, part)
      const stat = await fsp.lstat(current).catch(error => { if (error.code === 'ENOENT') return null; throw error })
      if (stat?.isSymbolicLink()) throw new Error('代码仓库包含链接，请移除链接后重试。')
    }
  }

  async exists(): Promise<boolean> {
    await this.safePath('.git/HEAD')
    const stat = await fsp.stat(path.join(this.dir, '.git')).catch(error => { if (error.code === 'ENOENT') return null; throw error })
    if (stat && !stat.isDirectory()) throw new Error(recovery)
    return stat !== null
  }

  protected async initialize(): Promise<void> {
    if (await this.exists()) {
      if ((await fsp.readFile(path.join(this.dir, '.git', 'HEAD'), 'utf8')) !== 'ref: refs/heads/main\n') throw new Error('代码仓库分支已切换，请切回 main 后重试；已有版本仍可读取。')
      return
    }
    for (const folder of ['素材', '组件']) {
      const entries = await fsp.readdir(path.join(this.dir, folder)).catch(error => { if (error.code === 'ENOENT') return []; throw error })
      if (entries.some(name => name !== '.definition' && !/^v[1-9]\d*$/.test(name))) throw new Error(`${recovery} 工作区已经存在，但 Git 历史缺失，不能自动重建。`)
    }
    await fsp.mkdir(this.dir, { recursive: true })
    await git.init({ ...this.options, defaultBranch: 'main' })
  }

  async versions(kind?: GitCodeVersion['kind']): Promise<GitCodeVersion[]> {
    if (!(await this.exists())) return []
    const result: GitCodeVersion[] = []
    for (const tag of await git.listTags(this.options)) {
      const match = /^(素材|组件)\/(.+)@v([1-9]\d*)$/.exec(tag)
      if (!match || (kind && kind !== match[1])) continue
      await this.safePath(`.git/refs/tags/${tag}`)
      result.push({ kind: match[1] as GitCodeVersion['kind'], name: decodeURIComponent(match[2]), version: Number(match[3]), oid: await git.resolveRef({ ...this.options, ref: `refs/tags/${tag}` }), tag })
    }
    return result.sort((a, b) => a.version - b.version)
  }

  async files(oid: string, prefix = ''): Promise<string[]> {
    const result: string[] = []
    const visit = async (oid: string, directory: string): Promise<void> => {
      for (const entry of (await git.readTree({ ...this.options, oid })).tree) {
        const filepath = directory ? `${directory}/${entry.path}` : entry.path
        if (entry.type === 'tree') { if (!prefix || prefix.startsWith(`${filepath}/`) || filepath.startsWith(prefix) || filepath === prefix) await visit(entry.oid, filepath) }
        else if (entry.type === 'blob' && (!prefix || filepath.startsWith(`${prefix}/`))) result.push(filepath)
      }
    }
    await visit(oid, '')
    return result
  }

  async read(location: string, hash: string): Promise<string> { return this.readObject(location, hash) }

  private async readObject(location: string, expectedHash?: string): Promise<string> {
    const reference = parseGitCodeLocation(location)
    if (!reference || path.resolve(reference.repository) !== this.dir) throw new Error('代码版本不属于此仓库。')
    const mismatch = '代码版本内容校验失败，请从项目备份恢复；不会使用工作区文件替换已记录的版本。'
    const known = cache.get(location)
    if (known !== undefined) {
      if (expectedHash !== undefined && known.hash !== expectedHash) throw new Error(mismatch)
      cache.delete(location); cache.set(location, known); return known.source
    }
    try {
      await this.safePath('.git/objects')
      const { blob } = await git.readBlob({ ...this.options, oid: reference.oid, filepath: reference.filepath })
      if (blob.byteLength > MAX_SOURCE_BYTES) throw new Error('源码超过16MiB，请拆分文件。')
      const hash = codeDigest(blob)
      if (expectedHash !== undefined && hash !== expectedHash) throw new Error(mismatch)
      const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(blob)
      cache.set(location, { source, hash }); cacheBytes += (location.length + source.length + hash.length) * 2
      while (cacheBytes > 32 * 1024 ** 2) {
        const oldest = cache.keys().next().value!; const value = cache.get(oldest)!
        cacheBytes -= (oldest.length + value.source.length + value.hash.length) * 2; cache.delete(oldest)
      }
      return source
    } catch (error) { throw new Error(`${recovery} ${error instanceof Error ? error.message : String(error)}`, { cause: error }) }
  }

  async sourceAt(oid: string, filepath: string): Promise<string> {
    return this.readObject(gitCodeLocation({ repository: this.dir, oid, filepath }))
  }

  async isWithdrawn(location: string): Promise<boolean> {
    const reference = parseGitCodeLocation(location)
    if (!reference || path.resolve(reference.repository) !== this.dir) throw new Error('代码版本不属于此仓库。')
    return (await git.listTags(this.options)).includes(`撤回/${reference.oid}`)
  }

  async withdrawLocked(location: string, hash: string): Promise<void> {
    const reference = parseGitCodeLocation(location)
    if (!reference?.filepath.startsWith('组件/') || path.resolve(reference.repository) !== this.dir) throw new Error('只能撤回本项目的组件发布。')
    await this.read(location, hash)
    if (!(await this.isWithdrawn(location))) await git.tag({ ...this.options, ref: `撤回/${reference.oid}`, object: reference.oid })
  }

  /** Recover only bytes proven to belong to this legacy import or its previous HEAD. */
  async recoverImportLocked(input: GitCodeWrite): Promise<void> {
    await this.initialize()
    if ((await this.versions(input.kind)).some(version => version.tag === codeVersionTag(input.kind, input.name, input.version))) return
    const prefix = `${input.kind}/${input.name}/`
    const matrix = await git.statusMatrix(this.options)
    const changed = matrix.filter(([file, head, workdir, stage]) => (head !== 0 || stage !== 0 || file.startsWith(prefix)) && (head !== workdir || head !== stage))
    if (!changed.length) return
    const refused = '代码工作区有未提交的修改，无法确认属于中断的迁移，请先备份并处理修改后重试。'
    if (changed.some(([file]) => !file.startsWith(prefix))) throw new Error(refused)
    const head = await git.resolveRef({ ...this.options, ref: 'HEAD' }).catch(error => { if (error.code === 'NotFoundError') return null; throw error })
    const previous = new Map<string, Uint8Array | null>()
    const accepts = (file: string, bytes: Uint8Array | null) => {
      const wanted = input.files[file.slice(prefix.length)]
      const before = previous.get(file)!
      return (bytes === null ? wanted === undefined : wanted !== undefined && codeDigest(bytes) === codeDigest(wanted))
        || (bytes === null ? before === null : before !== null && codeDigest(bytes) === codeDigest(before))
    }
    for (const [file, tracked] of changed) {
      await this.safePath(file)
      previous.set(file, tracked && head ? (await git.readBlob({ ...this.options, oid: head, filepath: file })).blob : null)
      const bytes = await fsp.readFile(path.join(this.dir, file)).catch(error => { if (error.code === 'ENOENT') return null; throw error })
      if (!accepts(file, bytes)) throw new Error(refused)
    }
    // Staged edits may differ from the worktree: never discard unique user bytes in the index.
    await git.walk({ ...this.options, trees: [git.STAGE()], map: async (file, [entry]) => {
      if (!previous.has(file) || !entry || await entry.type() !== 'blob') return
      const oid = await entry.oid()
      if (oid && !accepts(file, (await git.readBlob({ ...this.options, oid })).blob)) throw new Error(refused)
    } })
    for (const [file, bytes] of previous) {
      if (bytes === null) {
        await fsp.unlink(path.join(this.dir, file)).catch(error => { if (error.code !== 'ENOENT') throw error })
        await git.remove({ ...this.options, filepath: file })
      } else {
        await fsp.mkdir(path.dirname(path.join(this.dir, file)), { recursive: true })
        await fsp.writeFile(path.join(this.dir, file), bytes)
        await git.add({ ...this.options, filepath: file })
      }
    }
  }

  /** Caller may hold exclusive across allocating an ordinal and committing it. */
  async writeLocked(input: GitCodeWrite): Promise<{ oid: string; files: Array<{ path: string; location: string; hash: string }> }> {
    if (!Number.isSafeInteger(input.version) || input.version < 1 || !input.name || /[/\\:\0]/.test(input.name) || ['.', '..', '.git'].includes(input.name.toLowerCase())) throw new Error('代码版本名称或序号无效。')
    const prefix = `${input.kind}/${input.name}`
    const entries = Object.entries(input.files)
    if (!entries.length) throw new Error('代码版本不能为空。')
    for (const [file, source] of entries) { await this.safePath(`${prefix}/${file}`); if (Buffer.byteLength(source) > MAX_SOURCE_BYTES) throw new Error('源码超过16MiB。') }
    await this.initialize()
    const tag = codeVersionTag(input.kind, input.name, input.version)
    let existing = (await this.versions(input.kind)).find(value => value.tag === tag)
    // A process can exit after publishing HEAD but before publishing its lightweight tag.
    // Recover only the matching last commit, and verify every byte before making it discoverable.
    if (!existing) {
      const head = await git.log({ ...this.options, depth: 1 }).catch(error => { if (error.code === 'NotFoundError') return []; throw error })
      if (head[0]?.commit.message.endsWith(`Henji-Code-Tag: ${tag}\n`)) existing = { ...input, tag, oid: head[0].oid }
    }
    const references = (oid: string) => entries.map(([file, source]) => ({ path: file, hash: codeDigest(source), location: gitCodeLocation({ oid, repository: this.dir, filepath: `${prefix}/${file}` }) }))
    if (existing) {
      const files = references(existing.oid)
      if ((await this.files(existing.oid, prefix)).length !== entries.length) throw new Error('同名代码版本已经存在且内容不同，不能覆盖历史。')
      for (const file of files) await this.read(file.location, file.hash)
      if (!(await git.listTags(this.options)).includes(tag)) await git.tag({ ...this.options, ref: tag, object: existing.oid })
      return { oid: existing.oid, files }
    }
    const oid = await this.commitFiles(prefix, input.files, `${input.kind}「${input.name}」第 ${input.version} 版\n\nHenji-Code-Tag: ${tag}`)
    await git.tag({ ...this.options, ref: tag, object: oid })
    return { oid, files: references(oid) }
  }

  /** Importing an older missing version must not leave it as the latest worktree. */
  async restoreLatestLocked(): Promise<void> {
    const latest = new Map<string, GitCodeVersion>()
    for (const version of await this.versions()) latest.set(`${version.kind}/${version.name}`, version)
    for (const [prefix, version] of latest) {
      const head = await git.resolveRef({ ...this.options, ref: 'HEAD' })
      if (head === version.oid) continue
      const paths = await this.files(version.oid, prefix)
      const current = await this.files(head, prefix)
      const files: Record<string, string> = {}
      let same = paths.length === current.length
      for (const file of paths) {
        const source = await this.sourceAt(version.oid, file)
        files[file.slice(prefix.length + 1)] = source
        if (!current.includes(file) || await this.sourceAt(head, file) !== source) same = false
      }
      if (!same) await this.commitFiles(prefix, files, `恢复「${version.name}」第 ${version.version} 版工作区（历史导入）`)
    }
  }

  private async commitFiles(prefix: string, files: Record<string, string>, message: string): Promise<string> {
    const entries = Object.entries(files)
    const matrix = await git.statusMatrix(this.options)
    if (matrix.some(([file, head, workdir, stage]) => (head !== 0 || stage !== 0 || file.startsWith(`${prefix}/`)) && (head !== workdir || head !== stage))) throw new Error('代码工作区有未提交的修改，请先在编辑器中备份并处理这些修改，再创建新版本；已有版本仍可读取。')
    const oldFiles = matrix.filter(([file, head]) => head !== 0 && file.startsWith(`${prefix}/`)).map(([file]) => file)
    const targetFiles = new Set(entries.map(([file]) => `${prefix}/${file}`))
    const backups = new Map<string, Buffer | null>()
    let committed = false
    try {
      for (const file of new Set([...oldFiles, ...targetFiles])) {
        await this.safePath(file)
        backups.set(file, await fsp.readFile(path.join(this.dir, file)).catch(error => { if (error.code === 'ENOENT') return null; throw error }))
      }
      for (const file of oldFiles.filter(file => !targetFiles.has(file))) { await fsp.unlink(path.join(this.dir, file)); await git.remove({ ...this.options, filepath: file }) }
      for (const [file, source] of entries) {
        const filepath = `${prefix}/${file}`
        await fsp.mkdir(path.dirname(path.join(this.dir, filepath)), { recursive: true })
        await fsp.writeFile(path.join(this.dir, filepath), source, 'utf8')
        await git.add({ ...this.options, filepath })
      }
      const oid = await git.commit({ ...this.options, author, message })
      committed = true
      return oid
    } catch (error) {
      if (!committed) for (const [file, bytes] of backups) {
        if (bytes === null) { await fsp.unlink(path.join(this.dir, file)).catch(err => { if (err.code !== 'ENOENT') throw err }); await git.remove({ ...this.options, filepath: file }) }
        else { await fsp.writeFile(path.join(this.dir, file), bytes); await git.add({ ...this.options, filepath: file }) }
      }
      throw new Error(`${recovery} ${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
  }

  write(input: GitCodeWrite) { return this.exclusive(() => this.writeLocked(input)) }
}
