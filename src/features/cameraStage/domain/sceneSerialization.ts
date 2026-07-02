/**
 * 运镜控制场景的序列化 / 反序列化（工程持久化用）。
 *
 * 工程文件里存的是一份带 `schemaVersion` 的场景快照；加载时按版本做向前兼容：
 * 低于当前版本的旧工程逐级迁移，高于当前版本直接报错（提示升级应用）。
 * 第三阶段引入关键帧动画时在此升版本并补迁移分支，不破坏本版本结构。
 */

import type { StageObject } from './sceneTypes'

/** 当前场景数据版本；结构不兼容变更时递增并补迁移分支 */
export const CAMERA_STAGE_SCENE_SCHEMA_VERSION = 1

export interface StageSceneSnapshot {
  schemaVersion: number
  objects: StageObject[]
  /** 当前取景机位（导演/机位视角切换用），无机位时为 null */
  activeCameraId: string | null
}

export interface StageSceneSnapshotInput {
  objects: StageObject[]
  activeCameraId: string | null
}

export function serializeScene(input: StageSceneSnapshotInput): string {
  const snapshot: StageSceneSnapshot = {
    schemaVersion: CAMERA_STAGE_SCENE_SCHEMA_VERSION,
    objects: input.objects,
    activeCameraId: input.activeCameraId,
  }
  return JSON.stringify(snapshot)
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

  // 未来版本迁移入口：当 version < CAMERA_STAGE_SCENE_SCHEMA_VERSION 时，在此按版本逐级迁移 objects/字段。
  const objects = Array.isArray(record.objects) ? (record.objects as StageObject[]) : []
  const activeCameraId = typeof record.activeCameraId === 'string' ? record.activeCameraId : null

  return {
    schemaVersion: CAMERA_STAGE_SCENE_SCHEMA_VERSION,
    objects,
    activeCameraId,
  }
}
