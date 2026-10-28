import { promises as fs, type Dir } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { FsDirPage, FsDirPageOptions } from '../../../src/platform/contracts/system'
import { isPathInside, type PathStyle } from '../../../src/core/storage/pathSyntax'

const HOST_STYLE: PathStyle = process.platform === 'win32' ? 'win32' : 'posix'
/** 越界目录的错误前缀；渲染层据此把跳过原因记为“不在项目内”。 */
export const OUTSIDE_BOUNDARY_ERROR = 'OUTSIDE_BOUNDARY'

interface Scan { directory: Dir; path: string; realPath: string; boundary?: string; owner: number; timer: ReturnType<typeof setTimeout>; reading: boolean }
const scans = new Map<string, Scan>()
// IPC payload stays bounded; this is a page size, never a directory/file count limit.
export const DIRECTORY_PAGE_SIZE = 256
const IDLE_TIMEOUT_MS = 5 * 60 * 1000

async function closeScan(cursor: string): Promise<void> {
  const scan = scans.get(cursor)
  if (!scan) return
  scans.delete(cursor); clearTimeout(scan.timer)
  await scan.directory.close()
}
export async function closeDirectoryScans(owner: number): Promise<void> {
  await Promise.allSettled([...scans].filter(([, scan]) => scan.owner === owner).map(([cursor]) => closeScan(cursor)))
}
function expiry(cursor: string): ReturnType<typeof setTimeout> {
  // Abandoned renderer requests must not leak OS directory handles.
  const timer = setTimeout(() => { void closeScan(cursor).catch(() => undefined) }, IDLE_TIMEOUT_MS)
  timer.unref(); return timer
}
export async function readDirectoryPage(targetPath: string, options: FsDirPageOptions, owner: number): Promise<FsDirPage> {
  let cursor = options.cursor
  let scan = cursor ? scans.get(cursor) : undefined
  if (options.close && cursor && !scan) return { entries: [], realPath: '' }
  if (cursor && (!scan || scan.owner !== owner || scan.path !== targetPath)) throw new Error('目录读取已结束，请重新导入。')
  if (options.close) {
    if (scan && cursor) await closeScan(cursor)
    return { entries: [], realPath: scan?.realPath ?? '' }
  }
  if (!scan) {
    const realPath = await fs.realpath(targetPath)
    // The boundary is compared by real path, so junctions and symbolic links cannot lead the scan out of it.
    const boundary = options.boundary === undefined ? undefined : await fs.realpath(options.boundary)
    if (boundary !== undefined && !isPathInside(HOST_STYLE, boundary, realPath)) throw new Error(`${OUTSIDE_BOUNDARY_ERROR}：目录的真实位置不在允许读取的文件夹内。`)
    const directory = await fs.opendir(targetPath, { bufferSize: DIRECTORY_PAGE_SIZE })
    cursor = randomUUID(); scan = { directory, path: targetPath, realPath, ...(boundary !== undefined ? { boundary } : {}), owner, timer: expiry(cursor), reading: false }
    scans.set(cursor, scan)
  }
  if (scan.reading) throw new Error('目录读取正在进行。')
  scan.reading = true; clearTimeout(scan.timer)
  try {
    const entries: FsDirPage['entries'] = []
    for (let index = 0; index < DIRECTORY_PAGE_SIZE; index++) {
      const entry = await scan.directory.read()
      if (!entry) { await closeScan(cursor!); return { entries, realPath: scan.realPath } }
      let isDirectory = entry.isDirectory(); let unreadable = false; let outside = false
      if (entry.isSymbolicLink()) {
        const linkPath = path.join(targetPath, entry.name)
        try {
          isDirectory = (await fs.stat(linkPath)).isDirectory()
          if (scan.boundary !== undefined && !isPathInside(HOST_STYLE, scan.boundary, await fs.realpath(linkPath))) outside = true
        } catch { unreadable = true }
      }
      entries.push({ name: entry.name, isDirectory, ...(unreadable ? { unreadable } : {}), ...(outside ? { outside } : {}) })
    }
    scan.timer = expiry(cursor!); return { entries, realPath: scan.realPath, cursor }
  } catch (error) {
    await closeScan(cursor!).catch(() => undefined); throw error
  } finally { scan.reading = false }
}
