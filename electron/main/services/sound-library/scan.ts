import fs from 'node:fs/promises'
import path from 'node:path'
import { createMainLogger } from '../logging/main-logger'
import { isMissingTraversalEntry, isUnavailableTraversalEntry, resolveLinkedPath } from '../fs/traversal'

const logger = createMainLogger('main.sound_library.scan')

/*
 * 递归列出登记文件夹里的常见音频文件（只看扩展名，能否解码由分析决定）。
 * 跳过隐藏文件、系统文件（desktop.ini）与读不了的子目录；用真实路径去重避免链接循环。
 */

export const SOUND_LIBRARY_EXTENSIONS = new Set(['.wav', '.mp3', '.flac', '.ogg', '.oga', '.opus', '.m4a', '.aac', '.aif', '.aiff', '.wma', '.caf'])

export interface ScannedSoundFile {
  /** 相对登记文件夹，用 / 分隔。 */
  relativePath: string
  path: string
  size: number
  mtimeMs: number
}

export class SoundLibraryScanError extends Error {
  constructor(message: string) { super(message); this.name = 'SoundLibraryScanError' }
}

export async function scanSoundFolder(root: string, signal?: AbortSignal): Promise<ScannedSoundFile[]> {
  try {
    if (!(await fs.stat(root)).isDirectory()) throw new SoundLibraryScanError('登记的音效文件夹已不是文件夹。')
  } catch (error) {
    if (error instanceof SoundLibraryScanError) throw error
    throw new SoundLibraryScanError('找不到登记的音效文件夹，可能已移动、改名或所在磁盘未连接。')
  }
  const files: ScannedSoundFile[] = []
  const visited = new Set<string>()
  const walk = async (directory: string, physicalDirectory: string): Promise<void> => {
    signal?.throwIfAborted()
    let entries
    try {
      const real = physicalDirectory
      if (visited.has(real)) return
      visited.add(real)
      entries = await fs.readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (isMissingTraversalEntry(error)) return
      if (!isUnavailableTraversalEntry(error)) throw error
      logger.warn('跳过无法访问的音效目录', { event: 'sound_library.scan.entry_skipped', context: { path: directory }, error })
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = path.join(directory, entry.name)
      try {
        let physicalPath = path.join(physicalDirectory, entry.name)
        if (entry.isSymbolicLink()) {
          try { physicalPath = await fs.realpath(full) }
          catch (error) { logger.warn('跳过无法解析的音效链接', { event: 'sound_library.scan.entry_skipped', context: { path: full }, error }); continue }
        }
        const info = entry.isSymbolicLink() ? await fs.stat(full) : entry
        if (!info) continue
        if (info.isDirectory()) { await walk(full, physicalPath); continue }
        if (!info.isFile() || !SOUND_LIBRARY_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue
        const stat = await fs.stat(full)
        files.push({ relativePath: path.relative(root, full).split(path.sep).join('/'), path: full, size: stat.size, mtimeMs: Math.round(stat.mtimeMs) })
      } catch (error) {
        if (isMissingTraversalEntry(error)) continue
        if (!isUnavailableTraversalEntry(error)) throw error
        logger.warn('跳过无法访问的音效项', { event: 'sound_library.scan.entry_skipped', context: { path: full }, error })
      }
    }
  }
  await walk(root, await resolveLinkedPath(root))
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}
