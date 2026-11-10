import { Vector3 } from 'three'

import type { z } from 'zod'

import { createLogger } from '@/core/logging'
import {
  resolveCameraStageShotRelation,
  type cameraStageComposedShotSchema,
  CAMERA_STAGE_SHOT_SIZE_LABELS,
  type CameraStageShotAngle,
  type cameraStageShotIntentShape,
  type CameraStageShotRelation,
  type CameraStageShotSubjectInput,
} from '@/core/application-control/domains/cameraStage/cameraStageShotSchemas'
import type { StageCameraObject, StageObject, StageVec3 } from '../domain/sceneTypes'
import { quantizeToFrame } from '../stateKeyframes/timeline/stateKeyframeClipGeometry'
import { applyAnimationAtTime } from '../store/playbackSampling'
import { cameraStageProjectStore, ensureCameraStageProjectRuntime, saveCameraStageProjectRuntime, bindCameraStageProjectOperation } from './cameraStageProjectRuntime'
import { afterCameraStageWrite, captureCameraStageUndo } from './cameraStageUndo'
import { ensureStateKeyframeAt } from './cameraStageKeyframeWrites'
import { axisNormalFor, axisSideOf, composeShot, type ShotKind, type ShotSolution } from './shotComposition'
import {
  projectPoint,
  readShot,
  shotCameraOf,
  shotObstacles,
  shotSubjectFromObject,
  shotSubjectFromPoint,
  subjectKeyPoint,
  type StageShotSubject,
} from './shotGeometry'

const logger = createLogger('features.cameraStage.shot')

export type CameraStageShotInput = { projectId: string } & z.output<z.ZodObject<typeof cameraStageShotIntentShape>>

/** 每台摄像机的结果就是对外契约里的一条，类型从契约 schema 推出。 */
type CameraStageShotCameraResult = z.infer<typeof cameraStageComposedShotSchema>

export interface CameraStageShotResult {
  projectId: string
  time: number
  /** 省略 at 时整条时间轴都摆在这里，为 null */
  stateKeyframeId: string | null
  createdStateKeyframe: boolean
  shots: CameraStageShotCameraResult[]
  /** 有改动、遮挡、出画，或读回与要的不一致时的提示 */
  compositionHint?: string
  undoToken: string
}

const vec = (value: Vector3): StageVec3 => ({ x: Math.round(value.x * 1000) / 1000, y: Math.round(value.y * 1000) / 1000, z: Math.round(value.z * 1000) / 1000 })

function requireCamera(objects: readonly StageObject[], cameraId: string): StageCameraObject {
  const camera = objects.find((object) => object.id === cameraId)
  if (camera?.type === 'camera') return camera
  const cameras = objects.filter((object) => object.type === 'camera').map((object) => `${object.id}（${object.name}）`)
  throw new Error(`CAMERA_NOT_FOUND：«${cameraId}» 不是本场景中的摄像机 id。当前摄像机：${cameras.join('、') || '没有'}；新机位先用 place_camera_stage_object（objectType=camera, reusePolicy=require_new）建一台。`)
}

function resolveSubject(objects: readonly StageObject[], input: CameraStageShotSubjectInput): StageShotSubject {
  if ('point' in input) return shotSubjectFromPoint(input.point, input.height)
  const object = objects.find((candidate) => candidate.id === input.objectId)
  if (object && object.type !== 'camera') return shotSubjectFromObject(object)
  const available = objects.filter((candidate) => candidate.type !== 'camera' && !candidate.setId).map((candidate) => `${candidate.id}（${candidate.name}）`)
  throw new Error(object
    ? `SUBJECT_IS_CAMERA：«${input.objectId}» 是摄像机，不能当主体。`
    : `SUBJECT_NOT_FOUND：«${input.objectId}» 不是本场景中的对象 id。可用主体：${available.join('、') || '没有'}；布景里的地点用 { point, height }。`)
}

/**
 * 两人镜头守哪一侧轴线：已有别的摄像机拍着这两人（任意一人在它画面里）就跟它同侧，
 * 否则跟这台摄像机原来所在的一侧；crossAxis 有意越到另一侧。
 */
function resolveAxisSide(objects: readonly StageObject[], cameras: readonly StageCameraObject[], subjects: readonly StageShotSubject[], crossAxis: boolean): { side: 1 | -1; reference: string } {
  const own = new Set(cameras.map((camera) => camera.id))
  const covering = objects.find((object): object is StageCameraObject => object.type === 'camera' && !own.has(object.id) && subjects.some((subject) => {
    const projected = projectPoint(shotCameraOf(object), subjectKeyPoint(subject))
    return projected.front && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1
  }))
  const anchor = covering ?? cameras[0]
  const position = new Vector3(anchor.transform.position.x, anchor.transform.position.y, anchor.transform.position.z)
  const side = axisSideOf(position, subjects)
  return { side: crossAxis ? (-side as 1 | -1) : side, reference: covering ? `同已有机位「${covering.name}」` : `「${anchor.name}」原来所在的一侧` }
}

interface ShotPlan {
  camera: StageCameraObject
  kind: ShotKind
  subjects: StageShotSubject[]
}

function plansFor(relation: CameraStageShotRelation, cameras: readonly StageCameraObject[], subjects: StageShotSubject[]): ShotPlan[] {
  if (relation === 'reverse_pair') {
    return [
      { camera: cameras[0], kind: 'over_shoulder', subjects: [subjects[0], subjects[1]] },
      { camera: cameras[1], kind: 'over_shoulder', subjects: [subjects[1], subjects[0]] },
    ]
  }
  return [{ camera: cameras[0], kind: relation, subjects }]
}

function samePosition(a: StageVec3 | undefined, b: StageVec3): boolean {
  return !!a && Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.z - b.z) < 1e-6
}

type CameraStageState = ReturnType<ReturnType<typeof cameraStageProjectStore>['getState']>

/** 对象在时间轴上会不会移动：各状态关键帧里的位置不同，或有空间路径。 */
function objectMoves(state: CameraStageState, objectId: string): boolean {
  if (state.stateKeyframes.some((stateKeyframe) => stateKeyframe.transition.perObject[objectId]?.spatialPath)) return true
  // 没记录这个对象的状态关键帧不算它在动。
  const positions = state.stateKeyframes.flatMap((stateKeyframe) => {
    const objectState = stateKeyframe.objectStates[objectId]
    return objectState ? [JSON.stringify(objectState.transform.position)] : []
  })
  return positions.some((position) => position !== positions[0])
}

/**
 * 摄像机在时间轴上有没有动：状态关键帧之间机位、焦距或注视不同，有空间路径，
 * 或者盯着一个会走动的对象（跟拍）——整条时间轴摆成固定注视点会把跟拍抹掉。
 */
function cameraIsAnimated(state: CameraStageState, cameraId: string): boolean {
  if (objectMoves(state, cameraId)) return true
  if (state.stateKeyframes.some((stateKeyframe) => stateKeyframe.transition.perObject[cameraId]?.follow)) return true
  const states = state.stateKeyframes.map((stateKeyframe) => stateKeyframe.objectStates[cameraId]).filter(Boolean)
  const signature = (index: number): string => JSON.stringify([states[index]?.fov, states[index]?.lookAt])
  if (states.some((_, index) => signature(index) !== signature(0))) return true
  return states.some((cameraState) => cameraState?.lookAt?.mode === 'object' && objectMoves(state, cameraState.lookAt.objectId))
}

const ANGLE_LABELS: Record<CameraStageShotAngle, string> = { eye_level: '平视', high: '俯拍', low: '仰拍', birds_eye: '鸟瞰' }

/** 整条时间轴摆机位时主体会走开：构图只对着现在这一刻。 */
function movingSubjectHints(state: CameraStageState, staticSubjects: readonly StageShotSubject[] | null): string[] {
  return (staticSubjects ?? [])
    .filter((subject) => subject.objectId && objectMoves(state, subject.objectId))
    .map((subject) => `「${subject.name}」在时间轴上会移动，整条时间轴摆机位只对着现在这一刻；要跟住就在起点和终点各给 at`)
}

/** 改动、遮挡、出画，以及读回的景别或角度与要的不一致，都要说出来，不能让结果看起来像做到了。 */
function shotHints(shot: CameraStageShotCameraResult): string[] {
  const hints: string[] = []
  if (shot.adjusted) hints.push(`「${shot.name}」${shot.adjusted.summary.replace(/。$/, '')}`)
  for (const subject of shot.composition.subjects) {
    if (!subject.inFrame) hints.push(`「${shot.name}」里「${subject.name}」不在画面内`)
    else if (!subject.keyVisible) hints.push(`「${shot.name}」里「${subject.name}」被${subject.occludedBy.map((item) => `「${item.name}」`).join('') || '其他对象'}挡住`)
  }
  const primaries = shot.kind === 'over_shoulder' ? shot.composition.subjects.slice(-1) : shot.composition.subjects
  if (primaries.length > 0 && !primaries.some((subject) => subject.shotSize === shot.size)) {
    const actual = primaries.map((subject) => `「${subject.name}」${subject.shotSize ? CAMERA_STAGE_SHOT_SIZE_LABELS[subject.shotSize] : '看不到'}`).join('、')
    hints.push(`「${shot.name}」实际景别是${actual}，不是要的${CAMERA_STAGE_SHOT_SIZE_LABELS[shot.size]}${shot.kind === 'two_shot' ? '：双人镜头的景别受两人间距限制，调整两人距离或改用单人镜头' : ''}`)
  }
  if (shot.composition.angle !== shot.angle) {
    hints.push(`「${shot.name}」实际角度是${ANGLE_LABELS[shot.composition.angle]}，不是要的${ANGLE_LABELS[shot.angle]}${shot.kind === 'over_shoulder'
      ? '：过肩机位与前景那人眼睛同高，俯仰来自两人的高低差' : ''}`)
  }
  return hints
}

function readBack(
  solved: ReadonlyArray<{ plan: ShotPlan; solution: ShotSolution }>,
  objects: StageObject[],
  request: { angle: CameraStageShotAngle; axis: { reference: string } | null; crossAxis: boolean },
): CameraStageShotCameraResult[] {
  const obstacles = shotObstacles(objects)
  return solved.map(({ plan, solution }) => {
    const camera = requireCamera(objects, plan.camera.id)
    const pose = shotCameraOf(camera)
    const foreground = plan.kind === 'over_shoulder' ? plan.subjects[0].objectId : null
    const composition = readShot(pose, plan.subjects, obstacles, foreground ? new Set([foreground]) : undefined)
    const ordered = [...composition.subjects].sort((left, right) => (left.center?.x ?? 0) - (right.center?.x ?? 0))
    return {
      cameraId: camera.id,
      name: camera.name,
      kind: plan.kind,
      position: vec(pose.position),
      lookAtTarget: camera.lookAt.mode === 'manual' ? { ...camera.lookAt.target } : vec(solution.lookAtTarget),
      focalLength: solution.focalLength,
      size: solution.size,
      angle: request.angle,
      lens: solution.lens,
      adjusted: solution.adjusted,
      axis: request.axis && ordered.length === 2
        ? { reference: request.axis.reference, crossed: request.crossAxis, screenLeft: ordered[0].name, screenRight: ordered[1].name }
        : null,
      composition,
    }
  })
}

async function composeCameraStageShotInternal(input: CameraStageShotInput): Promise<CameraStageShotResult> {
  const relation = resolveCameraStageShotRelation(input)
  logger.info('三维构图定机位开始', {
    event: 'camera_stage.compose.start', projectId: input.projectId, cameraId: input.cameraId, relation, size: input.size ?? null, angle: input.angle,
  })
  try {
    await ensureCameraStageProjectRuntime(input.projectId)
    const store = cameraStageProjectStore(input.projectId)
    const state = store.getState()
    const cameras = [input.cameraId, ...(input.reverseCameraId ? [input.reverseCameraId] : [])].map((id) => requireCamera(state.objects, id))

    let time = state.playback.currentTime
    let stateKeyframeId: string | null = null
    if (input.at && 'stateKeyframeId' in input.at) {
      const requested = input.at.stateKeyframeId
      const stateKeyframe = state.stateKeyframes.find((item) => item.id === requested || `${input.projectId}:${item.id}` === requested)
      if (!stateKeyframe) {
        throw new Error(`STATE_KEYFRAME_NOT_FOUND：«${requested}» 不是本场景的状态关键帧。当前：${state.stateKeyframes.map((item) => `${item.id}（${item.time} 秒）`).join('、')}；也可以改传 at.time。`)
      }
      time = stateKeyframe.time
      stateKeyframeId = stateKeyframe.id
    } else if (input.at) {
      time = quantizeToFrame(input.at.time, state.animation.fps)
    } else {
      const animated = cameras.find((camera) => cameraIsAnimated(state, camera.id))
      if (animated) {
        throw new Error(`CAMERA_ANIMATED：摄像机「${animated.name}」在时间轴上有运镜，整条时间轴摆机位会抹掉它；传 at.time 或 at.stateKeyframeId 只定那一刻的机位。`)
      }
    }

    // 主体与障碍按目标时刻的播放画面取：人会走动，定机位要对着那一刻的位置。
    const sampled = input.at ? applyAnimationAtTime(state.objects, state.animation, time) : state.objects
    const subjects = input.subjects.map((subject) => resolveSubject(sampled, subject))
    const obstacles = shotObstacles(sampled)
    const twoPerson = relation === 'over_shoulder' || relation === 'reverse_pair'
    const size = input.size ?? (twoPerson ? 'close' : 'medium')
    const lens = input.lens ?? (twoPerson ? 'telephoto' : 'standard')
    const axis = subjects.length === 2 ? resolveAxisSide(sampled, cameras, subjects, input.crossAxis) : null

    const solved = plansFor(relation, cameras, subjects).map((plan) => {
      const current = sampled.find((object) => object.id === plan.camera.id) as StageCameraObject
      const solution = composeShot({
        kind: plan.kind,
        subjects: plan.subjects,
        size,
        position: input.position,
        view: input.view,
        angle: input.angle,
        lens,
        aspect: plan.camera.aspectRatio.ratio,
        currentPosition: new Vector3(current.transform.position.x, current.transform.position.y, current.transform.position.z),
        axisNormal: axis ? axisNormalFor(subjects, axis.side) : null,
        avoidOcclusion: input.avoidOcclusion,
        obstacles,
      })
      return { plan, solution }
    })

    const undoToken = captureCameraStageUndo(input.projectId)
    const written = await afterCameraStageWrite(input.projectId, undoToken, async () => {
      let createdStateKeyframe = false
      let targetStateKeyframeId = stateKeyframeId
      if (input.at) {
        if (!targetStateKeyframeId) {
          const ensured = ensureStateKeyframeAt(store, time)
          targetStateKeyframeId = ensured.id
          createdStateKeyframe = ensured.created
        }
        store.getState().selectStateKeyframe(targetStateKeyframeId)
      }
      for (const { plan, solution } of solved) {
        const current = store.getState().objects.find((object) => object.id === plan.camera.id) as StageCameraObject
        const patch = {
          transform: { position: vec(solution.camera.position), rotation: { ...solution.camera.rotation }, scale: { ...current.transform.scale } },
          fov: solution.camera.fov,
          lookAt: { mode: 'manual' as const, target: vec(solution.lookAtTarget) },
        }
        // 有时间点就是动画编辑，只记进那一张状态关键帧；没有就是建模，整条时间轴都摆在这里。
        if (input.at) store.getState().updateObject(plan.camera.id, patch)
        else store.getState().updateObjectAcrossStateKeyframes(plan.camera.id, patch)
      }
      const after = store.getState()
      for (const { plan, solution } of solved) {
        const expected = vec(solution.camera.position)
        const frames = targetStateKeyframeId ? after.stateKeyframes.filter((item) => item.id === targetStateKeyframeId) : after.stateKeyframes
        // 时间轴上一张状态关键帧都没有时，机位只在对象本身上。
        const positions = frames.length > 0
          ? frames.map((item) => item.objectStates[plan.camera.id]?.transform.position)
          : [after.objects.find((object) => object.id === plan.camera.id)?.transform.position]
        if (!positions.every((position) => samePosition(position, expected))) {
          throw new Error('定机位后正式场景里的机位与求解结果不一致，已恢复到写入前。')
        }
      }
      // 读回按写入后的正式场景在该时刻采样，与播放、导出看到的是同一帧；放在写入保护里，算不出来也会恢复。
      const objectsAt = input.at ? applyAnimationAtTime(after.objects, after.animation, time) : after.objects
      const shots = readBack(solved, objectsAt, { angle: input.angle, axis, crossAxis: input.crossAxis })
      await saveCameraStageProjectRuntime(input.projectId)
      return { createdStateKeyframe, stateKeyframeId: targetStateKeyframeId, shots }
    })
    const hints = [
      ...movingSubjectHints(state, input.at ? null : subjects),
      ...written.shots.flatMap((shot) => shotHints(shot)),
    ]
    logger.info('三维构图定机位完成', {
      event: 'camera_stage.compose.completed',
      projectId: input.projectId,
      relation,
      cameraCount: written.shots.length,
      time,
      createdStateKeyframe: written.createdStateKeyframe,
      adjustedCount: written.shots.filter((shot) => shot.adjusted).length,
      occludedCount: written.shots.filter((shot) => shot.composition.subjects.some((subject) => !subject.keyVisible)).length,
      hintCount: hints.length,
    })
    return { projectId: input.projectId, time, ...written, ...(hints.length > 0 ? { compositionHint: `${hints.join('；')}。` } : {}), undoToken }
  } catch (error) {
    logger.error('三维构图定机位失败', error, {
      event: 'camera_stage.compose.failed', projectId: input.projectId, cameraId: input.cameraId, relation, size: input.size ?? null, angle: input.angle,
    })
    throw error
  }
}

export const composeCameraStageShot = bindCameraStageProjectOperation(composeCameraStageShotInternal, (input) => input.projectId)
