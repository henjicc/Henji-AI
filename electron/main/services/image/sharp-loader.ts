import type SharpType from 'sharp'

let sharpModulePromise: Promise<typeof SharpType> | null = null

/**
 * sharp 是体积较大的原生模块，顶层 import 会在主进程启动、窗口创建之前就同步加载，
 * 拖慢冷启动。这里改成首次真正用到图片处理时才动态加载，并缓存结果避免重复 import。
 */
export function loadSharp(): Promise<typeof SharpType> {
  if (!sharpModulePromise) {
    sharpModulePromise = import('sharp').then((mod) => mod.default)
  }
  return sharpModulePromise
}
