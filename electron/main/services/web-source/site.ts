import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { inferMimeFromPath } from '../../protocol'

/** 网页来源在离屏页面里的站点：只由处理器从网页文件夹提供，不对应任何真实主机。 */
export const WEB_SOURCE_ORIGIN = 'https://web-source.henji.invalid'

/** 网页文件夹与入口（站点根下的 POSIX 相对路径）。 */
export interface WebSourceFolder { root: string; entry: string }

/** 入口 html 文件所在的文件夹就是站点根；给的是文件夹时入口为其中的 index.html。 */
export async function resolveWebSourceFolder(target: string): Promise<WebSourceFolder> {
  const stat = await fsp.stat(target).catch(() => null)
  if (!stat) throw new Error(`网页来源不存在：${target}`)
  if (!stat.isDirectory()) return { root: path.dirname(target), entry: path.basename(target) }
  if (!(await fsp.stat(path.join(target, 'index.html')).catch(() => null))?.isFile()) throw new Error(`网页文件夹里没有 index.html：${target}`)
  return { root: target, entry: 'index.html' }
}

export function webSourceEntryUrl(folder: WebSourceFolder): string {
  return `${WEB_SOURCE_ORIGIN}/${folder.entry.split(/[\\/]/).map(encodeURIComponent).join('/')}`
}

const WEB_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.ico': 'image/x-icon', '.map': 'application/json',
}

/**
 * 站点请求对应的文件：路径逐段解码后落在站点根内（真实路径也在根内，链接不能指向外面）；目录取其中的 index.html。
 * 不在根内或不存在时为 undefined。
 */
export async function webSourceFile(root: string, pathname: string): Promise<string | undefined> {
  let segments: string[]
  try { segments = pathname.split('/').filter(Boolean).map(decodeURIComponent) } catch { return undefined }
  if (segments.some(segment => segment === '..' || segment === '.' || /[\\/\0]/.test(segment) || path.isAbsolute(segment))) return undefined
  let file = path.join(root, ...segments)
  const stat = await fsp.stat(file).catch(() => null)
  if (stat?.isDirectory()) file = path.join(file, 'index.html')
  const [realRoot, realFile] = await Promise.all([fsp.realpath(root), fsp.realpath(file).catch(() => null)])
  if (!realFile) return undefined
  const relative = path.relative(realRoot, realFile)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return undefined
  return (await fsp.stat(realFile).catch(() => null))?.isFile() ? realFile : undefined
}

export async function serveWebSourceFile(root: string, request: Request): Promise<Response> {
  const file = await webSourceFile(root, new URL(request.url).pathname)
  if (!file) return new Response(null, { status: 404 })
  const type = WEB_TYPES[path.extname(file).toLowerCase()] ?? inferMimeFromPath(file)
  return new Response(new Uint8Array(await fsp.readFile(file)), { headers: { 'content-type': type, 'cache-control': 'no-store' } })
}

/** 内容指纹：全部文件按相对路径排序后，路径与各自 SHA-256 的汇总。文件按大小与修改时间记住上一次的散列，没变的不重读。 */
const fileHashes = new Map<string, { size: number; mtimeMs: number; hash: string }>()
async function fileHash(file: string, size: number, mtimeMs: number): Promise<string> {
  const known = fileHashes.get(file)
  if (known && known.size === size && known.mtimeMs === mtimeMs) return known.hash
  const hash = await new Promise<string>((resolve, reject) => {
    const digest = crypto.createHash('sha256')
    fs.createReadStream(file).on('data', chunk => digest.update(chunk)).on('error', reject).on('end', () => resolve(digest.digest('hex')))
  })
  fileHashes.set(file, { size, mtimeMs, hash })
  return hash
}

export async function webSourceContentHash(root: string): Promise<string> {
  const files: Array<{ relative: string; file: string; size: number; mtimeMs: number }> = []
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) { await walk(file); continue }
      const stat = await fsp.stat(file).catch(() => null)
      if (stat?.isFile()) files.push({ relative: path.relative(root, file).split(path.sep).join('/'), file, size: stat.size, mtimeMs: stat.mtimeMs })
    }
  }
  await walk(root)
  files.sort((a, b) => (a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0))
  const digest = crypto.createHash('sha256')
  for (const item of files) digest.update(`${item.relative}\0${await fileHash(item.file, item.size, item.mtimeMs)}\n`)
  return digest.digest('hex')
}
