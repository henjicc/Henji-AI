import fs from 'node:fs'
import path from 'node:path'
import { dialog, type BrowserWindow, type OpenDialogOptions, type OpenDialogReturnValue, type SaveDialogOptions, type SaveDialogReturnValue } from 'electron'
import { getProgramDataDir } from './appBasePaths'

/*
 * 系统文件对话框的唯一入口。Electron 43 起没给 defaultPath 时一律打开“下载”，不再沿用系统记住的上次位置；
 * 这里记住上次选择所在的目录（跨重启），调用方没给位置时从那里打开，只给文件名时放进那个目录。
 */

const STATE_FILE = 'dialog-directories.json'
let lastDirectory: string | null | undefined

function stateFile(): string { return path.join(getProgramDataDir(), STATE_FILE) }

function readLastDirectory(): string | null {
  if (lastDirectory !== undefined) return lastDirectory
  try {
    const value = (JSON.parse(fs.readFileSync(stateFile(), 'utf8')) as { last?: unknown }).last
    lastDirectory = typeof value === 'string' && fs.existsSync(value) ? value : null
  } catch { lastDirectory = null }
  return lastDirectory
}

function rememberDirectory(directory: string): void {
  lastDirectory = directory
  try { fs.writeFileSync(stateFile(), JSON.stringify({ last: directory })) } catch { /* 记不住只影响下次打开的位置 */ }
}

/** 调用方的 defaultPath：省略时用上次目录；只给文件名时放进上次目录；绝对路径原样保留。 */
export function resolveDialogDefaultPath(defaultPath: string | undefined, last: string | null): string | undefined {
  if (!last) return defaultPath
  if (!defaultPath) return last
  return path.isAbsolute(defaultPath) ? defaultPath : path.join(last, defaultPath)
}

export async function showOpenDialog(owner: BrowserWindow | null | undefined, options: OpenDialogOptions): Promise<OpenDialogReturnValue> {
  const resolved = { ...options, defaultPath: resolveDialogDefaultPath(options.defaultPath, readLastDirectory()) }
  const result = owner ? await dialog.showOpenDialog(owner, resolved) : await dialog.showOpenDialog(resolved)
  const first = result.canceled ? undefined : result.filePaths[0]
  // 选文件夹时从它的上一级打开，下次还能看到同级的其他文件夹。
  if (first) rememberDirectory(path.dirname(first))
  return result
}

export async function showSaveDialog(owner: BrowserWindow | null | undefined, options: SaveDialogOptions): Promise<SaveDialogReturnValue> {
  const resolved = { ...options, defaultPath: resolveDialogDefaultPath(options.defaultPath, readLastDirectory()) }
  const result = owner ? await dialog.showSaveDialog(owner, resolved) : await dialog.showSaveDialog(resolved)
  if (!result.canceled && result.filePath) rememberDirectory(path.dirname(result.filePath))
  return result
}
