import fs from 'node:fs'
import path from 'node:path'
import { allowMediaRoot } from '../../protocol'

/**
 * 内置只读资源解析：把 resources/ 下随应用分发的资源（如3D 镜头参考的角色 GLB）
 * 解析为绝对路径，并把所在根目录注册进 henji-media:// 协议白名单，
 * 让渲染层能用统一的媒体协议加载内置资源（开发态/打包态行为一致，见重要记录 006）。
 */

function getBundledResourceRoots(): string[] {
  const roots = [path.join(process.cwd(), 'resources')]
  if (process.resourcesPath) {
    roots.push(path.join(process.resourcesPath, 'resources'))
  }
  return roots
}

/** 解析内置资源相对路径；文件不存在或越出资源根目录时返回 null */
export function resolveBundledResourcePath(relativePath: string): string | null {
  for (const root of getBundledResourceRoots()) {
    const resolvedRoot = path.resolve(root)
    const target = path.resolve(resolvedRoot, relativePath)
    const relative = path.relative(resolvedRoot, target)
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return null
    }
    if (fs.existsSync(target) && fs.statSync(target).isFile()) {
      allowMediaRoot(resolvedRoot)
      return target
    }
  }
  return null
}
