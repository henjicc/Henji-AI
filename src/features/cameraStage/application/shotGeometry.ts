import { Euler, Quaternion, Vector3 } from 'three'

import type { z } from 'zod'

import {
  CAMERA_STAGE_SHOT_SIZES,
  type CameraStageShotAngle,
  type CameraStageShotSize,
  type cameraStageShotReadbackSchema,
  type cameraStageShotSubjectReadbackSchema,
} from '@/core/application-control/domains/cameraStage/cameraStageShotSchemas'
import { getBodyVariant } from '../domain/bodyVariants'
import { fovToFocalLength } from '../domain/cameraOptics'
import type { StageCameraObject, StageObject, StageVec3 } from '../domain/sceneTypes'
import { calculateStageObjectBounds } from './sceneAnalysis'
import { segmentHitsObstacle, stageObjectObstacle, stageObstacle, type StageObstacle } from './stageObstacles'

/**
 * 构图的几何底座：主体的身体比例、摄像机投影、遮挡采样与“实际构图读回”。
 * 定机位（shotComposition）和观察场景都用这里的读回，助手看到的景别、位置与遮挡来自同一套计算。
 */

const DEG = Math.PI / 180
export const WORLD_UP = new Vector3(0, 1, 0)

/** Quaternius 角色标准体型身高（米）；体型变体与缩放在此基础上乘。 */
export const CHARACTER_HEIGHT = 1.79
/** 人体关键高度占身高的比例（标准人体比例）。 */
export const BODY = { eye: 0.936, shoulder: 0.82, chest: 0.72, hip: 0.5, knee: 0.285 } as const

/**
 * 每种景别画面上下缘落在主体身上的高度（占身高）。全景到大特写按人体切线定义并留出头顶空间，
 * 全景脚下多留一些：平视时镜头略向下看，伸向镜头的脚尖会投得更低；
 * 远景与大远景的人只占画高三分之一与十分之一，脚落在下三分线上。
 */
export const SHOT_FRAMES: Record<CameraStageShotSize, { top: number; bottom: number }> = {
  extreme_long: { top: 20 / 3, bottom: -10 / 3 },
  long: { top: 2, bottom: -1 },
  full: { top: 1.1, bottom: -0.12 },
  medium: { top: 1.06, bottom: 0.25 },
  medium_close: { top: 1.05, bottom: 0.55 },
  close: { top: 1.04, bottom: 0.7 },
  closeup: { top: 1.03, bottom: 0.8 },
  extreme_closeup: { top: 0.99, bottom: 0.88 },
}

/** 景别对应的“主体高度 / 画面高度”。 */
export function shotHeightRatio(size: CameraStageShotSize): number {
  const frame = SHOT_FRAMES[size]
  return 1 / (frame.top - frame.bottom)
}

/** 按主体占画高的比例归到最近的景别（相邻两档按几何中点分界）。 */
export function classifyShotSize(heightRatio: number): CameraStageShotSize {
  for (let index = 0; index < CAMERA_STAGE_SHOT_SIZES.length - 1; index += 1) {
    const boundary = Math.sqrt(shotHeightRatio(CAMERA_STAGE_SHOT_SIZES[index]) * shotHeightRatio(CAMERA_STAGE_SHOT_SIZES[index + 1]))
    if (heightRatio < boundary) return CAMERA_STAGE_SHOT_SIZES[index]
  }
  return CAMERA_STAGE_SHOT_SIZES[CAMERA_STAGE_SHOT_SIZES.length - 1]
}

export interface StageShotSubject {
  objectId: string | null
  name: string
  kind: 'character' | 'object' | 'point'
  /** 底面中心 */
  base: Vector3
  height: number
  /** 横向半宽，用于投影框与遮挡采样 */
  halfWidth: number
  /** 正面朝向（水平单位向量）；点没有朝向 */
  front: Vector3 | null
}

function frontOf(yawDegrees: number): Vector3 {
  return new Vector3(Math.sin(yawDegrees * DEG), 0, Math.cos(yawDegrees * DEG))
}

export function characterHeight(object: Extract<StageObject, { type: 'character' }>): number {
  return CHARACTER_HEIGHT * getBodyVariant(object.variant).bodyScale.y * Math.abs(object.transform.scale.y)
}

/** 角色正面朝局部 +Z；几何体的“正面”同样取局部 +Z。 */
export function shotSubjectFromObject(object: StageObject): StageShotSubject {
  if (object.type === 'character') {
    const variant = getBodyVariant(object.variant)
    const position = object.transform.position
    return {
      objectId: object.id,
      name: object.name,
      kind: 'character',
      base: new Vector3(position.x, position.y, position.z),
      height: characterHeight(object),
      halfWidth: 0.24 * variant.bodyScale.x * Math.abs(object.transform.scale.x),
      front: frontOf(object.transform.rotation.y),
    }
  }
  const bounds = calculateStageObjectBounds(object)
  return {
    objectId: object.id,
    name: object.name,
    kind: 'object',
    base: new Vector3(bounds.center.x, bounds.min.y, bounds.center.z),
    height: bounds.size.y,
    halfWidth: Math.max(bounds.size.x, bounds.size.z) / 2,
    front: frontOf(object.transform.rotation.y),
  }
}

export function shotSubjectFromPoint(point: StageVec3, height = 1.8): StageShotSubject {
  return {
    objectId: null,
    name: `点(${point.x.toFixed(1)}, ${point.y.toFixed(1)}, ${point.z.toFixed(1)})`,
    kind: 'point',
    base: new Vector3(point.x, point.y - height / 2, point.z),
    height,
    halfWidth: height / 4,
    front: null,
  }
}

/** 主体身上的高度比例点（沿竖直轴）。 */
export function subjectAxisPoint(subject: StageShotSubject, fraction: number): Vector3 {
  return subject.base.clone().addScaledVector(WORLD_UP, fraction * subject.height)
}

/** 构图的关键点：人看眼睛，其余看中心。 */
export function subjectKeyFraction(subject: StageShotSubject): number {
  return subject.kind === 'character' ? BODY.eye : 0.5
}

export function subjectKeyPoint(subject: StageShotSubject): Vector3 {
  return subjectAxisPoint(subject, subjectKeyFraction(subject))
}

/** 摄像机位姿：rotation 为 YXZ 欧拉角（度），与视口和导出相同；fov 为垂直视野角。 */
export interface StageShotCamera {
  position: Vector3
  rotation: StageVec3
  fov: number
  aspect: number
}

/** 场景摄像机的位姿；传入已按时刻采样的对象，旋转就是那一帧实际的朝向。 */
export function shotCameraOf(camera: StageCameraObject): StageShotCamera {
  const { x, y, z } = camera.transform.position
  return { position: new Vector3(x, y, z), rotation: { ...camera.transform.rotation }, fov: camera.fov, aspect: camera.aspectRatio.ratio }
}

export interface StageShotProjection {
  x: number
  y: number
  /** 在镜头前方 */
  front: boolean
}

export function cameraQuaternion(rotation: StageVec3): Quaternion {
  return new Quaternion().setFromEuler(new Euler(rotation.x * DEG, rotation.y * DEG, rotation.z * DEG, 'YXZ'))
}

export function cameraForward(rotation: StageVec3): Vector3 {
  return new Vector3(0, 0, -1).applyQuaternion(cameraQuaternion(rotation))
}

/** 世界点投到画面（NDC，-1..1，y 向上）。 */
export function projectPoint(camera: StageShotCamera, point: Vector3, inverse = cameraQuaternion(camera.rotation).invert()): StageShotProjection {
  const local = point.clone().sub(camera.position).applyQuaternion(inverse)
  const tanV = Math.tan((camera.fov * DEG) / 2)
  const depth = -local.z
  if (depth <= 1e-6) return { x: 0, y: 0, front: false }
  return { x: local.x / depth / (tanV * camera.aspect), y: local.y / depth / tanV, front: true }
}

/* ── 遮挡 ─────────────────────────────────────────────────────────── */

/**
 * 角色挡视线用头、躯干、腿三个盒子，比整个边界盒（含张开的手臂）贴身：
 * 过肩镜头的视线正好从前景那人的耳边擦过去，用肩宽的盒子罩住头会误判成挡住了被拍者的脸。
 */
function characterObstacles(object: Extract<StageObject, { type: 'character' }>): StageObstacle[] {
  const variant = getBodyVariant(object.variant)
  const height = characterHeight(object)
  const sx = variant.bodyScale.x * Math.abs(object.transform.scale.x)
  const sz = variant.bodyScale.z * Math.abs(object.transform.scale.z)
  const { x, y, z } = object.transform.position
  const yaw = object.transform.rotation.y
  return [
    stageObstacle(object, { x, y: y + 0.92 * height, z }, { x: 0.1 * sx, y: 0.08 * height, z: 0.11 * sz }, yaw),
    stageObstacle(object, { x, y: y + 0.66 * height, z }, { x: 0.25 * sx, y: 0.18 * height, z: 0.15 * sz }, yaw),
    stageObstacle(object, { x, y: y + 0.24 * height, z }, { x: 0.19 * sx, y: 0.24 * height, z: 0.13 * sz }, yaw),
  ]
}

/** 场景里可能挡视线的东西：可见的几何体、布景成员与角色；摄像机不挡。 */
export function shotObstacles(objects: readonly StageObject[]): StageObstacle[] {
  return objects.flatMap((object) => {
    if (!object.visible || object.type === 'camera') return []
    return object.type === 'character' ? characterObstacles(object) : [stageObjectObstacle(object)]
  })
}

interface SubjectSample {
  point: Vector3
  key: boolean
}

/** 遮挡采样点：沿主体竖直轴与画面横向取点，关键点（人的眼睛、物体中心）单独标出。 */
function subjectSamples(subject: StageShotSubject, lateral: Vector3): SubjectSample[] {
  const at = (side: number, fraction: number, key = false): SubjectSample => ({
    point: subjectAxisPoint(subject, fraction).addScaledVector(lateral, side * subject.halfWidth),
    key,
  })
  if (subject.kind === 'character') {
    return [
      at(0, BODY.eye, true), at(0, 0.86), at(-0.75, 0.79), at(0.75, 0.79), at(0, BODY.chest),
      at(0, BODY.hip), at(-0.4, BODY.knee), at(0.4, BODY.knee), at(-0.4, 0.04), at(0.4, 0.04),
    ]
  }
  if (subject.kind === 'point') return [at(0, 0.5, true), at(0, 0.2), at(0, 0.8)]
  return [
    at(0, 0.5, true), at(0, 0.9), at(0, 0.1),
    at(-0.7, 0.2), at(0.7, 0.2), at(-0.7, 0.8), at(0.7, 0.8),
  ]
}

function lateralFor(camera: StageShotCamera, subject: StageShotSubject): Vector3 {
  const view = subjectKeyPoint(subject).sub(camera.position)
  const lateral = new Vector3().crossVectors(view, WORLD_UP)
  return lateral.lengthSq() < 1e-9 ? new Vector3(1, 0, 0) : lateral.normalize()
}

/** 只留与“摄像机到这些点”的包围盒相交的障碍，上万栋楼时大部分在这里就排除了。 */
function nearbyObstacles(from: Vector3, points: readonly Vector3[], obstacles: readonly StageObstacle[]): StageObstacle[] {
  const min = from.clone()
  const max = from.clone()
  for (const point of points) { min.min(point); max.max(point) }
  return obstacles.filter((obstacle) => (['x', 'y', 'z'] as const).every((axis) => (
    obstacle.center[axis] + obstacle.radius >= min[axis] && obstacle.center[axis] - obstacle.radius <= max[axis]
  )))
}

export interface ShotVisibility {
  /** 画面内采样点里没被挡住的比例；没有采样点在画面内时为 0 */
  visibleFraction: number
  keyVisible: boolean
  keyInFrame: boolean
  occludedBy: Array<{ objectId: string; name: string }>
}

/**
 * 主体的可见性：从机位向每个采样点连线，被别的对象挡住就记下是谁。
 * 只算画面内的点；`ignoreForBody` 里的对象只在非关键点上不算遮挡（过肩镜头里前景那个人本来就挡住被拍者的身子）。
 */
export function measureVisibility(
  camera: StageShotCamera,
  subject: StageShotSubject,
  obstacles: readonly StageObstacle[],
  ignoreForBody: ReadonlySet<string> = new Set(),
): ShotVisibility {
  const inverse = cameraQuaternion(camera.rotation).invert()
  const samples = subjectSamples(subject, lateralFor(camera, subject))
  const inFrame = samples.filter((sample) => {
    const projected = projectPoint(camera, sample.point, inverse)
    return projected.front && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1
  })
  const candidates = nearbyObstacles(camera.position, inFrame.map((sample) => sample.point), obstacles)
    .filter((obstacle) => obstacle.objectId !== subject.objectId)
  const blockers = new Map<string, string>()
  let visible = 0
  let keyVisible = false
  for (const sample of inFrame) {
    // 终点往回收一点，采样点落在主体表面附近的别的盒子边上时不误判。
    const end = sample.point.clone().lerp(camera.position, Math.min(0.5, 0.05 / Math.max(1e-6, sample.point.distanceTo(camera.position))))
    const hits = candidates.filter((obstacle) => (sample.key || !ignoreForBody.has(obstacle.objectId))
      && segmentHitsObstacle(camera.position, end, obstacle))
    if (hits.length === 0) {
      visible += 1
      if (sample.key) keyVisible = true
    }
    for (const hit of hits) blockers.set(hit.objectId, hit.name)
  }
  return {
    visibleFraction: inFrame.length === 0 ? 0 : visible / inFrame.length,
    keyVisible,
    keyInFrame: inFrame.some((sample) => sample.key),
    occludedBy: [...blockers].map(([objectId, name]) => ({ objectId, name })),
  }
}

/* ── 读回 ─────────────────────────────────────────────────────────── */

/** 读回的形状就是对外契约，类型从契约 schema 推出，两边不会各写一份。 */
export type ShotSubjectReadback = z.infer<typeof cameraStageShotSubjectReadbackSchema>
export type ShotReadback = z.infer<typeof cameraStageShotReadbackSchema>

const round3 = (value: number): number => Math.round(value * 1000) / 1000
const toScreen = (projection: StageShotProjection): { x: number; y: number } => ({ x: round3((projection.x + 1) / 2), y: round3((1 - projection.y) / 2) })

/** 投影框的轮廓点：[高度比例, 占半宽的比例]。人头窄、肩最宽、腿收窄。 */
const CHARACTER_OUTLINE: ReadonlyArray<readonly [number, number]> = [[1, 0.45], [BODY.eye, 0.45], [BODY.shoulder, 1], [BODY.hip, 0.75], [BODY.knee, 0.5], [0, 0.5]]
const OBJECT_OUTLINE: ReadonlyArray<readonly [number, number]> = [[1, 1], [0.5, 1], [0, 1]]

function outlinePoints(subject: StageShotSubject, lateral: Vector3): Vector3[] {
  return (subject.kind === 'character' ? CHARACTER_OUTLINE : OBJECT_OUTLINE).flatMap(([fraction, width]) => {
    const axis = subjectAxisPoint(subject, fraction)
    return [axis.clone().addScaledVector(lateral, -width * subject.halfWidth), axis.clone().addScaledVector(lateral, width * subject.halfWidth)]
  })
}

/** 机位相对主体关键点的仰角分类；没有主体时按镜头俯仰。 */
export function classifyShotAngle(camera: StageShotCamera, subject: StageShotSubject | null): CameraStageShotAngle {
  let elevation = camera.rotation.x
  if (subject) {
    const key = subjectKeyPoint(subject)
    const horizontal = Math.hypot(camera.position.x - key.x, camera.position.z - key.z)
    elevation = Math.atan2(camera.position.y - key.y, horizontal) / DEG
    if (elevation >= 60) return 'birds_eye'
    if (elevation >= 12) return 'high'
    if (elevation <= -7) return 'low'
    return 'eye_level'
  }
  if (elevation <= -60) return 'birds_eye'
  if (elevation <= -12) return 'high'
  if (elevation >= 8) return 'low'
  return 'eye_level'
}

/**
 * 主体完整高度占画面高度的比例（头顶到脚底的投影长度，不按画框裁切）。
 * 鸟瞰时竖直的身高投影几乎缩成一点，改按“主体横放在关键点那一深度时占画高多少”算。
 */
export function projectedHeightRatio(camera: StageShotCamera, subject: StageShotSubject): number | null {
  if (classifyShotAngle(camera, subject) === 'birds_eye') {
    const depth = subjectKeyPoint(subject).sub(camera.position).dot(cameraForward(camera.rotation))
    return depth > 1e-6 ? subject.height / (2 * depth * Math.tan((camera.fov * DEG) / 2)) : null
  }
  const top = projectPoint(camera, subjectAxisPoint(subject, 1))
  const bottom = projectPoint(camera, subjectAxisPoint(subject, 0))
  return top.front && bottom.front ? Math.hypot(top.x - bottom.x, top.y - bottom.y) / 2 : null
}

export function readSubject(
  camera: StageShotCamera,
  subject: StageShotSubject,
  obstacles: readonly StageObstacle[],
  ignoreForBody?: ReadonlySet<string>,
): ShotSubjectReadback {
  const inverse = cameraQuaternion(camera.rotation).invert()
  const lateral = lateralFor(camera, subject)
  const key = projectPoint(camera, subjectKeyPoint(subject), inverse)
  const inFrame = key.front && Math.abs(key.x) <= 1 && Math.abs(key.y) <= 1
  const projected = outlinePoints(subject, lateral).map((point) => projectPoint(camera, point, inverse)).filter((point) => point.front)
  const clip = (value: number): number => Math.max(-1, Math.min(1, value))
  const xs = projected.map((point) => point.x)
  const ys = projected.map((point) => point.y)
  const overlaps = projected.length > 0 && Math.max(...xs) >= -1 && Math.min(...xs) <= 1 && Math.max(...ys) >= -1 && Math.min(...ys) <= 1
  const screenBox = overlaps ? {
    left: round3((clip(Math.min(...xs)) + 1) / 2),
    right: round3((clip(Math.max(...xs)) + 1) / 2),
    top: round3((1 - clip(Math.max(...ys))) / 2),
    bottom: round3((1 - clip(Math.min(...ys))) / 2),
  } : null
  const ratio = projectedHeightRatio(camera, subject)
  const heightRatio = ratio === null ? null : round3(ratio)
  const center = key.front ? toScreen(key) : null
  const horizontal = !inFrame || !center ? 'outside' : center.x < 0.42 ? 'left' : center.x > 0.58 ? 'right' : 'center'
  const visibility = measureVisibility(camera, subject, obstacles, ignoreForBody)
  let lookRoom: ShotSubjectReadback['lookRoom']
  if (subject.kind === 'character' && subject.front && key.front) {
    const ahead = projectPoint(camera, subjectKeyPoint(subject).addScaledVector(subject.front, 0.5), inverse)
    const facing = ahead.front ? ahead.x - key.x : 0
    lookRoom = horizontal === 'center' || Math.abs(facing) < 0.03 ? 'neutral'
      : (horizontal === 'left') === (facing > 0) ? 'open' : 'cramped'
  }
  return {
    objectId: subject.objectId,
    name: subject.name,
    inFrame,
    screenBox,
    center,
    heightRatio,
    shotSize: heightRatio === null ? null : classifyShotSize(heightRatio),
    horizontal,
    ...(lookRoom ? { lookRoom } : {}),
    visibleFraction: round3(visibility.visibleFraction),
    keyVisible: visibility.keyVisible,
    occludedBy: visibility.occludedBy,
  }
}

/** 角度按主要主体判断：过肩与正反打是被拍的那个人（最后一个），观察场景时是离镜头最近的那个。 */
export function readShot(
  camera: StageShotCamera,
  subjects: readonly StageShotSubject[],
  obstacles: readonly StageObstacle[],
  ignoreForBody?: ReadonlySet<string>,
  primary: StageShotSubject | undefined = subjects[subjects.length - 1],
): ShotReadback {
  return {
    angle: classifyShotAngle(camera, primary ?? null),
    focalLength: Math.round(fovToFocalLength(camera.fov)),
    subjects: subjects.map((subject) => readSubject(camera, subject, obstacles, ignoreForBody)),
  }
}

/**
 * 观察场景时每台摄像机拍到了谁：逐个放置的可见对象里关键点落在画面内的，按远近取前几个。
 * 角度按离画面中线最近的那个主体判断——过肩镜头里那是被拍者，不是画边的前景肩膀。
 * 观察不知道镜头的意图，前景人物挡住被拍者身体时如实列在 occludedBy 里。
 */
const OBSERVED_SUBJECT_LIMIT = 6

export function observeCameraComposition(camera: StageCameraObject, objects: readonly StageObject[], obstacles: readonly StageObstacle[] = shotObstacles(objects)): ShotReadback {
  const pose = shotCameraOf(camera)
  const inverse = cameraQuaternion(pose.rotation).invert()
  const visible = objects
    .filter((object) => object.visible && object.type !== 'camera' && !object.setId)
    .map((object) => {
      const subject = shotSubjectFromObject(object)
      const key = subjectKeyPoint(subject)
      return { subject, key, projected: projectPoint(pose, key, inverse) }
    })
    .filter(({ projected }) => projected.front && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1)
    .sort((left, right) => left.key.distanceTo(pose.position) - right.key.distanceTo(pose.position))
    .slice(0, OBSERVED_SUBJECT_LIMIT)
  const primary = [...visible].sort((left, right) => Math.abs(left.projected.x) - Math.abs(right.projected.x))[0]?.subject
  return readShot(pose, visible.map(({ subject }) => subject), obstacles, undefined, primary)
}
