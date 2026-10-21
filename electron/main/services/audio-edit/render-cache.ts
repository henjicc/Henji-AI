import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { removeUnmanagedCachePath } from '../media-recycle/cache-deletion'

export function audioRenderKey(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)).digest('hex')
}
const running = new Map<string, Promise<string>>()
/** Publish only validated, complete files. Failed/cancelled work cannot poison subsequent reads. */
export async function cachedAudioFile(directory: string, key: string, extension: string, build: (temporary: string) => Promise<void>, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted()
  const output = path.join(directory, `${key}.${extension}`)
  if ((await fs.stat(output).catch(() => null))?.size) return output
  const existing = running.get(output)
  if (existing) { await existing; signal?.throwIfAborted(); return output }
  const operation = (async () => {
    await fs.mkdir(directory, { recursive: true })
    const temporary = path.join(directory, `${randomUUID()}.${extension}`)
    try { await build(temporary); signal?.throwIfAborted(); await fs.rename(temporary, output); return output }
    finally { await removeUnmanagedCachePath(temporary, { force: true }) }
  })()
  running.set(output, operation)
  try { return await operation } finally { if (running.get(output) === operation) running.delete(output) }
}
