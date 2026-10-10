import { createImageEditRenderHash, type ImageEditHashValue } from '@/core/imageEdit/v3/renderHash'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'

export interface LiveAnnotationDisplayV3 {
  baseDocument: ImageEditDocumentV3
  liveLayers: readonly never[]
  baseIdentity: string
}

/** 所有正式内容进入 RenderPlan，前台只显示手势草稿。 */
export function splitLiveAnnotationDisplayV3(document: ImageEditDocumentV3): LiveAnnotationDisplayV3 {
  const hash = createImageEditRenderHash({geometry:document.geometry,color:document.color,layers:document.layers} as unknown as ImageEditHashValue)
  return {baseDocument:document,liveLayers:[],baseIdentity:`${document.id}:${hash}`}
}

export function resolveLiveBlurRadiusV3(
  document: ImageEditDocumentV3,
): number | null {
  const top = [...document.layers].reverse().find((layer) => layer.visible)
  if (top?.type !== 'effect'
    || top.effectId !== 'image.fast-blur-v3') return null
  const radius = top.params.radius
  return typeof radius === 'number' && Number.isFinite(radius) && radius > 0 ? radius : null
}

export interface LiveVgpuGlowFeedbackV3 {
  intensity: number
  radius: number
  sourceThreshold: number
  whiteHeat: number
}

export function resolveLiveVgpuGlowFeedbackV3(
  document: ImageEditDocumentV3,
): LiveVgpuGlowFeedbackV3 | null {
  const top = [...document.layers].reverse().find((layer) => layer.visible)
  if (top?.type !== 'effect' || top.effectId !== 'image.vgpu-glow') return null
  const unit = (key: string, fallback: number): number => {
    const value = top.params[key]
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.max(0, Math.min(1, value))
      : fallback
  }
  const intensity = unit('intensity', 0.68) * top.opacity
  return intensity > 0 ? {
    intensity,
    radius: unit('radius', 0.68),
    sourceThreshold: unit('sourceThreshold', 0.3),
    whiteHeat: unit('whiteHeat', 0.62),
  } : null
}
