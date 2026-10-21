import fs from 'node:fs/promises'
import path from 'node:path'

/*
 * 递归列出登记文件夹里的常见音频文件（只看扩展名，能否解码由分析决定）。
 * 跳过隐藏文件、系统文件（desktop.ini）与读不了的子目录；文件数有上限，避免误选整个磁盘。
 */

export const SOUND_LIBRARY_EXTENSIONS = new Set(['.wav', '.mp3', '.flac', '.ogg', '.oga', '.opus', '.m4a', '.aac', '.aif', '.aiff', '.wma', '.caf'])
export const SOUND_LIBRARY_MAX_FILES = 20_000

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
  const walk = async (directory: string): Promise<void> => {
    signal?.throwIfAborted()
    let entries
    try { entries = await fs.readdir(directory, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) { await walk(full); continue }
      if (!entry.isFile() || !SOUND_LIBRARY_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue
      if (files.length >= SOUND_LIBRARY_MAX_FILES) throw new SoundLibraryScanError(`文件夹里的音频超过 ${SOUND_LIBRARY_MAX_FILES} 个，请登记更具体的音效文件夹。`)
      try {
        const stat = await fs.stat(full)
        files.push({ relativePath: path.relative(root, full).split(path.sep).join('/'), path: full, size: stat.size, mtimeMs: Math.round(stat.mtimeMs) })
      } catch { /* 扫描期间被删除的文件不计入 */ }
    }
  }
  await walk(root)
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}
