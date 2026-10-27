import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveImageEditorV3ResourceMediaUrl } from '../image-editor-v3/resource-media-url'

export function localMediaPath(value: string): string | null {
  if (/^file:/i.test(value)) return fileURLToPath(value)
  if (/^henji-media:\/\/local\//i.test(value)) return decodeURIComponent(new URL(value).pathname.slice(1))
  if (/^henji-media:\/\/image-editor-v3\//i.test(value)) return resolveImageEditorV3ResourceMediaUrl(new URL(value)).targetPath
  if (/^(?:henji|file):/i.test(value) || /^henji-media:/i.test(value)) throw new Error('Unresolved media reference')
  return path.isAbsolute(value) ? path.resolve(value) : null
}

export function pathKey(value: string): string {
  const normalized = path.resolve(value).replace(/\\/g, '/')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

export function within(root: string, target: string): boolean {
  return pathKey(target).startsWith(`${pathKey(root).replace(/\/$/, '')}/`)
}

/** A Windows network (UNC) path; the `\\?\` and `\\.\` device prefixes name local paths. */
export function isWindowsNetworkPath(value: string): boolean {
  return /^[\\/]{2}(?![?.][\\/])[^\\/]/.test(value)
}

export async function canonicalPath(value: string): Promise<string | null> {
  const local = localMediaPath(value)
  if (!local) return null
  // Network paths compare as written: resolving one means name resolution and an SMB connection, and text that merely
  // looks like `//host/...` (base64, protocol-relative URLs) would hold the file thread pool for minutes.
  if (process.platform === 'win32' && isWindowsNetworkPath(local)) return pathKey(local)
  try { return pathKey(await fs.realpath(local)) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    // Resolve existing ancestors too: an absent file below a junction is still an alias.
    const parent = path.dirname(local)
    if (parent === local) return pathKey(local)
    return pathKey(path.join((await canonicalPath(parent))!, path.basename(local)))
  }
}

export function fileIdentity(stat: { dev: number; ino: number; size: number; mtimeMs: number; birthtimeMs: number }): string {
  return [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.birthtimeMs].join(':')
}
