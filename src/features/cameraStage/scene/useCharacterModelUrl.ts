import { useEffect, useState } from 'react'
import { getBundledResourceUrl } from '@/platform/desktopApi'

/**
 * 内置角色骨骼模型（Quaternius Universal Animation Library，CC0）的加载地址。
 * 经主进程解析 + henji-media:// 协议转换，开发态/打包态行为一致（见重要记录 006）。
 * 非桌面运行时或资源缺失时返回 null，角色回退为占位模型渲染。
 */

const CHARACTER_MODEL_RESOURCE = 'camera-stage/UAL1_Standard.glb'
const CAMERA_MODEL_RESOURCE = 'camera-stage/Video Camera.glb'

const cachedUrls = new Map<string, string | null>()
const pendingResolves = new Map<string, Promise<string | null>>()

function useBundledCameraStageResourceUrl(resourcePath: string): string | null {
  const [url, setUrl] = useState<string | null>(cachedUrls.get(resourcePath) ?? null)

  useEffect(() => {
    if (cachedUrls.has(resourcePath)) {
      return
    }
    let mounted = true
    let pendingResolve = pendingResolves.get(resourcePath)
    if (!pendingResolve) {
      pendingResolve = getBundledResourceUrl(resourcePath)
      pendingResolves.set(resourcePath, pendingResolve)
    }
    void pendingResolve.then((value) => {
      cachedUrls.set(resourcePath, value)
      pendingResolves.delete(resourcePath)
      if (mounted) {
        setUrl(value)
      }
    })
    return () => {
      mounted = false
    }
  }, [resourcePath])

  return url
}

export function useCharacterModelUrl(): string | null {
  return useBundledCameraStageResourceUrl(CHARACTER_MODEL_RESOURCE)
}

export function useCameraModelUrl(): string | null {
  return useBundledCameraStageResourceUrl(CAMERA_MODEL_RESOURCE)
}
