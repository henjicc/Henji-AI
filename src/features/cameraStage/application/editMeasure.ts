import { Vector3 } from 'three'

import { CAMERA_STAGE_SHOT_SIZES, type CameraStageShotSize } from '@/core/application-control/domains/cameraStage/cameraStageShotSchemas'
import type { CameraStageCoverageLine } from '@/core/application-control/domains/cameraStage/cameraStageCoverageSchemas'
import type { StageSceneAnimation } from '../domain/animationTypes'
import { characterClipFacts } from '../domain/characterMotion'
import type { StageCoverage, StageCoverageSetup } from '../domain/coverage'
import type { StageCameraObject, StageObject } from '../domain/sceneTypes'
import { applyAnimationAtTime } from '../store/playbackSampling'
import { clipLabel } from './characterReadback'
import { axisSideOf } from './shotComposition'
import {
  cameraForward,
  readShot,
  shotCameraOf,
  shotObstacles,
  shotSubjectFromObject,
  shotSubjectFromPoint,
  type StageShotSubject,
} from './shotGeometry'
import type { StageObstacle } from './stageObstacles'

/*
 * 剪辑用的“看片”：把一段时间按固定步长取样，量每台摄像机每一刻拍到了谁、多大、在轴线哪一侧、朝哪看。
 * 覆盖、剪辑与检查都用这一份量法，剪辑规则判的是实际画面，不是意图。
 */

export const EDIT_SAMPLE_STEP = 0.2
/** 骑轴：机位到两人中点的水平方向与轴线夹角小于这个角度（度）时既不算这一侧也不算那一侧。 */
const ON_AXIS_DEGREES = 6
const DEG = Math.PI / 180

export interface EditFrame {
  time: number
  objects: StageObject[]
  obstacles: StageObstacle[]
}

export interface EditCameraView {
  position: Vector3
  forward: Vector3
  /** 每个主体：在画面内且脸或中心没被挡 */
  visible: Map<string, boolean>
  sizeIndex: Map<string, number | null>
  heightRatio: Map<string, number | null>
}

export interface EditAction {
  subjectId: string
  kind: 'walk' | 'turn' | 'action'
  label: string
  startTime: number
  endTime: number
}

const TALK_CLIPS = new Set(['Idle_Talking_Loop', 'Sitting_Talking_Loop'])

export function sizeIndexOf(size: CameraStageShotSize | null | undefined): number | null {
  if (!size) return null
  const index = CAMERA_STAGE_SHOT_SIZES.indexOf(size)
  return index < 0 ? null : index
}

export function sampleTimes(start: number, end: number, step = EDIT_SAMPLE_STEP): number[] {
  const times: number[] = []
  for (let time = start; time < end - 1e-6; time += step) times.push(Math.round(time * 1000) / 1000)
  if (times.length === 0) times.push(start)
  return times
}

/** 时间轴按取样时刻逐帧采样，同一份帧给所有摄像机共用。 */
export function sampleEditFrames(objects: StageObject[], animation: StageSceneAnimation, times: readonly number[]): EditFrame[] {
  return times.map((time) => {
    const sampled = applyAnimationAtTime(objects, animation, time)
    return { time, objects: sampled, obstacles: shotObstacles(sampled) }
  })
}

export function subjectOf(objects: readonly StageObject[], id: string): StageShotSubject | null {
  const object = objects.find((candidate) => candidate.id === id)
  return object && object.type !== 'camera' ? shotSubjectFromObject(object) : null
}

/** 插入镜头拍的东西：对象或布景里的一个点。 */
export function setupSubjects(frame: EditFrame, setup: Pick<StageCoverageSetup, 'subjectIds' | 'point' | 'height'>): StageShotSubject[] {
  if (setup.point) return [shotSubjectFromPoint(setup.point, setup.height ?? 0.3)]
  return setup.subjectIds.flatMap((id) => subjectOf(frame.objects, id) ?? [])
}

/** 一台摄像机在这一帧里看主体：subjects 里有 objectId 的才记进结果。 */
export function viewAt(frame: EditFrame, cameraId: string, subjects: readonly StageShotSubject[], ignore?: ReadonlySet<string>): EditCameraView | null {
  const camera = frame.objects.find((object): object is StageCameraObject => object.id === cameraId && object.type === 'camera')
  if (!camera || subjects.length === 0) return null
  const pose = shotCameraOf(camera)
  const readback = readShot(pose, subjects, frame.obstacles, ignore)
  const visible = new Map<string, boolean>()
  const sizeIndex = new Map<string, number | null>()
  const heightRatio = new Map<string, number | null>()
  readback.subjects.forEach((subject, index) => {
    const key = subjects[index].objectId ?? `point:${index}`
    visible.set(key, subject.inFrame && subject.keyVisible)
    sizeIndex.set(key, sizeIndexOf(subject.shotSize))
    heightRatio.set(key, subject.heightRatio)
  })
  const forward = cameraForward(pose.rotation)
  forward.y = 0
  if (forward.lengthSq() > 1e-9) forward.normalize()
  return { position: pose.position.clone(), forward, visible, sizeIndex, heightRatio }
}

/** 机位在两人连线的哪一侧：+1 / −1 与 axisSideOf 同一口径，骑在轴线上为 0。 */
export function axisSideAt(position: Vector3, a: StageShotSubject, b: StageShotSubject): -1 | 0 | 1 {
  const middle = a.base.clone().add(b.base).multiplyScalar(0.5)
  const toCamera = position.clone().sub(middle).setY(0)
  const along = b.base.clone().sub(a.base).setY(0)
  if (toCamera.length() < 0.5 || along.lengthSq() < 1e-9) return 0
  const lateral = Math.abs(toCamera.clone().normalize().cross(along.normalize()).y)
  if (lateral < Math.sin(ON_AXIS_DEGREES * DEG)) return 0
  return axisSideOf(position, [a, b])
}

/** 两台机位看同一个主体的水平夹角（度）。 */
export function viewAngleBetween(first: Vector3, second: Vector3, subject: StageShotSubject): number {
  const target = subject.base.clone().setY(0)
  const a = first.clone().setY(0).sub(target)
  const b = second.clone().setY(0).sub(target)
  if (a.lengthSq() < 1e-9 || b.lengthSq() < 1e-9) return 0
  return a.angleTo(b) / DEG
}

/** 角色的动作时间线里的走动、原地转身与一次性动作（坐下、起身、挥手……），按时间排好。 */
export function subjectActions(animation: StageSceneAnimation, subjectIds: readonly string[]): EditAction[] {
  const actions: EditAction[] = []
  for (const subjectId of subjectIds) {
    const spans = animation.characterMotions.find((item) => item.objectId === subjectId)?.spans ?? []
    spans.forEach((span, index) => {
      const next = spans[index + 1]?.startTime ?? span.endTime
      if (span.locomotion) {
        const previous = actions[actions.length - 1]
        if (span.continuesPrevious && previous?.subjectId === subjectId && previous.kind === span.locomotion.kind) {
          previous.endTime = next
          return
        }
        actions.push({ subjectId, kind: span.locomotion.kind, label: span.locomotion.kind === 'walk' ? '走动' : '转身', startTime: span.startTime, endTime: next })
        return
      }
      if (span.motion.mode !== 'clip') return
      const facts = characterClipFacts(span.motion.clipName)
      if (!facts || facts.loop || span.clock.kind !== 'time' || span.clock.rate <= 0) return
      const end = Math.min(Number.isFinite(next) ? next : Infinity, span.startTime + facts.duration / span.clock.rate)
      if (Number.isFinite(end) && end > span.startTime) actions.push({ subjectId, kind: 'action', label: clipLabel(span.motion.clipName), startTime: span.startTime, endTime: end })
    })
  }
  return actions.sort((left, right) => left.startTime - right.startTime)
}

/** 没给台词时按“说话”动作推断谁在什么时候说话。 */
export function inferredLines(animation: StageSceneAnimation, subjectIds: readonly string[], start: number, end: number): CameraStageCoverageLine[] {
  const lines: CameraStageCoverageLine[] = []
  for (const speakerId of subjectIds) {
    const spans = animation.characterMotions.find((item) => item.objectId === speakerId)?.spans ?? []
    spans.forEach((span, index) => {
      if (span.motion.mode !== 'clip' || !TALK_CLIPS.has(span.motion.clipName)) return
      const spanEnd = Math.min(end, spans[index + 1]?.startTime ?? span.endTime)
      const spanStart = Math.max(start, span.startTime)
      if (Number.isFinite(spanEnd) && spanEnd > spanStart + 0.2) lines.push({ speakerId, startTime: spanStart, endTime: spanEnd })
    })
  }
  return lines.sort((left, right) => left.startTime - right.startTime)
}

/** 镜头角色对应的主要主体：建立与主镜头是全部主体，过肩是被拍者，其余是唯一主体；插入不拍人。 */
export function primarySubjectIds(setup: Pick<StageCoverageSetup, 'role' | 'subjectIds'>): string[] {
  if (setup.role === 'insert') return []
  if (setup.role === 'over_shoulder') return setup.subjectIds.slice(-1)
  if (setup.role === 'establishing' || setup.role === 'master') return setup.subjectIds
  return setup.subjectIds.slice(0, 1)
}

/** 过肩时前景肩膀那人不算挡住被拍者。 */
export function ignoredForSetup(setup: Pick<StageCoverageSetup, 'role' | 'subjectIds'>): ReadonlySet<string> | undefined {
  return setup.role === 'over_shoulder' && setup.subjectIds[0] ? new Set([setup.subjectIds[0]]) : undefined
}

/** 一台覆盖机位在每个取样帧里拍不拍得到它的主要主体（插入镜头看插入物）。 */
export function setupUsable(frames: readonly EditFrame[], setup: StageCoverageSetup): boolean[] {
  return frames.map((frame) => {
    const subjects = setupSubjects(frame, setup)
    const view = viewAt(frame, setup.cameraId, subjects, ignoredForSetup(setup))
    if (!view) return false
    const keys = setup.role === 'insert' ? [...view.visible.keys()] : primarySubjectIds(setup)
    return keys.length > 0 && keys.every((key) => view.visible.get(key) === true)
  })
}

/** 把逐帧可用结果并成时段。 */
export function usableSpans(frames: readonly EditFrame[], usable: readonly boolean[], end: number): Array<{ startTime: number; endTime: number }> {
  const spans: Array<{ startTime: number; endTime: number }> = []
  usable.forEach((ok, index) => {
    if (!ok) return
    const startTime = frames[index].time
    const endTime = frames[index + 1]?.time ?? end
    const last = spans[spans.length - 1]
    if (last && Math.abs(last.endTime - startTime) < 1e-6) last.endTime = endTime
    else spans.push({ startTime, endTime })
  })
  return spans.map((span) => ({ startTime: Math.round(span.startTime * 100) / 100, endTime: Math.round(span.endTime * 100) / 100 }))
}

export function coverageSetupFor(coverages: readonly StageCoverage[], cameraId: string | null, preferred?: StageCoverage): StageCoverageSetup | null {
  if (!cameraId) return null
  return preferred?.setups.find((setup) => setup.cameraId === cameraId)
    ?? coverages.flatMap((coverage) => coverage.setups).find((setup) => setup.cameraId === cameraId)
    ?? null
}
