import path from 'node:path'
import fsp from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { gitCodeLocation, parseGitCodeLocation, type GitCodeLocation } from '../../../../src/core/storage/gitCodeLocation'
import { CodeGitRepository, codeDigest, type GitCodeVersion } from './code-git'
import { ensureCodeCollectionTarget } from './code-paths'

interface VersionCopy { original: GitCodeVersion; files: Record<string, string>; withdrawn: boolean }
interface TransferGroup { repository: CodeGitRepository; prefix: string; references: Array<{ location: string; parsed: GitCodeLocation }> }
/** Rebuild the referenced module versions in the target's own history, resolving whole-module collisions. */
export async function transferGitCode(locations: readonly string[], destination: string): Promise<Map<string, string>> {
  const mapping = new Map<string, string>()
  const groups = new Map<string, TransferGroup>()
  const projectGroups = new Map<string, { repository: CodeGitRepository; references: Array<{ location: string; parsed: GitCodeLocation }> }>()
  for (const location of locations) {
    const parsed = parseGitCodeLocation(location)
    if (!parsed) continue
    if (!path.isAbsolute(parsed.repository)) throw new Error('代码仓库位置未解析，请重新打开原项目。')
    if (path.resolve(parsed.repository) === path.resolve(destination)) { mapping.set(location, location); continue }
    const segments = parsed.filepath.split('/')
    const legacy = segments[0] === 'legacy' && ['materials', 'components'].includes(segments[1])
    const kind = legacy ? (segments[1] === 'materials' ? '素材' : '组件') : segments[0]
    const name = legacy ? segments[2] : segments[1]
    if (!['素材', '组件'].includes(kind)) {
      const key = `${parsed.repository}:${parsed.oid}`
      const group = projectGroups.get(key) ?? { repository: new CodeGitRepository(parsed.repository), references: [] }
      group.references.push({ location, parsed }); projectGroups.set(key, group); continue
    }
    if (!name) throw new Error('代码版本模块位置无效。')
    const prefix = legacy ? `legacy/${segments[1]}/${name}` : `${kind}/${name}`; const key = `${parsed.repository}:${prefix}`
    const group = groups.get(key) ?? { repository: new CodeGitRepository(parsed.repository), prefix, references: [] }
    group.references.push({ location, parsed }); groups.set(key, group)
  }
  if (groups.size || projectGroups.size) await ensureCodeCollectionTarget(path.dirname(destination), path.join(destination, '.git', 'HEAD'), path.sep === '\\' ? 'win32' : 'posix')
  for (const group of projectGroups.values()) {
    const files: Record<string, string> = {}
    for (const reference of group.references) files[reference.parsed.filepath] = await group.repository.sourceAt(reference.parsed.oid, reference.parsed.filepath)
    const target = new CodeGitRepository(destination, path.dirname(destination))
    const oid = await target.exclusive(() => target.importSnapshotLocked(files))
    for (const reference of group.references) mapping.set(reference.location, gitCodeLocation({ repository: target.dir, oid, filepath: reference.parsed.filepath }))
  }
  if (!groups.size) return mapping
  // Read immutable objects first; never hold two project locks (A -> B and B -> A cannot deadlock).
  const prepared: Array<{ group: TransferGroup; copies: VersionCopy[] }> = []
  for (const group of groups.values()) {
    const versions = await group.repository.versions()
    const copies: VersionCopy[] = []
    for (const oid of new Set(group.references.map(reference => reference.parsed.oid))) {
      const original = versions.find(version => version.oid === oid && (group.prefix === `${version.kind}/${version.name}` || group.prefix === `legacy/${version.kind === '素材' ? 'materials' : 'components'}/${version.name}`))
      if (!original) throw new Error('源码版本标签缺失，请从备份恢复原仓库标签后重新复制。')
      const files: Record<string, string> = {}
      for (const file of await group.repository.files(oid, group.prefix)) files[file.slice(group.prefix.length + 1)] = await group.repository.sourceAt(oid, file)
      copies.push({ original, files, withdrawn: original.kind === '组件' && await group.repository.isWithdrawn(group.references.find(reference => reference.parsed.oid === oid)!.location) })
    }
    copies.sort((a, b) => a.original.version - b.original.version)
    prepared.push({ group, copies })
  }
  const target = new CodeGitRepository(destination, path.dirname(destination))
  await target.exclusive(async () => {
    for (const { group, copies } of prepared) {
      const original = copies[0].original
      const existing = await target.versions(original.kind)
      let name = original.name
      for (let suffix = 1; ; suffix++) {
        name = suffix === 1 ? original.name : `${original.name} (${suffix})`
        const matches = existing.filter(version => version.name === name)
        let conflict = false
        // Different material identities cannot share a worktree even when version numbers do not overlap.
        const owner = copies[0].files['.definition']
        if (owner && matches.length && await target.sourceAt(matches.at(-1)!.oid, `${await target.versionPrefix(matches.at(-1)!)}/.definition`) !== owner) conflict = true
        for (const copy of copies) {
          const match = matches.find(version => version.version === copy.original.version)
          if (!match) continue
          const prefix = await target.versionPrefix(match)
          const files = await target.files(match.oid, prefix)
          if (files.length !== Object.keys(copy.files).length) { conflict = true; break }
          for (const [file, source] of Object.entries(copy.files)) {
            if (!files.includes(`${prefix}/${file}`) || codeDigest(await target.sourceAt(match.oid, `${prefix}/${file}`)) !== codeDigest(source)) { conflict = true; break }
          }
          if (original.kind === '组件' && await target.isWithdrawn(gitCodeLocation({ oid: match.oid, repository: target.dir, filepath: `${prefix}/main.ts` })) !== copy.withdrawn) conflict = true
        }
        if (!conflict) break
      }
      for (const copy of copies) {
        const stored = await target.writeLocked({ kind: original.kind, name, version: copy.original.version, files: copy.files })
        if (copy.withdrawn) await target.withdrawLocked(stored.files[0].location, stored.files[0].hash)
        for (const reference of group.references.filter(reference => reference.parsed.oid === copy.original.oid)) {
          const relative = reference.parsed.filepath.slice(group.prefix.length + 1)
          const file = stored.files.find(file => file.path === relative)
          if (!file) throw new Error('代码版本文件缺失，原工程未修改，请恢复仓库后重试。')
          mapping.set(reference.location, file.location)
        }
      }
    }
    await target.restoreLatestLocked()
  })
  return mapping
}

/** One isolated code snapshot per export. Keep source repos untouched while collecting external modules. */
export class GitCodePackageSnapshot {
  readonly root: string
  readonly directory: string
  constructor(staging: string, private readonly containerRoot: string, private readonly wholeProject: boolean) {
    this.root = path.join(staging, `code-export-${randomUUID()}`)
    this.directory = path.join(this.root, '代码')
  }
  async initialize(): Promise<void> {
    await fsp.mkdir(this.root, { recursive: true })
    const repository = new CodeGitRepository(path.join(this.containerRoot, '代码'))
    if (this.wholeProject && await repository.exists()) await repository.exclusive(async () => {
      // A project export also retains unreferenced versions and users' worktree edits.
      await fsp.cp(repository.dir, this.directory, { recursive: true, dereference: true, filter: source => !source.endsWith('.lock') })
    })
  }
  async collect(locations: readonly string[]): Promise<Map<string, string>> {
    const mapping = new Map<string, string>()
    const external: string[] = []
    for (const location of locations) {
      const reference = parseGitCodeLocation(location)
      if (!reference) continue
      if (this.wholeProject && path.resolve(reference.repository) === path.join(this.containerRoot, '代码')) {
        mapping.set(location, location)
      } else external.push(location)
    }
    for (const [source, target] of await transferGitCode(external, this.directory)) {
      const reference = parseGitCodeLocation(target)!
      mapping.set(source, gitCodeLocation({ ...reference, repository: path.join(this.containerRoot, '代码') }))
    }
    return mapping
  }
  async entries(): Promise<Array<{ name: string; source: string }>> {
    const result: Array<{ name: string; source: string }> = []
    const visit = async (directory: string): Promise<void> => {
      for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
        const source = path.join(directory, entry.name)
        if (entry.isDirectory()) await visit(source)
        else if (entry.isFile() && !entry.name.endsWith('.lock')) result.push({ name: path.relative(this.root, source).split(path.sep).join('/'), source })
      }
    }
    if (await fsp.stat(this.directory).catch(() => null)) await visit(this.directory)
    return result
  }
  dispose(): Promise<void> { return fsp.rm(this.root, { recursive: true, force: true }) }
}
