import { VIDEO_EDIT_SPACE_LIGHT_DEFAULT_HEX } from '../theme/colorTokens'
import { activeVideoEditClips, type VideoEditComposition } from './document'
import { videoEditPictureFilter } from './clipGeometry'
import { evaluateVideoEditClip } from './keyframes'
import { spatialRotation, spatialTransform } from './spatialMatrices'
import type { SpaceLightKind } from './spatialSchema'
import type { SpatialOutput, SpatialVec3 } from './spatialTypes'

/**
 * 时间线上的灯光片段（kind 'light'）在这一帧的世界状态。灯照亮本序列所有三维组（同 AE：灯照亮合成里所有三维层）；
 * 二维片段与调整层只切分渲染，不挡光。位置取片段的二维位置与深度，朝向取它的空间倾斜（缺省朝画面里，即远离镜头）。
 */
export interface SpatialLight {
  clipId: string
  kind: SpaceLightKind
  color: string
  /** 亮度（片段 lightIntensity 本帧值，乘上片段不透明度与淡入淡出）。 */
  intensity: number
  castShadow: boolean
  /** 阴影软硬 0–1。 */
  softness: number
  /** 聚光张角（度）。 */
  angle: number
  position: SpatialVec3
  direction: SpatialVec3
  /** 面光的边长（世界单位）：片段缩放 × 0.5 个画面高度。 */
  size: number
}

export const SPATIAL_LIGHT_DEFAULTS = { kind: 'spot' as SpaceLightKind, color: VIDEO_EDIT_SPACE_LIGHT_DEFAULT_HEX, intensity: 1, softness: .5, angle: 50 }

export function spatialLightsAt(document: VideoEditComposition, sequenceFrame: number, output: SpatialOutput, opacityOf: (clipId: string) => number = () => 1): SpatialLight[] {
  const visible = videoEditPictureFilter(document)
  const aspect = output.displayWidth / output.displayHeight
  return activeVideoEditClips(document, sequenceFrame).filter(clip => clip.kind === 'light' && clip.enabled !== false && visible.has(clip)).map(source => {
    const clip = evaluateVideoEditClip(source, sequenceFrame)
    const direction = spatialTransform(spatialRotation(clip.rotationX ?? 0, clip.rotationY ?? 0, clip.rotation), [0, 0, -1])
    return {
      clipId: source.id, kind: clip.lightKind ?? SPATIAL_LIGHT_DEFAULTS.kind, color: clip.lightColor ?? SPATIAL_LIGHT_DEFAULTS.color,
      intensity: (clip.lightIntensity ?? SPATIAL_LIGHT_DEFAULTS.intensity) * opacityOf(source.id),
      castShadow: clip.lightCastShadow === true, softness: clip.lightSoftness ?? SPATIAL_LIGHT_DEFAULTS.softness, angle: clip.lightAngle ?? SPATIAL_LIGHT_DEFAULTS.angle,
      position: [clip.x * aspect, -clip.y, clip.depth ?? 0], direction, size: clip.scale * .5,
    }
  })
}
