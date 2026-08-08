import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'

import { fieldWriterTable, type ApplicationPropertyMutation, type ApplicationPropertyValue, type JsonValue } from '@/core/application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/assistant/applicationCapabilities'

import type { StageVec3 } from '../domain/sceneTypes'
import type { StageSpatialPath, StageSpatialPathKnot } from '../domain/shotTypes'
import { stageDescriptor, stageField, vector3Codec, type ValueCodec } from './cameraStageFieldShared'

/*
 * 三维轨迹（`camera_stage.trajectory`）5 条可写属性——2.5。
 *
 * 界面上手动编辑轨迹（拖控制点、拖切线手柄、拖起止端点）全部收敛到两个 store 动作：
 * `setShotSpatialPath`（整条路径替换——`StageMotionPathOverlay.tsx` 里拖任何一个控制点或
 * 切线手柄都是"读当前路径→改一处→整条写回"，没有单独的"改一个控制点"store 方法）与
 * `setShotPathAnchor`（挪起止端点——语义是改相邻镜头卡里该对象的位置快照，不是改
 * `spatialPath.knots`，起止点由相邻卡快照提供、不重复存储，见 shotTypes.ts 的注释）。
 *
 * 因此不新增 `trajectory_knot` 子实体：`knots` 作为一个 json 数组属性整体读写，与
 * `start_out_tangent`/`end_in_tangent`（路径自身的边缘切线）一起累加进
 * `CameraStageTrajectoryDraft.path`，一次性调用 `setShotSpatialPath`；
 * `start_position`/`end_position` 走独立的 `setShotPathAnchor`。
 */

const TRAJECTORY_ENTITY_TYPE = 'camera_stage.trajectory' as const

export interface TrajectoryFieldSource {
  readonly path: StageSpatialPath
  readonly startPosition: StageVec3
  readonly endPosition: StageVec3
}

/**
 * `path` 由执行器用当前值预先填好（与三维 object 的 `transform` 累加器同一手法），
 * 各字段的 write 只改其中一处再标记 touched；`startPosition`/`endPosition`
 * 走另一个 store 动作，独立累加、互不影响。
 */
export interface CameraStageTrajectoryDraft {
  path: StageSpatialPath
  pathTouched: boolean
  startPosition?: StageVec3
  endPosition?: StageVec3
}

function digest(seed: string): string {
  const value = [...seed].reduce((total, char) => (total * 33 + char.charCodeAt(0)) >>> 0, 5381).toString(16)
  return `sha256:${value.padEnd(64, value).slice(0, 64)}`
}

function trajectoryField<T, TAction extends string>(
  suffix: string,
  title: string,
  codec: ValueCodec<T>,
  options: {
    read: (source: TrajectoryFieldSource) => T
    write: (draft: CameraStageTrajectoryDraft, value: T) => void
    storeActions: readonly TAction[]
    unit?: string
  },
) {
  return stageField<TrajectoryFieldSource, CameraStageTrajectoryDraft, T, TAction>(TRAJECTORY_ENTITY_TYPE, suffix, title, codec, options)
}

const vec3Schema = z.object({ x: z.number(), y: z.number(), z: z.number() }).strict()
const knotInputSchema = z.object({
  /** 省略时自动生成——助手整条重写轨迹时不需要关心既有 id，只有想保留/定位某个控制点时才传。 */
  id: z.string().min(1).optional(),
  position: vec3Schema,
  inTangent: vec3Schema,
  outTangent: vec3Schema,
}).strict()

function knotToJson(knot: StageSpatialPathKnot): JsonValue {
  return {
    id: knot.id,
    position: { x: knot.position.x, y: knot.position.y, z: knot.position.z },
    inTangent: { x: knot.inTangent.x, y: knot.inTangent.y, z: knot.inTangent.z },
    outTangent: { x: knot.outTangent.x, y: knot.outTangent.y, z: knot.outTangent.z },
  }
}

const KNOTS_VALUE: ApplicationPropertyValue = {
  kind: 'json',
  schemaRef: {
    catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION,
    kind: 'property',
    id: `${TRAJECTORY_ENTITY_TYPE}.knots.value`,
    version: 1,
    digest: digest(`property:${TRAJECTORY_ENTITY_TYPE}.knots.value`),
  },
}

const knotsCodec: ValueCodec<StageSpatialPathKnot[]> = {
  value: KNOTS_VALUE,
  parse: (raw) => z.array(knotInputSchema).max(64).parse(raw).map((knot) => ({
    id: knot.id ?? uuidv4(),
    position: knot.position,
    inTangent: knot.inTangent,
    outTangent: knot.outTangent,
  })),
  encode: (value) => value.map(knotToJson),
}

export const TRAJECTORY_FIELDS = [
  {
    propertyId: `${TRAJECTORY_ENTITY_TYPE}.knots`,
    descriptor: stageDescriptor(TRAJECTORY_ENTITY_TYPE, 'knots', '控制点', KNOTS_VALUE, {
      description: '过渡内部的空间控制点（贝塞尔曲线），按数组整体读写——拖动任意一个控制点或切线'
        + '手柄，界面上都是"整条路径重新写回"，不是逐点增删。写入会替换全部控制点；元素里的 id 省略'
        + '时自动生成。起止端点不在这里，见 start_position/end_position。',
    }),
    read: ({ path }: TrajectoryFieldSource): JsonValue => knotsCodec.encode(path.knots),
    writer: {
      write: (draft: CameraStageTrajectoryDraft, mutation: ApplicationPropertyMutation) => {
        draft.path = { ...draft.path, knots: knotsCodec.parse(mutation.value) }
        draft.pathTouched = true
      },
    },
    storeActions: ['setShotSpatialPath'] as const,
  },
  trajectoryField('start_out_tangent', '起点出手柄', vector3Codec('scene_unit'), {
    read: ({ path }) => path.startOutTangent,
    write: (draft, v) => { draft.path = { ...draft.path, startOutTangent: v }; draft.pathTouched = true },
    storeActions: ['setShotSpatialPath'] as const,
  }),
  trajectoryField('end_in_tangent', '终点入手柄', vector3Codec('scene_unit'), {
    read: ({ path }) => path.endInTangent,
    write: (draft, v) => { draft.path = { ...draft.path, endInTangent: v }; draft.pathTouched = true },
    storeActions: ['setShotSpatialPath'] as const,
  }),
  trajectoryField('start_position', '起点位置', vector3Codec('scene_unit'), {
    read: ({ startPosition }) => startPosition,
    write: (draft, v) => { draft.startPosition = v },
    storeActions: ['setShotPathAnchor'] as const,
  }),
  trajectoryField('end_position', '终点位置', vector3Codec('scene_unit'), {
    read: ({ endPosition }) => endPosition,
    write: (draft, v) => { draft.endPosition = v },
    storeActions: ['setShotPathAnchor'] as const,
  }),
]

export const CAMERA_STAGE_TRAJECTORY_WRITERS = fieldWriterTable(TRAJECTORY_FIELDS)
