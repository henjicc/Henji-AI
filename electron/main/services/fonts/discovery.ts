import { readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
export const FONT_FILE_EXTENSION = /\.(?:ttf|otf|ttc|woff2|woff|dfont)$/i
export interface FontDiscovery { files: string[]; failures: string[] }
export function fontDirectories(): string[] {
  return process.platform === 'win32' ? [path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts'), path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Microsoft', 'Windows', 'Fonts')]
    : process.platform === 'darwin' ? ['/Library/Fonts', '/Network/Library/Fonts', '/System/Library/Fonts', '/System/Library/AssetsV2', path.join(os.homedir(), 'Library', 'Fonts')]
      : ['/usr/share/fonts', '/usr/local/share/fonts', path.join(os.homedir(), '.fonts'), path.join(os.homedir(), '.local/share/fonts')]
}
/** Node async directory traversal: no depth truncation; realpath visitation terminates symlink cycles. */
export async function discoverSystemFonts(roots = fontDirectories()): Promise<FontDiscovery> {
  const pending = [...roots]; const visited = new Set<string>(); const files = new Set<string>(); const failures: string[] = []
  while (pending.length) {
    const directory = pending.pop()!
    try {
      const resolved = await realpath(directory)
      if (visited.has(resolved)) continue
      visited.add(resolved)
      for (const entry of await readdir(resolved, { withFileTypes: true })) {
        const candidate = path.join(resolved, entry.name)
        if (entry.isDirectory()) pending.push(candidate)
        else if (entry.isFile() && FONT_FILE_EXTENSION.test(entry.name)) files.add(candidate)
        else if (entry.isSymbolicLink()) {
          try {
            const target = await realpath(candidate); const info = await stat(target)
            if (info.isDirectory()) pending.push(target)
            else if (info.isFile() && FONT_FILE_EXTENSION.test(entry.name)) files.add(target)
          } catch (error) { failures.push(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`) }
        }
      }
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) failures.push(`${path.basename(directory)}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { files: [...files], failures }
}
