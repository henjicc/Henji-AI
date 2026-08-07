import { z } from 'zod'

import { fieldWriterTable, type ApplicationPropertyMutation, type ApplicationRef } from '@/core/application-control'
import { CAMERA_STAGE_NAME_MAX_LENGTH } from '@/core/assistant/capabilities/cameraStageCapabilitySchemas'

import type { StageEasingPreset, StageKeyframeValue } from '../domain/animationTypes'
import type { StageShot } from '../domain/shotTypes'
import { setTrackKeyframeValue } from '../store/animationActions'
import { useCameraStageStore } from '../store/cameraStageStore'
import type { CameraStageProjectSnapshot } from '../projects/cameraStageProjectService'
import type { CameraStageShotUpdate } from './cameraStageApplicationService'
import {
  booleanCodec, enumCodec, nameCodec, numberCodec, refIdCodec, stageDescriptor, stageField, stringCodec,
  type ValueCodec,
} from './cameraStageFieldShared'

/*
 * 三维 project(1) / shot(6) / keyframe(3) / playback(3) 共 13 条可写属性的统一定义——1.3 迁移。
 *
 * 四类实体各自的写入目标（draft）形态都不同：project 是一次性 rename 累积器，shot 是整份补丁，
 * playback 是三项累积成一次提交，keyframe 的 draft 只带上下文（objectId/path/currentTime）、
 * 真正的写入落在全局 store（time 的顺序依赖、value/easing 需要查当前关键帧）。
 */

const PROJECT_ENTITY_TYPE = 'camera_stage.project' as const
const SHOT_ENTITY_TYPE = 'camera_stage.shot' as const
const KEYFRAME_ENTITY_TYPE = 'camera_stage.keyframe' as const
const PLAYBACK_ENTITY_TYPE = 'camera_stage.playback' as const
const CAMERA_ENTITY_TYPE = 'camera_stage.camera' as const

/* ── 工程 ─────────────────────────────────────────────────────────────── */

export interface CameraStageProjectDraft {
  readonly projectId: string
  rename?: string
}

export const PROJECT_FIELDS = [
  stageField<CameraStageProjectSnapshot, CameraStageProjectDraft, string, never>(
    PROJECT_ENTITY_TYPE, 'name', '工程名称', nameCodec(CAMERA_STAGE_NAME_MAX_LENGTH),
    {
      read: (snapshot) => snapshot.name,
      write: (draft, value) => { draft.rename = value },
      storeActions: [],
    },
  ),
]

export const CAMERA_STAGE_PROJECT_WRITERS = fieldWriterTable(PROJECT_FIELDS)

/* ── 镜头卡 ───────────────────────────────────────────────────────────── */

export type CameraStageShotDraft = CameraStageShotUpdate

interface ShotFieldSource {
  readonly projectId: string
  readonly shot: StageShot
}

function shotField<T, TAction extends string>(
  suffix: string,
  title: string,
  codec: ValueCodec<T>,
  options: {
    read: (source: ShotFieldSource) => T
    write: (draft: CameraStageShotDraft, value: T) => void
    storeActions: readonly TAction[]
    unit?: string
    nullable?: boolean
  },
) {
  return stageField<ShotFieldSource, CameraStageShotDraft, T, TAction>(SHOT_ENTITY_TYPE, suffix, title, codec, options)
}

/*
 * `time` 被 `moveShotTime` 与 `updateShotTiming` 两个 store 动作共用——时间点落到 store 的
 * moveShotTime，那里负责对帧量化并保持镜头卡有序；`fieldLedgerEntries()` 会把两个动作各自的
 * 绑定都建出来，`time` 出现在两条账本条目里。
 */
export const SHOT_FIELDS = [
  shotField('name', '镜头名称', nameCodec(CAMERA_STAGE_NAME_MAX_LENGTH), {
    read: ({ shot }) => shot.name, write: (draft, v) => { draft.name = v }, storeActions: ['updateShotName'] as const,
  }),
  shotField('time', '时间点', numberCodec({ min: 0, max: 3600 }), {
    read: ({ shot }) => shot.time, write: (draft, v) => { draft.time = v },
    storeActions: ['moveShotTime', 'updateShotTiming'] as const, unit: 'second',
  }),
  shotField('hold', '停留时长', numberCodec({ min: 0, max: 3600 }), {
    read: ({ shot }) => shot.hold, write: (draft, v) => { draft.hold = v },
    storeActions: ['updateShotTiming'] as const, unit: 'second',
  }),
  shotField('transition_duration', '过渡时长', numberCodec({ min: 0, max: 3600 }), {
    read: ({ shot }) => shot.transitionDuration, write: (draft, v) => { draft.transitionDuration = v },
    storeActions: ['updateShotTransition'] as const, unit: 'second',
  }),
  shotField('continuity', '连续性', enumCodec(['stop', 'smooth'] as const, { stop: '停靠', smooth: '连续' }), {
    read: ({ shot }) => shot.continuity, write: (draft, v) => { draft.continuity = v },
    storeActions: ['updateShotContinuity'] as const,
  }),
  {
    propertyId: `${SHOT_ENTITY_TYPE}.camera_ref`,
    descriptor: stageDescriptor(SHOT_ENTITY_TYPE, 'camera_ref', '拍摄机位', { kind: 'ref', refKinds: [CAMERA_ENTITY_TYPE] }, {
      nullable: true,
      relation: { targetEntityTypes: [CAMERA_ENTITY_TYPE], cardinality: 'optional' },
    }),
    read: ({ projectId, shot }: ShotFieldSource) => (shot.cameraId
      ? ({ kind: CAMERA_ENTITY_TYPE, id: `${projectId}:${shot.cameraId}` } satisfies ApplicationRef)
      : null),
    writer: {
      write: (draft: CameraStageShotDraft, mutation: ApplicationPropertyMutation) => {
        draft.cameraId = refIdCodec([CAMERA_ENTITY_TYPE]).parse(mutation.value)
      },
    },
    storeActions: ['updateShotCamera'] as const,
  },
]

export const CAMERA_STAGE_SHOT_WRITERS = fieldWriterTable(SHOT_FIELDS)

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

interface PlaybackSnapshot {
  readonly playing: boolean
  readonly currentTime: number
  readonly loop: boolean
}

export const PLAYBACK_FIELDS = [
  stageField<PlaybackSnapshot, CameraStagePlaybackDraft, boolean, 'play' | 'pause' | 'stop'>(
    PLAYBACK_ENTITY_TYPE, 'playing', '正在播放', booleanCodec,
    {
      read: (p) => p.playing,
      write: (draft, v) => { draft.playing = v },
      storeActions: ['play', 'pause', 'stop'],
      description: '时间轴是否正在播放。助手做完动画后靠它自己预览验证，而不是让用户去点播放。',
    },
  ),
  stageField<PlaybackSnapshot, CameraStagePlaybackDraft, number, 'stop' | 'seek'>(
    PLAYBACK_ENTITY_TYPE, 'current_time', '播放头位置', numberCodec({ min: 0, max: 3600 }),
    {
      read: (p) => p.currentTime,
      write: (draft, v) => { draft.currentTime = v },
      storeActions: ['stop', 'seek'],
      unit: 'second',
      description: '播放头当前所在时间。写入等价于界面上拖动时间指针。',
    },
  ),
  stageField<PlaybackSnapshot, CameraStagePlaybackDraft, boolean, 'toggleLoop'>(
    PLAYBACK_ENTITY_TYPE, 'loop', '循环播放', booleanCodec,
    {
      read: (p) => p.loop,
      write: (draft, v) => { draft.loop = v },
      storeActions: ['toggleLoop'],
    },
  ),
]

export const CAMERA_STAGE_PLAYBACK_WRITERS = fieldWriterTable(PLAYBACK_FIELDS)

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

interface KeyframeSnapshot {
  readonly time: number
  readonly value: StageKeyframeValue
  readonly easing: unknown
}

function keyframeValueSummary(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

export const KEYFRAME_FIELDS = [
  stageField<KeyframeSnapshot, CameraStageKeyframeDraft, number, 'moveKeyframe'>(
    KEYFRAME_ENTITY_TYPE, 'time', '时间', numberCodec({ min: 0, max: 3600 }),
    {
      read: (kf) => kf.time,
      write: (draft, nextTime) => {
        useCameraStageStore.getState().moveKeyframe(draft.objectId, draft.path, draft.currentTime, nextTime)
        draft.currentTime = nextTime
      },
      storeActions: ['moveKeyframe'],
      unit: 'second',
    },
  ),
  stageField<KeyframeSnapshot, CameraStageKeyframeDraft, string, 'setKeyframeValue'>(
    KEYFRAME_ENTITY_TYPE, 'value', '值摘要', stringCodec,
    {
      read: (kf) => keyframeValueSummary(kf.value),
      write: (draft, raw) => {
        const track = useCameraStageStore.getState().animation.tracks
          .find((candidate) => candidate.objectId === draft.objectId && candidate.propertyPath === draft.path)
        const keyframe = track?.keyframes.find((candidate) => candidate.time === draft.currentTime)
        if (!keyframe) throw new Error('NOT_FOUND')
        const value: StageKeyframeValue = typeof keyframe.value === 'number' ? Number(raw) : raw
        if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('INVALID_INPUT')
        useCameraStageStore.setState((current) => ({
          animation: setTrackKeyframeValue(current.animation, draft.objectId, draft.path, draft.currentTime, value),
        }))
      },
      storeActions: ['setKeyframeValue'],
    },
  ),
  stageField<KeyframeSnapshot, CameraStageKeyframeDraft, string, 'setKeyframesEasing'>(
    KEYFRAME_ENTITY_TYPE, 'easing', '缓动', stringCodec,
    {
      read: (kf) => keyframeValueSummary(kf.easing),
      write: (draft, raw) => {
        const easing = z.enum(['linear', 'easeIn', 'easeOut', 'easeInOut', 'hold']).parse(raw) as StageEasingPreset
        useCameraStageStore.getState()
          .setKeyframesEasing([{ objectId: draft.objectId, path: draft.path, time: draft.currentTime }], easing)
      },
      storeActions: ['setKeyframesEasing'],
    },
  ),
]

export const CAMERA_STAGE_KEYFRAME_WRITERS = fieldWriterTable(KEYFRAME_FIELDS)
