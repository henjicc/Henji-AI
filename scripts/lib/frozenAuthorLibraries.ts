import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

export interface FrozenAuthorManifest {
  library: string
  version: string
  inputs: Record<string, string>
  outputs: Record<string, string>
}
export const sha256 = (bytes: Uint8Array | string): string => crypto.createHash('sha256').update(bytes).digest('hex')
const FROZEN_ROOT = 'resources/video-edit-author/frozen'

function releaseRef(): string { return process.env.HENJI_PERSISTENCE_RELEASE_REF || 'HEAD' }

function directoryFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.isSymbolicLink()) throw new Error(`冻结库禁止符号链接：${path.join(directory, entry.name)}`)
    return entry.isDirectory() ? directoryFiles(path.join(directory, entry.name)).map(file => `${entry.name}/${file}`) : [entry.name]
  }).sort()
}

/** 与持久格式使用同一不可变基准；Git 保存的 blob 同时保护产物与 release.json 自身。 */
export function validateFrozenAuthorHistory(root: string): void {
  const ref = releaseRef()
  const committed = execFileSync('git', ['ls-tree', '-r', '-z', '--name-only', ref, '--', FROZEN_ROOT], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
  const versions = new Map<string, string[]>()
  for (const file of committed) {
    const parts = file.slice(FROZEN_ROOT.length + 1).split('/')
    if (parts.length < 3) throw new Error(`冻结库基准路径无效：${file}`)
    const version = `${FROZEN_ROOT}/${parts[0]}/${parts[1]}`
    const list = versions.get(version) ?? []
    list.push(parts.slice(2).join('/')); versions.set(version, list)
    const current = path.join(root, file)
    if (!fs.existsSync(current) || !fs.lstatSync(current).isFile()) throw new Error(`已冻结版本文件不得删除或替换：${file}`)
    const original = execFileSync('git', ['show', `${ref}:${file}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 })
    if (sha256(fs.readFileSync(current)) !== sha256(original)) throw new Error(`已冻结版本文件不得修改：${file}；源码变化请发行新版本。`)
  }
  for (const [version, files] of versions) {
    if (JSON.stringify(directoryFiles(path.join(root, version))) !== JSON.stringify(files.sort())) throw new Error(`已冻结版本目录不得增加或删除文件：${version}`)
  }
  // 新发行也必须是完整可校验的目录；不能用不包含产物的空清单混过首次登记。
  const manifests = directoryFiles(path.join(root, FROZEN_ROOT)).filter(file => file.split('/').length === 3 && file.endsWith('/release.json'))
  for (const file of manifests) {
    const [library, version] = file.split('/')
    readFrozenAuthorRelease(path.join(root, FROZEN_ROOT, library, version), library, version)
  }
}

/** 工作区目录可被删除或篡改；是否允许首次冻结必须以已提交的树为准。 */
export function assertNewFrozenAuthorRelease(root: string, relative: string): void {
  const committed = [...new Set(['HEAD', releaseRef()])].some(ref => execFileSync('git', ['ls-tree', '-r', '--name-only', ref, '--', relative], { cwd: root, encoding: 'utf8' }).trim())
  if (committed) throw new Error(`${relative} 已提交冻结产物；即使目录被修改或删除，也禁止重冻同一版本，请恢复原产物并发行新版本。`)
  if (fs.existsSync(path.resolve(root, relative))) throw new Error(`${relative} 已冻结；修改源码后必须登记新版本，禁止覆盖。`)
}

/** 摘要是发行输入；日常构建不能用当前源码重写已发布的文件。 */
export function readFrozenAuthorRelease(directory: string, library: string, version: string): FrozenAuthorManifest {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'release.json'), 'utf8')) as FrozenAuthorManifest
  if (manifest.library !== library || manifest.version !== version || !Object.keys(manifest.outputs).length) throw new Error(`冻结库 ${library}@${version} 的发行清单不匹配。`)
  for (const [file, digest] of Object.entries(manifest.outputs)) {
    if (file.includes('\\') || file.startsWith('/') || file.split('/').some(part => !part || part === '.' || part === '..') || !/^[a-f0-9]{64}$/.test(digest)) throw new Error(`冻结库产物路径或摘要无效：${file}`)
    if (sha256(fs.readFileSync(path.join(directory, file))) !== digest) throw new Error(`冻结库 ${library}@${version}/${file} 摘要不一致；恢复原产物，源码变化请发行新版本。`)
  }
  if (JSON.stringify(directoryFiles(directory)) !== JSON.stringify([...Object.keys(manifest.outputs), 'release.json'].sort())) throw new Error(`冻结库 ${library}@${version} 的文件集合与发行清单不一致。`)
  return manifest
}
