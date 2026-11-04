import { Vector3 } from 'three'
import type { z } from 'zod'

import { notExecutedFailure } from '@/core/application-control/execution/writeExecution'
import { createLogger } from '@/core/logging'
import type { cameraStageFollowIntentShape, cameraStageFollowResultShape } from '@/core/application-control/domains/cameraStage/cameraStageBlockingSchemas'
import type { StageCameraFollowEntry } from '../domain/animationTypes'
import { createCameraFollowSampler, rotateByYaw, unrotateByYaw, type CameraFollowSampler } from '../domain/cameraFollow'
import { rotationFromPositionAndTarget } from '../domain/cameraUtils'
import type { StageCameraObject, StageObject, StageVec3 } from '../domain/sceneTypes'
import type { StageCameraFollow } from '../domain/stateKeyframeTypes'
import { applyAnimationAtTime, initialTravelHeading } from '../store/playbackSampling'
import { ensureStateKeyframeAt, mergeTransitionDetail, stateKeyframeTimeAt, writeObjectAtStateKeyframe } from './cameraStageKeyframeWrites'
import { bindCameraStageProjectOperation, cameraStageProjectStore, ensureCameraStageProjectRuntime, saveCameraStageProjectRuntime } from './cameraStageProjectRuntime'
import { afterCameraStageWrite, captureCameraStageUndo } from './cameraStageUndo'
import { composeShot } from './shotComposition'
import { measureVisibility, readShot, shotCameraOf, shotObstacles, shotSubjectFromObject, type StageShotCamera } from './shotGeometry'
import { pointInsideObstacle, type StageObstacle } from './stageObstacles'

const logger = createLogger('features.cameraStage.follow')

export type CameraStageFollowInput = { projectId: string } & z.output<z.ZodObject<typeof cameraStageFollowIntentShape>>
type FollowResultFields = z.infer<z.ZodObject<typeof cameraStageFollowResultShape>>

export interface CameraStageFollowResult extends FollowResultFields {
  projectId: string
  stateKeyframeIds: string[]
  createdStateKeyframes: number
  undoToken: string
}

/**
 * 遮挡预判（参照 Burg 等 2020 的时间预判）：不只看起点一帧，而是把整段跟拍按 0.25 秒取样，
 * 在偏移方位 ±20°/±40°/±60°、抬高 0/0.8 米的邻域里逐个候选模拟整段跟拍，取主体从头到尾可见比例最高的；
 * 原机位已经九成五可见就不改。场景是盒体，视线按线段与盒子相交在 CPU 上算。
 */
const PREDICT_STEP = 0.25
const AZIMUTH_CANDIDATES = [0, 20, -20, 40, -40, 60, -60]
const RAISE_CANDIDATES = [0, 0.8]
const GOOD_ENOUGH = 0.95
const READBACK_SAMPLES = 8

const round = (value: number, digits = 3): number => Math.round(value * 10 ** digits) / 10 ** digits
const vec = (value: StageVec3): StageVec3 => ({ x: round(value.x), y: round(value.y), z: round(value.z) })

function requireCamera(objects: readonly StageObject[], cameraId: string): StageCameraObject {
  const camera = objects.find((object) => object.id === cameraId)
  if (camera?.type === 'camera') return camera
  const cameras = objects.filter((object) => object.type === 'camera').map((object) => `${object.id}（${object.name}）`)
  throw new Error(`CAMERA_NOT_FOUND：«${cameraId}» 不是本场景中的摄像机 id。当前摄像机：${cameras.join('、') || '没有'}。`)
}

function requireSubject(objects: readonly StageObject[], subjectId: string): StageObject {
  const subject = objects.find((object) => object.id === subjectId)
  if (subject && subject.type !== 'camera') return subject
  const available = objects.filter((object) => object.type !== 'camera' && !object.setId).map((object) => `${object.id}（${object.name}）`)
  throw new Error(`${subject ? 'SUBJECT_IS_CAMERA' : 'SUBJECT_NOT_FOUND'}：«${subjectId}» 不能当跟拍主体。可用主体：${available.join('、') || '没有'}。`)
}

interface Scenario {
  times: number[]
  frames: StageObject[][]
  obstacles: StageObstacle[][]
}

function shotCameraFor(pose: { position: StageVec3; aimTarget: StageVec3 }, fov: number, aspect: number): StageShotCamera {
  const { x, y, z } = pose.position
  return { position: new Vector3(x, y, z), rotation: rotationFromPositionAndTarget(pose.position, pose.aimTarget, 0), fov, aspect }
}

/** 一个候选整段跟拍下主体可见的比例，以及被挡的取样时刻与遮挡者。 */
function scoreFollow(sampler: CameraFollowSampler, scenario: Scenario, subjectId: string, fov: number, aspect: number): { visible: number; blocked: Array<{ time: number; occludedBy: Array<{ objectId: string; name: string }> }> } {
  let visible = 0
  const blocked: Array<{ time: number; occludedBy: Array<{ objectId: string; name: string }> }> = []
  scenario.times.forEach((time, index) => {
    const pose = sampler(time)
    const subject = scenario.frames[index].find((object) => object.id === subjectId)!
    const obstacles = scenario.obstacles[index]
    const insideObject = obstacles.find((obstacle) => obstacle.objectId !== subjectId && pointInsideObstacle(pose.position, obstacle, 0.2))
    const result = measureVisibility(shotCameraFor(pose, fov, aspect), shotSubjectFromObject(subject), obstacles)
    if (!insideObject && result.keyVisible && result.visibleFraction >= 0.7 && pose.position.y > 0.05) visible += 1
    else blocked.push({ time, occludedBy: insideObject ? [{ objectId: insideObject.objectId, name: insideObject.name }] : result.occludedBy })
  })
  return { visible: visible / Math.max(1, scenario.times.length), blocked }
}

/** 相邻的被挡取样合成时段。 */
function occlusionIntervals(blocked: ReadonlyArray<{ time: number; occludedBy: Array<{ objectId: string; name: string }> }>): FollowResultFields['occlusions'] {
  const intervals: FollowResultFields['occlusions'] = []
  for (const item of blocked) {
    const last = intervals[intervals.length - 1]
    if (last && item.time - last.endTime <= PREDICT_STEP + 1e-6) {
      last.endTime = item.time
      for (const blocker of item.occludedBy) if (!last.occludedBy.some((existing) => existing.objectId === blocker.objectId)) last.occludedBy.push(blocker)
    } else {
      intervals.push({ startTime: item.time, endTime: item.time, occludedBy: [...item.occludedBy] })
    }
  }
  return intervals.map((item) => ({ ...item, startTime: round(item.startTime, 2), endTime: round(item.endTime, 2) }))
}

async function followInternal(input: CameraStageFollowInput): Promise<CameraStageFollowResult> {
  logger.info('跟拍开始', { event: 'camera_stage.follow.start', projectId: input.projectId, cameraId: input.cameraId, subjectId: input.subjectId, startTime: input.startTime, endTime: input.endTime })
  try {
    await ensureCameraStageProjectRuntime(input.projectId)
    const store = cameraStageProjectStore(input.projectId)
    const state = store.getState()
    // 摄像机、主体、时段不对与遮挡预判都在写入之前：失败标成未执行，调用方改参数重试即可。
    const plan = (() => {
      try {
        const camera = requireCamera(state.objects, input.cameraId)
        const subject = requireSubject(state.objects, input.subjectId)
        const startTime = stateKeyframeTimeAt(store, input.startTime)
        const endTime = stateKeyframeTimeAt(store, input.endTime)
        if (!(endTime > startTime)) throw new Error('INVALID_TIME_RANGE：endTime 要晚于 startTime 至少一帧。')
        // 跟拍两端要落一张状态关键帧；落在主体走动的中途会把它的一段走动切成两段、在那里停一下。
        for (const time of [startTime, endTime]) {
          const after = state.stateKeyframes.findIndex((item) => item.time > time + 1e-6)
          const previous = state.stateKeyframes[after - 1]
          const next = state.stateKeyframes[after]
          if (after <= 0 || !previous || !next || Math.abs(previous.time - time) < 1e-6) continue
          const a = previous.objectStates[subject.id]?.transform.position
          const b = next.objectStates[subject.id]?.transform.position
          if (a && b && Math.hypot(a.x - b.x, a.z - b.z) > 1e-3) {
            throw new Error(`SUBJECT_MOVING：第 ${time} 秒「${subject.name}」正在从 ${previous.time} 秒走向 ${next.time} 秒的位置，跟拍的起止时刻放在这两个时刻之一（或主体停着的时候）。`)
          }
        }

        const subjectAt = (time: number): StageVec3 => applyAnimationAtTime([subject], state.animation, time)[0].transform.position
        const heading = initialTravelHeading(subjectAt, startTime, endTime, applyAnimationAtTime([subject], state.animation, startTime)[0].transform.rotation.y)
        const frameYaw = input.frame === 'travel' ? heading : 0

        // 起点按意图求一次机位：把主体的“正面”换成行进方向，view 就是相对行进方向的那一面。
        const startFrame = applyAnimationAtTime(state.objects, state.animation, startTime)
        const startSubject = startFrame.find((object) => object.id === subject.id)!
        const virtual = { ...startSubject, transform: { ...startSubject.transform, rotation: { ...startSubject.transform.rotation, y: heading } } } as StageObject
        const startCamera = startFrame.find((object) => object.id === camera.id) as StageCameraObject
        const solution = composeShot({
          kind: 'single', subjects: [shotSubjectFromObject(virtual)], size: input.size, position: input.position, view: input.view,
          angle: input.angle, lens: input.lens, aspect: camera.aspectRatio.ratio,
          currentPosition: new Vector3(startCamera.transform.position.x, startCamera.transform.position.y, startCamera.transform.position.z),
          axisNormal: null, avoidOcclusion: false, obstacles: shotObstacles(startFrame),
        })
        const base = startSubject.transform.position
        const cameraOffset = unrotateByYaw({ x: solution.camera.position.x - base.x, y: solution.camera.position.y - base.y, z: solution.camera.position.z - base.z }, frameYaw)
        const aimOffset = unrotateByYaw({ x: solution.lookAtTarget.x - base.x, y: solution.lookAtTarget.y - base.y, z: solution.lookAtTarget.z - base.z }, frameYaw)
        const fov = solution.camera.fov
        const aspect = camera.aspectRatio.ratio

        const times: number[] = []
        for (let time = startTime; time <= endTime + 1e-9; time += PREDICT_STEP) times.push(Math.min(endTime, time))
        const frames = times.map((time) => applyAnimationAtTime(state.objects, state.animation, time))
        const scenario: Scenario = { times, frames, obstacles: frames.map((frame) => shotObstacles(frame)) }
        const followFor = (azimuth: number, raise: number): StageCameraFollow => {
          const rotated = rotateByYaw(cameraOffset, azimuth)
          return { subjectId: subject.id, offset: vec({ x: rotated.x, y: rotated.y + raise, z: rotated.z }), aimOffset: vec(aimOffset), frame: input.frame, lag: input.lag }
        }
        const entryFor = (follow: StageCameraFollow): StageCameraFollowEntry => ({ cameraId: camera.id, startTime, endTime, follow })
        const samplerFor = (follow: StageCameraFollow): CameraFollowSampler => createCameraFollowSampler(entryFor(follow), subjectAt, heading)

        let chosen = { azimuth: 0, raise: 0, follow: followFor(0, 0) }
        let score = scoreFollow(samplerFor(chosen.follow), scenario, subject.id, fov, aspect)
        if (input.avoidOcclusion && score.visible < GOOD_ENOUGH) {
          for (const raise of RAISE_CANDIDATES) {
            for (const azimuth of AZIMUTH_CANDIDATES) {
              if (azimuth === 0 && raise === 0) continue
              const follow = followFor(azimuth, raise)
              const candidate = scoreFollow(samplerFor(follow), scenario, subject.id, fov, aspect)
              if (candidate.visible > score.visible + 1e-6) {
                chosen = { azimuth, raise, follow }
                score = candidate
              }
            }
            if (score.visible >= GOOD_ENOUGH) break
          }
        }
        return { camera, subject, startTime, endTime, fov, chosen, score, sampler: samplerFor(chosen.follow) }
      } catch (error) {
        throw notExecutedFailure(error)
      }
    })()
    const { camera, subject, startTime, endTime, fov, chosen, score, sampler } = plan

    const undoToken = captureCameraStageUndo(input.projectId)
    const written = await afterCameraStageWrite(input.projectId, undoToken, async () => {
      const created: string[] = []
      for (const time of [startTime, endTime]) {
        const keyframe = ensureStateKeyframeAt(store, time)
        if (keyframe.created) created.push(keyframe.id)
      }
      // 逐卡写机位会结束那张卡前后两段的跟拍（作者改机位的规则）；本时段以外原有的跟拍写完后放回去。
      const outside = store.getState().stateKeyframes
        .filter((item) => (item.time < startTime - 1e-6 || item.time >= endTime - 1e-6) && item.transition.perObject[camera.id]?.follow)
        .map((item) => ({ id: item.id, follow: item.transition.perObject[camera.id]!.follow! }))
      const inWindow = store.getState().stateKeyframes.filter((item) => item.time >= startTime - 1e-6 && item.time <= endTime + 1e-6)
      for (const stateKeyframe of inWindow) {
        const pose = sampler(stateKeyframe.time)
        const current = store.getState().objects.find((object) => object.id === camera.id) as StageCameraObject
        writeObjectAtStateKeyframe(store, stateKeyframe.id, camera.id, {
          transform: { position: vec(pose.position), rotation: rotationFromPositionAndTarget(pose.position, pose.aimTarget, current.transform.rotation.z), scale: { ...current.transform.scale } },
          fov,
          lookAt: { mode: 'manual', target: vec(pose.aimTarget) },
        })
      }
      for (const stateKeyframe of store.getState().stateKeyframes) {
        if (stateKeyframe.time < startTime - 1e-6 || stateKeyframe.time >= endTime - 1e-6) continue
        mergeTransitionDetail(store, stateKeyframe.id, camera.id, { follow: chosen.follow }, ['spatialPath'])
      }
      for (const kept of outside) {
        const now = store.getState().stateKeyframes.find((item) => item.id === kept.id)
        if (now && !now.transition.perObject[camera.id]?.follow) mergeTransitionDetail(store, kept.id, camera.id, { follow: kept.follow })
      }

      const after = store.getState()
      const subjectShotAt = (frame: StageObject[]): ReturnType<typeof shotSubjectFromObject> => shotSubjectFromObject(frame.find((object) => object.id === subject.id)!)
      const samples = Array.from({ length: READBACK_SAMPLES }, (_, index) => startTime + ((endTime - startTime) * index) / (READBACK_SAMPLES - 1)).map((time) => {
        const frame = applyAnimationAtTime(after.objects, after.animation, time)
        const sampledCamera = frame.find((object) => object.id === camera.id) as StageCameraObject
        const reading = readShot(shotCameraOf(sampledCamera), [subjectShotAt(frame)], shotObstacles(frame)).subjects[0]
        return { time: round(time, 2), shotSize: reading.shotSize, heightRatio: reading.heightRatio === null ? null : round(reading.heightRatio, 2), horizontal: reading.horizontal, keyVisible: reading.keyVisible }
      })
      await saveCameraStageProjectRuntime(input.projectId)
      return { created, touched: inWindow.map((item) => item.id), samples }
    })

    const occlusions = occlusionIntervals(score.blocked)
    const hints: string[] = []
    if (occlusions.length > 0) hints.push(`${occlusions.map((item) => `${item.startTime}–${item.endTime} 秒被${item.occludedBy.map((blocker) => `「${blocker.name}」`).join('') || '前景'}挡住`).join('、')}，可换 view、抬高 angle 或缩短跟拍时段`)
    const sizes = new Set(written.samples.map((sample) => sample.shotSize))
    if (sizes.size > 1) hints.push(`跟拍中景别在${[...sizes].filter(Boolean).join('、')}之间变化（主体加减速时机位滞后），lag 调小跟得更紧`)
    logger.info('跟拍完成', {
      event: 'camera_stage.follow.completed', projectId: input.projectId, cameraId: camera.id, subjectId: subject.id,
      visibleFraction: round(score.visible, 2), occlusionCount: occlusions.length, adjusted: chosen.azimuth !== 0 || chosen.raise !== 0,
    })
    return {
      projectId: input.projectId,
      cameraId: camera.id,
      subjectId: subject.id,
      startTime,
      endTime,
      offset: chosen.follow.offset,
      adjusted: chosen.azimuth !== 0 || chosen.raise !== 0
        ? { azimuthDegrees: chosen.azimuth, raised: chosen.raise, visibleFraction: round(score.visible, 2), summary: `原机位整段只有部分时间看得到主体，绕主体转了 ${chosen.azimuth}°${chosen.raise > 0 ? `、抬高 ${chosen.raise} 米` : ''}，可见 ${Math.round(score.visible * 100)}%。` }
        : null,
      samples: written.samples,
      occlusions,
      ...(hints.length > 0 ? { followHint: `${hints.join('；')}。` } : {}),
      stateKeyframeIds: written.touched,
      createdStateKeyframes: written.created.length,
      undoToken,
    }
  } catch (error) {
    logger.error('跟拍失败', error, { event: 'camera_stage.follow.failed', projectId: input.projectId, cameraId: input.cameraId, subjectId: input.subjectId })
    throw error
  }
}

export const followCameraStageCharacter = bindCameraStageProjectOperation(followInternal, (input) => input.projectId)
