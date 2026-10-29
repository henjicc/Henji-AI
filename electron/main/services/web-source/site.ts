import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { codeWebFolderOf } from '../../../../src/core/videoEdit/codeMaterial/webSource'
import { inferMimeFromPath } from '../../protocol'

/** 网页来源在离屏页面里的站点：只由处理器从网页文件夹提供，不对应任何真实主机。 */
export const WEB_SOURCE_ORIGIN = 'https://web-source.henji.invalid'

/** 网页文件夹（站点根）；入口固定是其中的 index.html。 */
export interface WebSourceFolder { root: string }

/**
 * 网页来源必须是专门的网页文件夹：引用写文件夹本身或其中的 index.html。不接受零散的 html 文件，免得把它所在的
 * 整个目录（下载、桌面）当成站点去散列、监视和打包。
 */
export async function resolveWebSourceFolder(target: string): Promise<WebSourceFolder> {
  const root = codeWebFolderOf(target)
  if (!root) throw new Error(`网页来源需要网页文件夹（含 index.html）或其中的 index.html：${target}`)
  if (!(await fsp.stat(root).catch(() => null))?.isDirectory()) throw new Error(`网页文件夹不存在：${root}`)
  if (!(await fsp.stat(path.join(root, 'index.html')).catch(() => null))?.isFile()) throw new Error(`网页文件夹里没有 index.html：${root}`)
  return { root }
}

export const WEB_SOURCE_ENTRY_URL = `${WEB_SOURCE_ORIGIN}/index.html`

/** 相对路径是否落在根外（按路径段判断，不把以“..”开头的文件名当成越界）。 */
function outside(relative: string): boolean {
  return path.isAbsolute(relative) || relative.split(/[\\/]/)[0] === '..'
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
  if (!relative || outside(relative)) return undefined
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

/** 网页文件夹里的全部文件（相对路径用正斜杠，按路径排序）；散列与打包、复制共用。 */
export async function webSourceFiles(root: string): Promise<Array<{ relative: string; file: string; size: number; mtimeMs: number }>> {
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
  return files.sort((a, b) => (a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0))
}

export async function webSourceContentHash(root: string): Promise<string> {
  const digest = crypto.createHash('sha256')
  for (const item of await webSourceFiles(root)) digest.update(`${item.relative}\0${await fileHash(item.file, item.size, item.mtimeMs)}\n`)
  return digest.digest('hex')
}
