import type { z } from 'zod'

import { notExecutedFailure } from '@/core/application-control/execution/writeExecution'
import { createLogger } from '@/core/logging'
import {
  CAMERA_STAGE_CHARACTER_ACTIONS,
  CAMERA_STAGE_CHARACTER_GAITS,
  type CameraStageCharacterAction,
  type CameraStageCharacterBeat,
  type CameraStageCharacterGait,
  type CameraStageCharacterPlace,
  type cameraStageBlockingIntentShape,
  type cameraStageBlockingResultShape,
} from '@/core/application-control/domains/cameraStage/cameraStageBlockingSchemas'
import {
  CHARACTER_CLIP_FOLLOW_UPS,
  CHARACTER_JOG_MIN_SPEED,
  CHARACTER_SPRINT_MIN_SPEED,
  characterClipFacts,
  isCharacterAnimationClipName,
  type StageCharacterMotion,
} from '../domain/characterMotion'
import { characterMotionSpanAt } from '../domain/characterMotionTimeline'
import { cruiseProgress, cruiseRamp } from '../domain/keyframeEngine'
import type { StageCharacterObject, StageObject } from '../domain/sceneTypes'
import type { StageSpatialPath } from '../domain/stateKeyframeTypes'
import { applyAnimationAtTime } from '../store/playbackSampling'
import {
  ensureStateKeyframeAt,
  mergeTransitionDetail,
  splitMovers,
  stateKeyframeTimeAt,
  writeObjectAtStateKeyframe,
} from './cameraStageKeyframeWrites'
import { bindCameraStageProjectOperation, cameraStageProjectStore, ensureCameraStageProjectRuntime, saveCameraStageProjectRuntime } from './cameraStageProjectRuntime'
import { afterCameraStageWrite, captureCameraStageUndo } from './cameraStageUndo'
import {
  CHARACTER_ROUTE_CLEARANCE,
  flattenObstacles,
  planCharacterRoute,
  routeToSpatialPath,
  sampledRouteCrossings,
  type PlanarPoint,
  type RouteCrossing,
} from './characterRoutePlanner'
import { clipLabel } from './characterReadback'
import { stageObjectObstacle } from './stageObstacles'

const logger = createLogger('features.cameraStage.blocking')

export type CameraStageBlockingInput = { projectId: string } & z.output<z.ZodObject<typeof cameraStageBlockingIntentShape>>
type BeatResult = z.infer<z.ZodObject<typeof cameraStageBlockingResultShape>>['beats'][number]

export interface CameraStageBlockingResult {
  projectId: string
  characterId: string
  stateKeyframeIds: string[]
  createdStateKeyframes: number
  beats: BeatResult[]
  laterStateKeyframesAligned: number
  blockingHint?: string
  undoToken: string
}

/** 对象表面到站位的默认距离（米） */
const STAND_OFF = 0.5
/** 转 180° 用多久（秒） */
const TURN_SECONDS_PER_HALF = 1
const MIN_MOVE_SECONDS = 0.2

const round = (value: number, digits = 3): number => Math.round(value * 10 ** digits) / 10 ** digits
const normalizeAngle = (angle: number): number => ((angle + 180) % 360 + 360) % 360 - 180
const headingOf = (from: PlanarPoint, to: PlanarPoint): number => Math.atan2(to.x - from.x, to.z - from.z) * 180 / Math.PI

/** 规划时角色在某一拍结束的状态。 */
interface CharacterPlanState {
  point: PlanarPoint
  y: number
  yaw: number
  motion: StageCharacterMotion
}

type PlannedBeat =
  | { kind: 'move'; start: number; end: number; from: CharacterPlanState; to: CharacterPlanState; route: PlanarPoint[]; length: number; gait: CameraStageCharacterGait; detourPoints: number; plannedCrossings: RouteCrossing[]; ignore: Set<string> }
  | { kind: 'turn'; start: number; end: number; from: CharacterPlanState; to: CharacterPlanState }
  | { kind: 'action'; start: number; end: number; from: CharacterPlanState; to: CharacterPlanState; action: CameraStageCharacterAction; clip: string; followUp: string | null; restore: StageCharacterMotion | null }
  | { kind: 'wait'; start: number; end: number; from: CharacterPlanState; to: CharacterPlanState }

function requireCharacter(objects: readonly StageObject[], characterId: string): StageCharacterObject {
  const object = objects.find((item) => item.id === characterId)
  if (object?.type === 'character') return object
  const characters = objects.filter((item) => item.type === 'character').map((item) => `${item.id}（${item.name}）`)
  throw new Error(`${object ? 'OBJECT_TYPE_MISMATCH' : 'CHARACTER_NOT_FOUND'}：«${characterId}» 不是本场景里的角色。当前角色：${characters.join('、') || '没有'}；新角色先用 place_camera_stage_object（objectType=character）建一个。`)
}

function requireObject(objects: readonly StageObject[], objectId: string, walker: string): StageObject {
  const object = objects.find((item) => item.id === objectId)
  if (object && object.id !== walker) return object
  if (object) throw new Error(`INVALID_PLACE：«${objectId}» 是走位的角色自己，地点要给别的对象或地面坐标。`)
  const listed = objects.filter((item) => !item.setId && item.id !== walker).slice(0, 20).map((item) => `${item.id}（${item.name}）`)
  throw new Error(`OBJECT_NOT_FOUND：«${objectId}» 不是本场景里的对象。逐个放置的对象：${listed.join('、') || '没有'}；布景成员用 list_application_entities 查 id，或直接给 { point }。`)
}

/** 站位：对象某一侧离表面 distance 米；near 取离来路最近的一侧。 */
function standPoint(object: StageObject, place: Extract<CameraStageCharacterPlace, { objectId: string }>, from: PlanarPoint): PlanarPoint {
  const box = stageObjectObstacle(object)
  const distance = (place.distance ?? STAND_OFF) + CHARACTER_ROUTE_CLEARANCE
  // 局部 +Z 是正面、+X 是对象自己的左侧（模型面朝 +Z 时右手在 -X）。
  const sides = {
    front: { x: 0, z: box.half.z + distance },
    back: { x: 0, z: -(box.half.z + distance) },
    left: { x: box.half.x + distance, z: 0 },
    right: { x: -(box.half.x + distance), z: 0 },
  }
  const world = (local: PlanarPoint): PlanarPoint => ({
    x: box.center.x + local.x * box.cos + local.z * box.sin,
    z: box.center.z - local.x * box.sin + local.z * box.cos,
  })
  if (place.side !== 'near') return world(sides[place.side])
  return Object.values(sides).map(world).sort((a, b) => Math.hypot(a.x - from.x, a.z - from.z) - Math.hypot(b.x - from.x, b.z - from.z))[0]
}

function resolvePlace(place: CameraStageCharacterPlace, objects: readonly StageObject[], from: PlanarPoint, walker: string): { point: PlanarPoint; objectId: string | null } {
  if ('point' in place) return { point: { ...place.point }, objectId: null }
  const object = requireObject(objects, place.objectId, walker)
  return { point: standPoint(object, place, from), objectId: object.id }
}


function gaitForSpeed(speed: number): CameraStageCharacterGait {
  if (speed >= CHARACTER_SPRINT_MIN_SPEED) return 'sprint'
  if (speed >= CHARACTER_JOG_MIN_SPEED) return 'jog'
  return 'walk'
}

function clipMotion(clipName: string): StageCharacterMotion {
  if (!isCharacterAnimationClipName(clipName)) throw new Error(`CAPABILITY_REJECTED：动作片段 ${clipName} 不存在`)
  return { mode: 'clip', clipName, speed: 1 }
}

/** 一次性动作做完后真正停留的动作：沿后续表走到循环动作为止，没有后续的停在最后一帧。 */
function settledMotion(clipName: string): StageCharacterMotion {
  let current = clipName
  for (let guard = 0; guard < 4; guard += 1) {
    const next = CHARACTER_CLIP_FOLLOW_UPS[current as keyof typeof CHARACTER_CLIP_FOLLOW_UPS]
    if (!next) break
    current = next
  }
  return clipMotion(current)
}

/** 站着时的动作：在走动中就算待机，姿态保留姿态。 */
function heldMotionAt(state: ReturnType<ReturnType<typeof cameraStageProjectStore>['getState']>, character: StageCharacterObject, time: number): StageCharacterMotion {
  const timeline = state.animation.characterMotions.find((item) => item.objectId === character.id)
  const span = characterMotionSpanAt(timeline, time)
  if (!span) return character.motion
  return span.locomotion ? clipMotion('Idle_Loop') : span.motion
}

function planBeats(input: CameraStageBlockingInput, objectsAtStart: StageObject[], character: StageCharacterObject, startState: CharacterPlanState): PlannedBeat[] {
  const obstacles = objectsAtStart.filter((object) => object.visible && object.type !== 'camera' && object.id !== character.id).map((object) => stageObjectObstacle(object))
  const planned: PlannedBeat[] = []
  let cursor = input.startTime
  let state = startState
  input.beats.forEach((beat: CameraStageCharacterBeat, index) => {
    const at = 'at' in beat ? beat.at : undefined
    if (at !== undefined && at < cursor - 1e-6) {
      throw new Error(`BEAT_OVERLAP：第 ${index + 1} 拍的 at=${at} 早于上一拍结束的 ${round(cursor, 2)} 秒；去掉 at 让它紧接上一拍，或给不早于 ${round(cursor, 2)} 的时间。`)
    }
    const start = at ?? cursor
    if (beat.kind === 'move') {
      const ignore = new Set<string>()
      const waypoints = [state.point]
      for (const place of [...beat.via, beat.to]) {
        const resolved = resolvePlace(place, objectsAtStart, waypoints[waypoints.length - 1], character.id)
        if (resolved.objectId) ignore.add(resolved.objectId)
        waypoints.push(resolved.point)
      }
      const route = planCharacterRoute(waypoints, flattenObstacles(obstacles.filter((obstacle) => !ignore.has(obstacle.objectId))), beat.avoidObstacles)
      if (route.length < 0.05) throw new Error(`MOVE_TOO_SHORT：第 ${index + 1} 拍的目的地离角色现在的位置不到 5 厘米；要原地转身用 turn。`)
      const gait = beat.gait ?? gaitForSpeed(beat.speed ?? (beat.duration ? route.length / beat.duration : beat.endTime ? route.length / Math.max(1e-3, beat.endTime - start) : CAMERA_STAGE_CHARACTER_GAITS.walk.speed))
      const duration = beat.duration ?? (beat.endTime !== undefined ? beat.endTime - start : route.length / (beat.speed ?? CAMERA_STAGE_CHARACTER_GAITS[gait].speed))
      if (!(duration >= MIN_MOVE_SECONDS)) throw new Error(`INVALID_TIME_RANGE：第 ${index + 1} 拍走 ${round(route.length, 2)} 米只给了 ${round(duration, 2)} 秒；endTime 要晚于这一拍开始的 ${round(start, 2)} 秒，时长至少 ${MIN_MOVE_SECONDS} 秒。`)
      const last = route.points[route.points.length - 1]
      const before = route.points[route.points.length - 2]
      const to: CharacterPlanState = { point: last, y: state.y, yaw: state.yaw + normalizeAngle(headingOf(before, last) - state.yaw), motion: state.motion.mode === 'clip' ? state.motion : clipMotion('Idle_Loop') }
      planned.push({ kind: 'move', start, end: start + duration, from: state, to, route: route.points, length: route.length, gait, detourPoints: route.detourPoints, plannedCrossings: route.crossings, ignore })
      state = to
      cursor = start + duration
      return
    }
    if (beat.kind === 'turn') {
      let targetYaw: number
      if ('yaw' in beat.toward) targetYaw = beat.toward.yaw
      else if ('point' in beat.toward) targetYaw = headingOf(state.point, beat.toward.point)
      else {
        const object = requireObject(objectsAtStart, beat.toward.objectId, character.id)
        targetYaw = headingOf(state.point, { x: object.transform.position.x, z: object.transform.position.z })
      }
      const delta = normalizeAngle(targetYaw - state.yaw)
      const duration = beat.duration ?? Math.max(0.4, Math.min(1.2, (Math.abs(delta) / 180) * TURN_SECONDS_PER_HALF))
      const to = { ...state, yaw: state.yaw + delta }
      planned.push({ kind: 'turn', start, end: start + (Math.abs(delta) < 1 ? 0 : duration), from: state, to })
      state = to
      cursor = start + (Math.abs(delta) < 1 ? 0 : duration)
      return
    }
    if (beat.kind === 'action') {
      const { clip } = CAMERA_STAGE_CHARACTER_ACTIONS[beat.action]
      const facts = characterClipFacts(clip)
      const loop = facts?.loop ?? true
      const duration = beat.duration ?? (loop ? 0 : facts?.duration ?? 0)
      // 循环动作给了时长：做完回到之前的动作；一次性动作做完自己接后续。
      const restore = loop && beat.duration !== undefined ? state.motion : null
      const settled = loop ? clipMotion(clip) : settledMotion(clip)
      const to = { ...state, motion: restore ?? settled }
      planned.push({ kind: 'action', start, end: start + duration, from: { ...state, motion: clipMotion(clip) }, to, action: beat.action, clip, followUp: loop ? null : CHARACTER_CLIP_FOLLOW_UPS[clip as keyof typeof CHARACTER_CLIP_FOLLOW_UPS] ?? null, restore })
      state = to
      cursor = start + duration
      return
    }
    planned.push({ kind: 'wait', start, end: start + beat.duration, from: state, to: state })
    cursor = start + beat.duration
  })
  return planned
}

/** 路线在路程 d 处的点，以及把路线在这些路程处切开的各段。 */
function splitRoute(points: readonly PlanarPoint[], cuts: readonly number[]): PlanarPoint[][] {
  const pieces: PlanarPoint[][] = []
  let current: PlanarPoint[] = [points[0]]
  let travelled = 0
  let cutIndex = 0
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]
    const b = points[index]
    const length = Math.hypot(b.x - a.x, b.z - a.z)
    while (cutIndex < cuts.length && cuts[cutIndex] < travelled + length - 1e-6) {
      const t = (cuts[cutIndex] - travelled) / Math.max(1e-9, length)
      const point = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }
      current.push(point)
      pieces.push(current)
      current = [point]
      cutIndex += 1
    }
    current.push(b)
    travelled += length
  }
  pieces.push(current)
  return pieces
}

/** 规划好的节拍在任意时刻的角色状态：位置、朝向与卡内动作。同一时刻有几拍时取后开始的那一拍。 */
function plannedStateAt(beats: readonly PlannedBeat[], time: number): CharacterPlanState {
  let active = beats[0]
  for (const beat of beats) if (beat.start <= time + 1e-6) active = beat
  if (time >= active.end - 1e-6) return active.to
  if (time <= active.start + 1e-6) return active.from
  const u = (time - active.start) / (active.end - active.start)
  if (active.kind === 'move') {
    const distance = active.length * cruiseProgress(u, cruiseRamp(active.end - active.start))
    const [head, tail] = splitRoute(active.route, [distance])
    const point = tail[0]
    const before = head[head.length - 2] ?? head[0]
    const after = tail[1] ?? point
    const heading = headingOf(before, after)
    return { point, y: active.from.y, yaw: active.from.yaw + normalizeAngle(heading - active.from.yaw), motion: active.to.motion }
  }
  if (active.kind === 'turn') {
    const eased = u * u * (3 - 2 * u)
    return { ...active.from, yaw: active.from.yaw + (active.to.yaw - active.from.yaw) * eased }
  }
  return active.kind === 'action' ? { ...active.to, motion: active.from.motion } : active.to
}

async function blockCharacterInternal(input: CameraStageBlockingInput): Promise<CameraStageBlockingResult> {
  logger.info('角色走位开始', { event: 'camera_stage.blocking.start', projectId: input.projectId, characterId: input.characterId, beatCount: input.beats.length, startTime: input.startTime })
  try {
    await ensureCameraStageProjectRuntime(input.projectId)
    const store = cameraStageProjectStore(input.projectId)
    const before = store.getState()
    // 角色、地点、时间不对都在写入之前发现：标成未执行，调用方改参数重试即可。
    const { character, beats } = (() => {
      try {
        const character = requireCharacter(before.objects, input.characterId)
        const objectsAtStart = applyAnimationAtTime(before.objects, before.animation, input.startTime)
        const sampled = objectsAtStart.find((object) => object.id === character.id) as StageCharacterObject
        const startState: CharacterPlanState = {
          point: { x: sampled.transform.position.x, z: sampled.transform.position.z },
          y: sampled.transform.position.y,
          yaw: sampled.transform.rotation.y,
          motion: heldMotionAt(before, character, input.startTime),
        }
        return { character, beats: planBeats(input, objectsAtStart, character, startState) }
      } catch (error) {
        throw notExecutedFailure(error)
      }
    })()

    const undoToken = captureCameraStageUndo(input.projectId)
    const written = await afterCameraStageWrite(input.projectId, undoToken, async () => {
      // 起点钉住角色当时的状态；走动与转身两端各一张，动作只在开始（循环动作给了时长时结束也一张），停留不加。
      const boundaryTimes = [...new Set([input.startTime, ...beats.flatMap((beat) => {
        if (beat.kind === 'move' || beat.kind === 'turn') return [beat.start, beat.end]
        if (beat.kind === 'action') return beat.restore ? [beat.start, beat.end] : [beat.start]
        return []
      })].map((time) => stateKeyframeTimeAt(store, time)))].sort((a, b) => a - b)
      const created: string[] = []
      const touched = new Set<string>()
      const smoothed: number[] = []
      for (const time of boundaryTimes) {
        const keyframe = ensureStateKeyframeAt(store, time)
        if (keyframe.created) created.push(keyframe.id)
      }
      const startKeyframeTime = boundaryTimes[0]
      const lastBeatEnd = stateKeyframeTimeAt(store, beats[beats.length - 1].end)
      // 走位接管角色从第一拍开始的时间轴：此后每一张状态关键帧里角色的位置、朝向与卡内动作都按规划写。
      const owned = store.getState().stateKeyframes.filter((item) => item.time >= startKeyframeTime - 1e-6)
      let aligned = 0
      for (const stateKeyframe of owned) {
        const planned = plannedStateAt(beats, stateKeyframe.time)
        const current = store.getState().objects.find((object) => object.id === character.id) as StageCharacterObject
        writeObjectAtStateKeyframe(store, stateKeyframe.id, character.id, {
          transform: {
            position: { x: round(planned.point.x, 4), y: planned.y, z: round(planned.point.z, 4) },
            rotation: { x: current.transform.rotation.x, y: round(planned.yaw, 3), z: current.transform.rotation.z },
            scale: { ...current.transform.scale },
          },
          motion: planned.motion,
        })
        touched.add(stateKeyframe.id)
        if (stateKeyframe.time > lastBeatEnd + 1e-6 && !created.includes(stateKeyframe.id)) aligned += 1
      }
      // 各段过渡：走动段铺路径与时间律，其余段清掉旧走位留下的路径。
      const keyframes = store.getState().stateKeyframes
      for (let index = 0; index < keyframes.length - 1; index += 1) {
        const from = keyframes[index]
        const to = keyframes[index + 1]
        if (from.time < startKeyframeTime - 1e-6) continue
        const move = beats.find((beat): beat is Extract<PlannedBeat, { kind: 'move' }> => beat.kind === 'move'
          && from.time >= stateKeyframeTimeAt(store, beat.start) - 1e-6 && to.time <= stateKeyframeTimeAt(store, beat.end) + 1e-6)
        if (!move) {
          mergeTransitionDetail(store, from.id, character.id, {}, ['spatialPath', 'motionOverride', 'speedPreset'])
          continue
        }
        const moveStart = stateKeyframeTimeAt(store, move.start)
        const moveEnd = stateKeyframeTimeAt(store, move.end)
        const span = moveEnd - moveStart
        const cuts = keyframes.filter((item) => item.time > moveStart + 1e-6 && item.time < moveEnd - 1e-6)
          .map((item) => move.length * cruiseProgress((item.time - moveStart) / span, cruiseRamp(span)))
        const pieces = splitRoute(move.route, cuts)
        const pieceIndex = keyframes.filter((item) => item.time > moveStart + 1e-6 && item.time <= from.time + 1e-6).length
        const piece = pieces[pieceIndex] ?? pieces[pieces.length - 1]
        const path: StageSpatialPath = routeToSpatialPath(piece, move.from.y)
        mergeTransitionDetail(store, from.id, character.id, {
          speedPreset: 'cruise',
          motionOverride: clipMotion(CAMERA_STAGE_CHARACTER_GAITS[move.gait].clip),
          spatialPath: path,
        })
        // 途经已有的状态关键帧时不在那里停下。
        if (from.time > moveStart + 1e-6 && from.continuity !== 'smooth') {
          store.getState().updateStateKeyframeContinuity(from.id, 'smooth')
          smoothed.push(from.time)
        }
      }

      const after = store.getState()
      const timeline = after.animation.characterMotions.find((item) => item.objectId === character.id)
      const results: BeatResult[] = beats.map((beat) => {
        const end = stateKeyframeTimeAt(store, beat.end)
        const start = stateKeyframeTimeAt(store, beat.start)
        const frame = applyAnimationAtTime(after.objects, after.animation, end).find((object) => object.id === character.id)!
        const base = {
          kind: beat.kind,
          startTime: start,
          endTime: end,
          position: { x: round(frame.transform.position.x), y: round(frame.transform.position.y), z: round(frame.transform.position.z) },
          facing: round(normalizeAngle(frame.transform.rotation.y), 1),
        }
        if (beat.kind === 'move') {
          const walks = timeline?.spans.filter((span) => span.locomotion?.kind === 'walk' && span.startTime >= start - 1e-6 && span.startTime < end - 1e-6) ?? []
          const walk = walks[0]
          const walkedDistance = walks.reduce((sum, span) => sum + (span.locomotion?.distance ?? 0), 0)
          const samples = Array.from({ length: Math.max(8, Math.ceil((end - start) * 20)) + 1 }, (_, step) => start + ((end - start) * step) / Math.max(8, Math.ceil((end - start) * 20)))
            .map((time) => applyAnimationAtTime(after.objects, after.animation, time).find((object) => object.id === character.id)!.transform.position)
            .map((position) => ({ x: position.x, z: position.z }))
          const obstacles = after.objects.filter((object) => object.visible && object.type !== 'camera' && object.id !== character.id).map((object) => stageObjectObstacle(object))
          const crossings = sampledRouteCrossings(samples, obstacles, beat.ignore)
          const length = walks.length > 0 ? walkedDistance : beat.length
          const gaitLabel = CAMERA_STAGE_CHARACTER_GAITS[beat.gait].label
          return {
            ...base,
            summary: `${gaitLabel} ${round(length, 1)} 米，${round(end - start, 1)} 秒${beat.detourPoints > 0 ? `，绕开障碍加了 ${beat.detourPoints} 个拐点` : ''}${crossings.length > 0 ? `，仍穿过${crossings.map((item) => `「${item.name}」`).join('')}` : ''}`,
            route: {
              length: round(length, 2),
              averageSpeed: round(length / Math.max(1e-6, end - start), 2),
              gait: beat.gait,
              playbackRate: round(walk?.locomotion?.playbackRate ?? 1, 2),
              detourPoints: beat.detourPoints,
              crossings,
            },
          }
        }
        if (beat.kind === 'turn') return { ...base, summary: `转向 ${base.facing}°，用时 ${round(end - start, 1)} 秒` }
        if (beat.kind === 'action') {
          const { label } = CAMERA_STAGE_CHARACTER_ACTIONS[beat.action]
          return { ...base, summary: `${label}${beat.followUp ? `，做完接${clipLabel(beat.followUp)}` : ''}`, action: { name: beat.action, clip: beat.clip, followUp: beat.followUp } }
        }
        return { ...base, summary: `原地停 ${round(end - start, 1)} 秒` }
      })
      await saveCameraStageProjectRuntime(input.projectId)
      return { created, touched: [...touched], aligned, results, smoothed }
    })

    const hints: string[] = []
    for (const beat of written.results) {
      if (beat.route?.crossings.length) hints.push(`${beat.startTime} 秒起的走动穿过${beat.route.crossings.map((item) => `「${item.name}」`).join('')}，换途经点绕开或把目的地挪到空地`)
      if (beat.route && beat.route.averageSpeed > 8) hints.push(`${beat.startTime} 秒起的走动平均 ${beat.route.averageSpeed} 米/秒，超过人能跑的速度`)
    }
    const movers = splitMovers(before.objects, before, written.created.map((id) => store.getState().stateKeyframes.find((item) => item.id === id)?.time ?? 0), new Set([character.id]))
    // 途经卡改成平滑通过是整张卡的设置：同一时刻在这里停顿的别的对象也会不停了。
    const passing = written.smoothed.flatMap((time) => splitMovers(before.objects, { stateKeyframes: before.stateKeyframes.filter((item) => Math.abs(item.time - time) > 1e-6) }, [time], new Set([character.id])))
    if (passing.length > 0) hints.push(`途经${written.smoothed.map((time) => ` ${round(time, 2)} 秒`).join('、')}的状态关键帧改成了平滑通过，${[...new Set(passing)].map((name) => `「${name}」`).join('')}在那里也不再停顿；要停就把该卡的 continuity 改回 stop（角色也会在那里停一下）`)
    if (movers.length > 0) hints.push(`新加的状态关键帧把${movers.map((name) => `「${name}」`).join('')}原来的一段运动分成了几段，起停节奏可能变了；先排走位再做运镜和跟拍更顺`)
    logger.info('角色走位完成', {
      event: 'camera_stage.blocking.completed', projectId: input.projectId, characterId: character.id, beatCount: beats.length,
      createdStateKeyframes: written.created.length, alignedStateKeyframes: written.aligned, hintCount: hints.length,
    })
    return {
      projectId: input.projectId,
      characterId: character.id,
      stateKeyframeIds: written.touched,
      createdStateKeyframes: written.created.length,
      beats: written.results,
      laterStateKeyframesAligned: written.aligned,
      ...(hints.length > 0 ? { blockingHint: `${hints.join('；')}。` } : {}),
      undoToken,
    }
  } catch (error) {
    logger.error('角色走位失败', error, { event: 'camera_stage.blocking.failed', projectId: input.projectId, characterId: input.characterId })
    throw error
  }
}

export const blockCameraStageCharacter = bindCameraStageProjectOperation(blockCharacterInternal, (input) => input.projectId)
