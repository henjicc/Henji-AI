import { useEffect, useState } from 'react'
import { getBundledResourceUrl } from '@/platform/desktopApi'

/**
 * 内置角色骨骼模型（Quaternius Universal Animation Library，CC0）的加载地址。
 * 经主进程解析 + henji-media:// 协议转换，开发态/打包态行为一致（见重要记录 006）。
 * 非桌面运行时或资源缺失时返回 null，角色回退为占位模型渲染。
 */

const CHARACTER_MODEL_RESOURCE = 'camera-stage/UAL1_Standard.glb'

let cachedUrl: string | null | undefined
let pendingResolve: Promise<string | null> | null = null

export function useCharacterModelUrl(): string | null {
  const [url, setUrl] = useState<string | null>(cachedUrl ?? null)

  useEffect(() => {
    if (cachedUrl !== undefined) {
      return
    }
    let mounted = true
    pendingResolve ??= getBundledResourceUrl(CHARACTER_MODEL_RESOURCE)
    void pendingResolve.then((value) => {
      cachedUrl = value
      if (mounted) {
        setUrl(value)
      }
    })
    return () => {
      mounted = false
    }
  }, [])

  return url
}
