import { useEffect, useState } from 'react'
import { getBundledResourceUrl } from '@/platform/desktopApi'
import { createLogger } from '@/core/logging'

/**
 * 内置角色骨骼模型（Quaternius Universal Animation Library，CC0）的加载地址。
 * 经主进程解析 + henji-media:// 协议转换，开发态/打包态行为一致（见重要记录 006）。
 * 非桌面运行时或资源缺失时返回 null，角色回退为占位模型渲染。
 */

const CHARACTER_MODEL_RESOURCE = 'camera-stage/UAL1_Standard.glb'
const CAMERA_MODEL_RESOURCE = 'camera-stage/Video Camera.glb'

const cachedUrls = new Map<string, string | null>()
const pendingResolves = new Map<string, Promise<string | null>>()
const logger = createLogger('features.cameraStage.bundledResources')

function useBundledCameraStageResourceUrl(resourcePath: string): string | null {
  const [url, setUrl] = useState<string | null>(cachedUrls.get(resourcePath) ?? null)

  useEffect(() => {
    if (cachedUrls.has(resourcePath)) {
      setUrl(cachedUrls.get(resourcePath) ?? null)
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
      if (pendingResolves.get(resourcePath) === pendingResolve) pendingResolves.delete(resourcePath)
      if (mounted) {
        setUrl(value)
      }
    }, (error: unknown) => {
      if (pendingResolves.get(resourcePath) === pendingResolve) pendingResolves.delete(resourcePath)
      logger.warn('内置模型地址解析失败，再次打开场景时可重试', {
        event: 'camera_stage.bundled_resource.resolve.failed',
        context: { resourcePath, reason: error instanceof Error ? error.message : String(error) },
      })
      if (mounted) setUrl(null)
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
