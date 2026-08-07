import { z } from 'zod'

import type { ApplicationPropertyWriterTable, JsonValue } from '@/core/application-control'

import type { StageObject, StageTransform, StageVec3 } from '../domain/sceneTypes'
import type { StageEasingPreset, StageKeyframeValue } from '../domain/animationTypes'
import { setTrackKeyframeValue } from '../store/animationActions'
import { useCameraStageStore } from '../store/cameraStageStore'
import type { CameraStageObjectUpdate, CameraStageShotUpdate } from './cameraStageApplicationService'
import { CAMERA_STAGE_ENTITY_TYPES } from './cameraStageReflection'

/*
 * 三维六类实体的属性写入表。
 *
 * 这些表此前是执行器里四条手写 if-else 链。手写链条对门禁不透明——它无法枚举"这个执行器到底
 * 能写哪些属性"，于是 `camera_stage.shot.time` 声明可写、链条里没有对应分支这件事，实体级覆盖
 * 门禁全绿了不知道多久，只有用户实机改镜头时间点才会撞上 PROPERTY_NOT_WRITABLE。
 *
 * 拆成 object / camera 两张表还顺手清掉了一批死代码：原来一个 applyObject 服务两个实体类型，
 * 里面的 fov / look_at_* / aspect_ratio* 分支对 `camera_stage.object` 永远走不到（object 实体
 * 压根没声明这些属性），color / transform.scale 对 camera 同理。
 */

const ENTITY = CAMERA_STAGE_ENTITY_TYPES

function vec3(value: JsonValue | undefined): StageVec3 {
  return z.object({ x: z.number(), y: z.number(), z: z.number() }).strict().parse(value)
}

function stringValue(value: JsonValue | undefined): string {
  return z.string().parse(value)
}

function numberValue(value: JsonValue | undefined): number {
  return z.number().parse(value)
}

function booleanValue(value: JsonValue | undefined): boolean {
  return z.boolean().parse(value)
}

function refId(value: JsonValue | undefined): string | null {
  if (value === null) return null
  return z.object({ kind: z.string(), id: z.string() }).passthrough().parse(value).id.split(':').pop() ?? null
}

/* ── 工程 ─────────────────────────────────────────────────────────────── */

export interface CameraStageProjectDraft {
  readonly projectId: string
  rename?: string
}

export const CAMERA_STAGE_PROJECT_WRITERS: ApplicationPropertyWriterTable<CameraStageProjectDraft> = {
  [`${ENTITY.project}.name`]: {
    write(draft, mutation) { draft.rename = stringValue(mutation.value) },
  },
}

/* ── 场景 ─────────────────────────────────────────────────────────────── */

/**
 * 场景外观 25 项 + 时间轴 3 项，定义收敛在 cameraStageSceneFields.ts（1.1 统一字段定义机制的
 * 首个试点）。界面上有的每一项那边都要有：此前这一组一项都没接，助手做不了"把天空改成深蓝"
 * "地面换成网格""把太阳调到黄昏"。
 */
export { CAMERA_STAGE_SCENE_WRITERS } from './cameraStageSceneFields'

/* ── 对象与摄像机 ─────────────────────────────────────────────────────── */

/**
 * 变换三轴要累积进同一个 transform 再一次性提交——逐轴提交会在时间轴上打出三个独立改动。
 * `current` 供画幅与注视点互读：改 preset 时要保留现有 ratio，反之亦然。
 */
export interface CameraStageObjectDraft {
  readonly current: StageObject
  readonly update: CameraStageObjectUpdate
  transform: StageTransform
  transformTouched: boolean
}

function touchTransform(draft: CameraStageObjectDraft): void {
  draft.transformTouched = true
}

export const CAMERA_STAGE_OBJECT_WRITERS: ApplicationPropertyWriterTable<CameraStageObjectDraft> = {
  [`${ENTITY.object}.name`]: { write: (draft, m) => { draft.update.name = stringValue(m.value) } },
  [`${ENTITY.object}.visible`]: { write: (draft, m) => { draft.update.visible = booleanValue(m.value) } },
  [`${ENTITY.object}.color`]: { write: (draft, m) => { draft.update.color = stringValue(m.value) } },
  [`${ENTITY.object}.character_variant`]: {
    write: (draft, m) => { draft.update.variant = z.enum(['standard', 'strong', 'slim', 'child']).parse(m.value) },
  },
  [`${ENTITY.object}.transform.position`]: {
    write: (draft, m) => { draft.transform.position = vec3(m.value); touchTransform(draft) },
  },
  [`${ENTITY.object}.transform.rotation`]: {
    write: (draft, m) => { draft.transform.rotation = vec3(m.value); touchTransform(draft) },
  },
  [`${ENTITY.object}.transform.scale`]: {
    write: (draft, m) => { draft.transform.scale = vec3(m.value); touchTransform(draft) },
  },
}

export const CAMERA_STAGE_CAMERA_WRITERS: ApplicationPropertyWriterTable<CameraStageObjectDraft> = {
  [`${ENTITY.camera}.name`]: { write: (draft, m) => { draft.update.name = stringValue(m.value) } },
  [`${ENTITY.camera}.visible`]: { write: (draft, m) => { draft.update.visible = booleanValue(m.value) } },
  [`${ENTITY.camera}.transform.position`]: {
    write: (draft, m) => { draft.transform.position = vec3(m.value); touchTransform(draft) },
  },
  [`${ENTITY.camera}.transform.rotation`]: {
    write: (draft, m) => { draft.transform.rotation = vec3(m.value); touchTransform(draft) },
  },
  [`${ENTITY.camera}.fov`]: { write: (draft, m) => { draft.update.fov = numberValue(m.value) } },
  [`${ENTITY.camera}.look_at_target`]: {
    write: (draft, m) => { draft.update.lookAt = { mode: 'manual', target: vec3(m.value) } },
  },
  [`${ENTITY.camera}.look_at_object_ref`]: {
    write: (draft, m) => {
      const id = refId(m.value)
      if (!id || draft.current.type !== 'camera') throw new Error('INVALID_REFERENCE')
      draft.update.lookAt = {
        mode: 'object',
        objectId: id,
        fallbackTarget: draft.current.lookAt.mode === 'manual'
          ? draft.current.lookAt.target
          : draft.current.lookAt.fallbackTarget,
      }
    },
  },
  [`${ENTITY.camera}.aspect_ratio_preset`]: {
    write: (draft, m) => {
      if (draft.current.type !== 'camera') throw new Error('OBJECT_TYPE_MISMATCH')
      draft.update.aspectRatio = {
        preset: z.enum(['16:9', '4:3', '1:1', '9:16', 'custom']).parse(m.value),
        ratio: draft.update.aspectRatio?.ratio ?? draft.current.aspectRatio.ratio,
      }
    },
  },
  [`${ENTITY.camera}.aspect_ratio`]: {
    write: (draft, m) => {
      if (draft.current.type !== 'camera') throw new Error('OBJECT_TYPE_MISMATCH')
      draft.update.aspectRatio = {
        preset: draft.update.aspectRatio?.preset ?? draft.current.aspectRatio.preset,
        ratio: numberValue(m.value),
      }
    },
  },
}

/* ── 镜头卡 ───────────────────────────────────────────────────────────── */

export type CameraStageShotDraft = CameraStageShotUpdate

/**
 * `time` 此前是这张表里唯一缺失的一项——反射层早就声明它可写，执行器没有对应分支。
 * 时间点落到 store 的 moveShotTime，那里负责对帧量化并保持镜头卡有序。
 */
export const CAMERA_STAGE_SHOT_WRITERS: ApplicationPropertyWriterTable<CameraStageShotDraft> = {
  [`${ENTITY.shot}.name`]: { write: (draft, m) => { draft.name = stringValue(m.value) } },
  [`${ENTITY.shot}.time`]: { write: (draft, m) => { draft.time = numberValue(m.value) } },
  [`${ENTITY.shot}.hold`]: { write: (draft, m) => { draft.hold = numberValue(m.value) } },
  [`${ENTITY.shot}.transition_duration`]: { write: (draft, m) => { draft.transitionDuration = numberValue(m.value) } },
  [`${ENTITY.shot}.continuity`]: { write: (draft, m) => { draft.continuity = z.enum(['stop', 'smooth']).parse(m.value) } },
  [`${ENTITY.shot}.camera_ref`]: { write: (draft, m) => { draft.cameraId = refId(m.value) } },
}

/* ── 播放控制 ─────────────────────────────────────────────────────────── */

/**
 * 三项累积成一次提交：先定位播放头、再设循环、最后决定播不播。
 * 逐项立即执行会出现"先 play 再 seek"把刚播的位置又拽回去这类顺序事故。
 */
export interface CameraStagePlaybackDraft {
  playing?: boolean
  currentTime?: number
  loop?: boolean
}

export const CAMERA_STAGE_PLAYBACK_WRITERS: ApplicationPropertyWriterTable<CameraStagePlaybackDraft> = {
  [`${ENTITY.playback}.playing`]: { write: (draft, m) => { draft.playing = booleanValue(m.value) } },
  [`${ENTITY.playback}.current_time`]: { write: (draft, m) => { draft.currentTime = numberValue(m.value) } },
  [`${ENTITY.playback}.loop`]: { write: (draft, m) => { draft.loop = booleanValue(m.value) } },
}

/* ── 关键帧 ───────────────────────────────────────────────────────────── */

/**
 * `currentTime` 是顺序依赖状态：同一批 mutation 里先改 time 再改 value 时，
 * value 必须用**新**时间去定位关键帧，否则找不到。
 */
export interface CameraStageKeyframeDraft {
  readonly objectId: string
  readonly path: string
  currentTime: number
}

export const CAMERA_STAGE_KEYFRAME_WRITERS: ApplicationPropertyWriterTable<CameraStageKeyframeDraft> = {
  [`${ENTITY.keyframe}.time`]: {
    write(draft, mutation) {
      const nextTime = numberValue(mutation.value)
      useCameraStageStore.getState().moveKeyframe(draft.objectId, draft.path, draft.currentTime, nextTime)
      draft.currentTime = nextTime
    },
  },
  [`${ENTITY.keyframe}.value`]: {
    write(draft, mutation) {
      const track = useCameraStageStore.getState().animation.tracks
        .find((candidate) => candidate.objectId === draft.objectId && candidate.propertyPath === draft.path)
      const keyframe = track?.keyframes.find((candidate) => candidate.time === draft.currentTime)
      if (!keyframe) throw new Error('NOT_FOUND')
      const raw = stringValue(mutation.value)
      const value: StageKeyframeValue = typeof keyframe.value === 'number' ? Number(raw) : raw
      if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('INVALID_INPUT')
      useCameraStageStore.setState((current) => ({
        animation: setTrackKeyframeValue(current.animation, draft.objectId, draft.path, draft.currentTime, value),
      }))
    },
  },
  [`${ENTITY.keyframe}.easing`]: {
    write(draft, mutation) {
      const easing = z.enum(['linear', 'easeIn', 'easeOut', 'easeInOut', 'hold'])
        .parse(mutation.value) as StageEasingPreset
      useCameraStageStore.getState()
        .setKeyframesEasing([{ objectId: draft.objectId, path: draft.path, time: draft.currentTime }], easing)
    },
  },
}
