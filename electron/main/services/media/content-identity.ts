import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'

/**
 * 本地媒体文件的内容身份（任务 2.3 波形、2.4 片段缩略帧共用）：真实路径 + 设备号 + inode + 大小 + 纳秒级修改/变更时间的摘要。
 * 派生物缓存按它命名，生成前后各核对一次，文件被替换或改写即视为另一份内容。
 */
export interface MediaContentIdentity { path: string; identity: string }

export async function identifyMediaContent(source: string): Promise<MediaContentIdentity> {
  const canonical = await fs.realpath(source)
  const stat = await fs.stat(canonical, { bigint: true })
  if (!stat.isFile()) throw new Error('媒体来源必须为可读取的文件。')
  const identity = createHash('sha256').update([canonical, stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join('|')).digest('hex')
  return { path: canonical, identity }
}
