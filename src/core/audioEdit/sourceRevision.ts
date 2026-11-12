import type { AudioEditSourceMetadata } from './types'

/**
 * 素材这一版的记录键（渲染层的缓存、任务去重用）：路径、整文件摘要、采样指纹连同它记录的大小与修改时间。
 * 采样指纹只读几 MB，两份内容不同的文件可能摘要相同，所以总带上大小与修改时间；补录拼接、重新定位换了素材，键一定变。
 * 本文件主进程与渲染层共用，只用相对导入。
 */
export function audioEditSourceRevisionKey(source: Pick<AudioEditSourceMetadata, 'sourcePath' | 'identity' | 'fingerprint'>): string {
  const { identity, fingerprint } = source
  return JSON.stringify([source.sourcePath, identity?.digest ?? null, fingerprint ? [fingerprint.digest, fingerprint.size, fingerprint.mtimeMs] : null])
}
