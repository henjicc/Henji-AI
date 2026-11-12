import os from 'node:os'
import type SharpType from 'sharp'

let sharpModulePromise: Promise<typeof SharpType> | null = null

/**
 * sharp 是体积较大的原生模块，顶层 import 会在主进程启动、窗口创建之前就同步加载，
 * 拖慢冷启动。这里改成首次真正用到图片处理时才动态加载，并缓存结果避免重复 import。
 */
export function loadSharp(): Promise<typeof SharpType> {
  if (!sharpModulePromise) {
    sharpModulePromise = import('sharp')
      .then((mod) => {
        const sharp = mod.default
        // libvips 默认每条管线用满全部核；几条管线并行时会把 CPU 吃满，留四分之一给界面和其他工作。
        sharp.concurrency(Math.max(1, Math.floor(os.availableParallelism() * 0.75)))
        if (process.platform === 'win32') {
          // libvips 的文件缓存会在管线 Promise 完成后继续持有源句柄，阻止资源回收与
          // 原子替换。编辑器已有源金字塔和派生缓存，Windows 下关闭该层文件句柄缓存。
          sharp.cache({ files: 0 })
        }
        return sharp
      })
      .catch((error) => {
        sharpModulePromise = null
        throw error
      })
  }
  return sharpModulePromise
}
