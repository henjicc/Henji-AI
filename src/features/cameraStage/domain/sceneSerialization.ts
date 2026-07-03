/**
 * 运镜控制场景的序列化 / 反序列化（工程持久化用）。
 *
 * 工程文件里存的是一份带 `schemaVersion` 的场景快照；加载时按版本做向前兼容：
 * 低于当前版本的旧工程逐级迁移，高于当前版本直接报错（提示升级应用）。
 * v2 起并入关键帧动画（tracks/duration/fps）；加载 v1 工程视为无动画。
 */

import { createDefaultAnimation } from './animationTypes'
import type { StageSceneAnimation } from './animationTypes'
import type { StageObject } from './sceneTypes'

/** 当前场景数据版本；结构不兼容变更时递增并补迁移分支 */
export const CAMERA_STAGE_SCENE_SCHEMA_VERSION = 2

export interface StageSceneSnapshot {
  schemaVersion: number
  objects: StageObject[]
  /** 当前取景机位（导演/机位视角切换用），无机位时为 null */
  activeCameraId: string | null
  /** 关键帧动画数据（v2 引入） */
  animation: StageSceneAnimation
}

export interface StageSceneSnapshotInput {
  objects: StageObject[]
  activeCameraId: string | null
  animation: StageSceneAnimation
}

export function serializeScene(input: StageSceneSnapshotInput): string {
  const snapshot: StageSceneSnapshot = {
    schemaVersion: CAMERA_STAGE_SCENE_SCHEMA_VERSION,
    objects: input.objects,
    activeCameraId: input.activeCameraId,
    animation: input.animation,
  }
  return JSON.stringify(snapshot)
}

/** 宽松解析动画字段：结构缺失/非法时回退为空动画，避免旧数据打不开 */
function parseAnimation(raw: unknown): StageSceneAnimation {
  const fallback = createDefaultAnimation()
  if (!raw || typeof raw !== 'object') return fallback
  const record = raw as Record<string, unknown>
  const tracks = Array.isArray(record.tracks)
    ? (record.tracks as StageSceneAnimation['tracks'])
    : fallback.tracks
  const duration = Number(record.duration)
  const fps = Number(record.fps)
  return {
    tracks,
    duration: Number.isFinite(duration) && duration > 0 ? duration : fallback.duration,
    fps: Number.isFinite(fps) && fps > 0 ? Math.round(fps) : fallback.fps,
  }
}

export function deserializeScene(sceneJson: string): StageSceneSnapshot {
  let parsed: unknown
  try {
    parsed = JSON.parse(sceneJson)
  } catch (error) {
    throw new Error(`[cameraStage] 场景数据不是合法 JSON：${(error as Error).message}`)
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('[cameraStage] 场景数据结构无效')
  }

  const record = parsed as Record<string, unknown>
  const version = Number(record.schemaVersion)
  if (!Number.isFinite(version) || version < 1) {
    throw new Error('[cameraStage] 场景数据缺少有效的 schemaVersion')
  }
  if (version > CAMERA_STAGE_SCENE_SCHEMA_VERSION) {
    throw new Error(
      `[cameraStage] 场景数据版本 ${version} 高于当前支持的 ${CAMERA_STAGE_SCENE_SCHEMA_VERSION}，请升级应用后再打开`,
    )
  }

  const objects = Array.isArray(record.objects) ? (record.objects as StageObject[]) : []
  const activeCameraId = typeof record.activeCameraId === 'string' ? record.activeCameraId : null
  // v1 工程无 animation 字段 → 视为无动画；v2+ 解析已有动画
  const animation = version >= 2 ? parseAnimation(record.animation) : createDefaultAnimation()

  return {
    schemaVersion: CAMERA_STAGE_SCENE_SCHEMA_VERSION,
    objects,
    activeCameraId,
    animation,
  }
}
