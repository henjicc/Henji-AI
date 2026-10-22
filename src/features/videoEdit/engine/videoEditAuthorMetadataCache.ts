import type { CodeAuthorProgram } from '@/core/videoEdit/codeAuthorProgram'

export type AuthorCachedMetadata = Omit<CodeAuthorProgram, 'bundle'>
interface Cache {
  read(key: string): Promise<AuthorCachedMetadata | undefined>
  write(key: string, metadata: AuthorCachedMetadata): Promise<void>
}
let cache: Cache | undefined
/** Worker 通过现有渲染传输借用宿主缓存，不持有数据库或另建持久化通道。 */
export function installAuthorMetadataCache(value: Cache): void { cache = value }
export function readAuthorMetadataCache(key: string): Promise<AuthorCachedMetadata | undefined> { return cache?.read(key) ?? Promise.resolve(undefined) }
export function writeAuthorMetadataCache(key: string, program: CodeAuthorProgram): void {
  const { bundle: _bundle, ...metadata } = program
  void cache?.write(key, metadata).catch(() => undefined)
}
