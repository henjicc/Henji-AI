import fsp from 'node:fs/promises'
import path from 'node:path'
import git from 'isomorphic-git'
import { CodeGitRepository, codeDigest } from './code-git'
import { codeProjectPathSchema, type CodeProjectChange, type CodeProjectState } from '../../../../src/core/videoEdit/codeMaterial/projectContract'
import { CODE_AUTHOR_SOURCE_MAX_BYTES } from '../../../../src/core/videoEdit/codeMaterial/sources'

const trees = new Map<string, Map<string, { oid: string; bytes: number }>>()
const recovery = '代码仓库无法读取，请保留工作区并从备份恢复 .git 后重试。'
const author = { name: '痕迹AI', email: 'code@henji.local' }
/** Shared by every document in the same container. Reads never initialize or commit. */
export class CodeProjectRepository extends CodeGitRepository {
  async head(): Promise<string | null> {
    if (!await this.exists()) return null
    try {
      const ref = await fsp.readFile(path.join(this.dir, '.git/HEAD'), 'utf8')
      if (ref !== 'ref: refs/heads/main\n') throw new Error('代码仓库分支已切换，请切回 main 后重试。')
      const branch = await fsp.readFile(path.join(this.dir, '.git/refs/heads/main'), 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error })
      if (!branch && !await fsp.stat(path.join(this.dir, '.git/packed-refs')).catch(() => null)) return null
      const oid = await git.resolveRef({ ...this.options, ref: 'HEAD' })
      await git.readCommit({ ...this.options, oid })
      return oid
    } catch (error) { throw new Error(`${recovery} ${String(error)}`, { cause: error }) }
  }
  async treeAt(oid: string | null): Promise<Map<string, { oid: string; bytes: number }>> {
    if (!oid) return new Map()
    const key = `${this.dir}:${oid}`; const known = trees.get(key)
    if (known) return new Map(known)
    const result = new Map<string, { oid: string; bytes: number }>()
    const visit = async (oid: string, prefix: string): Promise<void> => {
      for (const entry of (await git.readTree({ ...this.options, oid })).tree) {
        const name = prefix + entry.path
        if (entry.type === 'tree') await visit(entry.oid, `${name}/`)
        else if (entry.type === 'blob') result.set(name, { oid: entry.oid, bytes: (await git.readBlob({ ...this.options, oid: entry.oid })).blob.byteLength })
      }
    }
    try { await visit(oid, '') } catch (error) { throw new Error(`${recovery} ${String(error)}`, { cause: error }) }
    trees.set(key, result); if (trees.size > 128) trees.delete(trees.keys().next().value!)
    return new Map(result)
  }
  private async workspace(): Promise<Map<string, Buffer>> {
    const result = new Map<string, Buffer>()
    const visit = async (prefix: string): Promise<void> => {
      const entries = await fsp.readdir(path.join(this.dir, prefix), { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })
      for (const entry of entries) {
        if (!prefix && entry.name === '.git') continue
        const file = prefix + entry.name; await this.safePath(file)
        if (entry.isDirectory()) await visit(`${file}/`)
        else if (entry.isFile()) {
          if ((await fsp.stat(path.join(this.dir, file))).size > CODE_AUTHOR_SOURCE_MAX_BYTES) throw new Error(`${file} 超过16MiB，请拆分后重试。`)
          result.set(file, await fsp.readFile(path.join(this.dir, file)))
        }
      }
    }
    await this.safePath('.git/HEAD'); await visit(''); return result
  }
  async state(): Promise<CodeProjectState> {
    const head = await this.head(); const tree = await this.treeAt(head); const work = await this.workspace()
    const changes: CodeProjectState['changes'] = []
    for (const file of new Set([...tree.keys(), ...work.keys()])) {
      const bytes = work.get(file); const previous = tree.get(file)
      if (!bytes) changes.push({ path: file, kind: 'deleted' })
      else if (!previous) changes.push({ path: file, kind: 'added' })
      else if ((await git.hashBlob({ object: bytes })).oid !== previous.oid) changes.push({ path: file, kind: 'modified' })
    }
    const files = [...work].filter(([file]) => codeProjectPathSchema.safeParse(file).success).map(([file, bytes]) => {
      try { return { path: file, source: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes), hash: codeDigest(bytes), bytes: bytes.length } }
      catch (error) { throw new Error(`${file} 不是 UTF-8 文本，请转为 UTF-8 后重试。`, { cause: error }) }
    })
    const log: CodeProjectState['log'] = []
    if (head) for (const item of await git.log({ ...this.options, ref: head, depth: 20 })) {
      const current = await this.treeAt(item.oid); const parent = await this.treeAt(item.commit.parent[0] ?? null)
      log.push({ oid: item.oid, message: item.commit.message.trimEnd(), time: new Date(item.commit.author.timestamp * 1000).toISOString(), paths: [...new Set([...current.keys(), ...parent.keys()])].filter(file => current.get(file)?.oid !== parent.get(file)?.oid).sort() })
    }
    return { head, files, tree: [...work].map(([file, bytes]) => ({ path: file, bytes: bytes.length })), log, changes }
  }
  /** Commit a patch against HEAD, leaving unrelated unstaged files alone. Never capture a foreign index. */
  async change(input: Pick<CodeProjectChange, 'message' | 'changes'>): Promise<string> {
    return this.exclusive(async () => {
      const head = await this.head(); const tree = await this.treeAt(head)
      const unique = new Set<string>()
      for (const change of input.changes) {
        codeProjectPathSchema.parse(change.path)
        const key = change.path.toLowerCase()
        if (unique.has(key)) throw new Error(`path 重复：${change.path}`)
        unique.add(key)
        await this.safePath(change.path)
        const bytes = await fsp.readFile(path.join(this.dir, change.path)).catch(error => { if (error.code === 'ENOENT') return null; throw error })
        const tracked = tree.get(change.path)
        if ((bytes ? codeDigest(bytes) : null) !== change.expectedHash || (bytes ? (await git.hashBlob({ object: bytes })).oid : undefined) !== tracked?.oid) {
          throw new Error(`工程文件 ${change.path} 有未提交的外部修改或已改变；请读取 changes，备份后用 commit_video_edit_code_project 提交，再重试。`)
        }
      }
      await this.initialize()
      const matrix = await git.statusMatrix(this.options)
      const staged = matrix.filter(([, h, , s]) => h !== s).map(([file]) => file)
      if (staged.length) throw new Error(`工程暂存区有未提交修改：${staged.join('、')}；请先处理或提交外部修改。`)
      const backups = new Map<string, Buffer | null>(); let committed = false
      try {
        for (const change of input.changes) {
          const location = path.join(this.dir, change.path)
          backups.set(change.path, await fsp.readFile(location).catch(error => { if (error.code === 'ENOENT') return null; throw error }))
          if (change.source === null) { await fsp.unlink(location); await git.remove({ ...this.options, filepath: change.path }) }
          else { await fsp.mkdir(path.dirname(location), { recursive: true }); await fsp.writeFile(location, change.source, 'utf8'); await git.add({ ...this.options, filepath: change.path }) }
        }
        const oid = await git.commit({ ...this.options, message: input.message, author }); committed = true; return oid
      } catch (error) {
        if (!committed) for (const [file, bytes] of backups) {
          const location = path.join(this.dir, file)
          if (bytes === null) { await fsp.unlink(location).catch(error => { if (error.code !== 'ENOENT') throw error }); await git.remove({ ...this.options, filepath: file }) }
          else { await fsp.mkdir(path.dirname(location), { recursive: true }); await fsp.writeFile(location, bytes); await git.add({ ...this.options, filepath: file }) }
        }
        throw new Error(`工程提交失败，已尝试恢复本次文件；请检查 changes 后重试。${String(error)}`, { cause: error })
      }
    })
  }
  async commitWorkspace(message: string): Promise<string> {
    return this.exclusive(async () => {
      const state = await this.state()
      if (!state.changes.length) throw new Error('工程没有未提交的工作区修改。')
      for (const change of state.changes) codeProjectPathSchema.parse(change.path)
      await this.initialize()
      const divergent = (await git.statusMatrix(this.options)).filter(([, head, work, stage]) => stage !== head && stage !== work).map(([file]) => file)
      if (divergent.length) throw new Error(`暂存内容与工作区不同：${divergent.join('、')}；请先在外部编辑器中保存或恢复暂存内容，再提交工作区。`)
      for (const change of state.changes) {
        if (change.kind === 'deleted') await git.remove({ ...this.options, filepath: change.path })
        else await git.add({ ...this.options, filepath: change.path })
      }
      return git.commit({ ...this.options, author, message })
    })
  }
}
