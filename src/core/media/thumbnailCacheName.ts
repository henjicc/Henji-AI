import { createImageEditRenderHash } from '../imageEdit/v3/renderHash'

/**
 * 缩略图缓存文件名：保留主文件名便于辨认，再加完整路径的哈希，不同目录里的同名文件（a/1.png 与 b/1.png、
 * 同名的图片与视频）各有一张。渲染层生成缓存与主进程回收派生文件共用这一份规则。
 * Windows 与 macOS 路径不分大小写，分隔符两种写法都会出现，先统一再算哈希。
 */
export function thumbnailCacheFileName(sourcePath: string): string {
  const name = sourcePath.split(/[\\/]/).at(-1) ?? ''
  const stem = name.replace(/\.[^.]+$/, '')
  const identity = createImageEditRenderHash(sourcePath.replace(/\\/g, '/').toLowerCase())
  return `${stem}-${identity}.webp`
}

/** 按主文件名命名的旧缓存文件名；只用于回收已有的旧缓存，新缓存不再这样命名。 */
export function legacyThumbnailCacheFileName(sourcePath: string): string {
  return (sourcePath.split(/[\\/]/).at(-1) ?? '').replace(/\.[^.]+$/, '.webp')
}
