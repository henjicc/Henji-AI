import { Euler, Matrix4, Quaternion, Vector3 } from 'three'

import type { z } from 'zod'

import type {
  cameraStageComposedShotSchema,
  CameraStageShotAngle,
  CameraStageShotLens,
  CameraStageShotPosition,
  CameraStageShotSize,
  CameraStageShotView,
} from '@/core/application-control/domains/cameraStage/cameraStageShotSchemas'
import { focalLengthToFov } from '../domain/cameraOptics'
import type { StageVec3 } from '../domain/sceneTypes'
import {
  BODY,
  SHOT_FRAMES,
  projectedHeightRatio,
  shotHeightRatio,
  WORLD_UP,
  cameraForward,
  measureVisibility,
  readShot,
  subjectAxisPoint,
  subjectKeyFraction,
  subjectKeyPoint,
  type ShotReadback,
  type StageShotCamera,
  type StageShotSubject,
} from './shotGeometry'
import { pointInsideObstacle, type StageObstacle } from './stageObstacles'

/**
 * 按构图意图求机位（Lino & Christie 2015 的 Toric space；遮挡按 Burg 等 2020 的思路在 Toric 参数邻域里换机位）。
 *
 * 两点在画面上的位置一旦给定，两条视线的夹角 α 就定了，满足它的机位落在绕两点连线旋转的圆弧面（Toric 曲面）上，
 * 7 个自由度的摄像机降成曲面上的两个角度：β（沿圆弧，决定离两点各多远）与 φ（绕连线转，决定高低）。
 * - 单人：两点取画面上缘与下缘切在主体身上的位置，机位沿“从主体看向镜头”的方向落在曲面上，景别因此精确；
 * - 双人：两点取两人的眼睛，β 取两人等距（双人镜头）或按被拍者的景别求距离（过肩），φ 按“从被拍者看镜头的仰角”求出，
 *   前景那人在画面上的高低由“画面不歪”反求，水平线始终是平的。
 * 朝向由两条视线对齐求出（两向量定姿），最后去掉滚转。
 *
 * 遮挡：以意图机位为中心，在 Toric 参数（方位、俯仰、焦距档位）的邻域里由近到远试，取第一个主体关键点
 * 可见、画面内采样点大部分可见的机位；轴线一侧不变。都挡住时取可见最多的那个并如实报告。
 */

const DEG = Math.PI / 180

export const SHOT_LENS_FOCAL_LENGTH: Record<CameraStageShotLens, number> = { wide: 24, standard: 50, telephoto: 85 }
const LENS_ORDER: readonly CameraStageShotLens[] = ['wide', 'standard', 'telephoto']

/** 角度意图的仰角（度，从主体关键点看镜头）与避让时允许的范围。 */
const ANGLE_ELEVATION: Record<CameraStageShotAngle, { base: number; min: number; max: number }> = {
  eye_level: { base: 0, min: -6, max: 8 },
  high: { base: 30, min: 15, max: 50 },
  low: { base: -20, min: -35, max: -8 },
  birds_eye: { base: 85, min: 70, max: 88 },
}

/** 单人镜头从主体哪一面拍：相对主体正面的方位角（度，向主体左手为正）。 */
const VIEW_AZIMUTH: Record<CameraStageShotView, number> = { front: 0, front_left: 40, front_right: -40, left: 90, right: -90, back: 180 }
const THREE_QUARTER = 40
const THIRD = 1 / 3
/** 过肩镜头前景那人头部中心的水平位置（NDC）。 */
const SHOULDER_X = 0.7
/** 机位离地最低高度、离障碍物表面最小距离（米）。 */
const MIN_CAMERA_HEIGHT = 0.15
const CAMERA_CLEARANCE = 0.15
/** 过肩时镜头离前景那人至少多远（米）。 */
const MIN_SHOULDER_DISTANCE = 0.4
/** 画面内采样点至少多少可见才算没被挡。 */
const CLEAR_VISIBLE_FRACTION = 0.7

const AZIMUTH_OFFSETS = [0, 15, -15, 30, -30, 45, -45]
const BETA_OFFSETS = [0, 0.12, -0.12, 0.25, -0.25]
const ELEVATION_OFFSETS = [0, 6, -6, 12, -12, 18]

export type ShotKind = 'single' | 'two_shot' | 'over_shoulder'

export interface ShotSpec {
  kind: ShotKind
  /** single 一个；two_shot 两个；over_shoulder 为 [前景, 被拍者] */
  subjects: StageShotSubject[]
  size: CameraStageShotSize
  position: CameraStageShotPosition
  view?: CameraStageShotView
  angle: CameraStageShotAngle
  lens: CameraStageShotLens
  aspect: number
  /** 摄像机当前位置：省略 view 时 3/4 正面落在这一侧 */
  currentPosition: Vector3
  /** 两人镜头机位所在的那一侧（水平单位向量，垂直于两人连线） */
  axisNormal: Vector3 | null
  avoidOcclusion: boolean
  obstacles: readonly StageObstacle[]
}

export type ShotAdjustment = NonNullable<z.infer<typeof cameraStageComposedShotSchema>['adjusted']>

export interface ShotSolution {
  camera: StageShotCamera
  lookAtTarget: Vector3
  lens: CameraStageShotLens
  adjusted: ShotAdjustment | null
  readback: ShotReadback
}

export class ShotCompositionError extends Error {}

interface Candidate {
  azimuth: number
  beta: number
  elevation: number
  lens: CameraStageShotLens
  cost: number
}

function ray(fov: number, aspect: number, x: number, y: number): Vector3 {
  const tanV = Math.tan((fov * DEG) / 2)
  return new Vector3(x * tanV * aspect, y * tanV, -1).normalize()
}

/** 两向量定姿：机位处看两点的方向对齐镜头里两条视线，返回 YXZ 欧拉角（度）与是否正立。 */
function alignTwoRays(position: Vector3, a: Vector3, b: Vector3, rayA: Vector3, rayB: Vector3): { rotation: StageVec3; upright: boolean } {
  const da = a.clone().sub(position).normalize()
  const db = b.clone().sub(position).normalize()
  const w1 = da.clone().add(db).normalize()
  const w2 = new Vector3().crossVectors(da, db).normalize()
  const w3 = new Vector3().crossVectors(w1, w2)
  const k1 = rayA.clone().add(rayB).normalize()
  const k2 = new Vector3().crossVectors(rayA, rayB).normalize()
  const k3 = new Vector3().crossVectors(k1, k2)
  const world = new Matrix4().makeBasis(w1, w2, w3)
  const camera = new Matrix4().makeBasis(k1, k2, k3).transpose()
  const rotation = world.multiply(camera)
  const euler = new Euler().setFromRotationMatrix(rotation, 'YXZ')
  const up = new Vector3(0, 1, 0).applyQuaternion(new Quaternion().setFromRotationMatrix(rotation))
  return { rotation: { x: euler.x / DEG, y: euler.y / DEG, z: euler.z / DEG }, upright: up.y > 0 }
}

/** 机位沿 pivot + v·t 移动，找到两点视线夹角正好为 α 的距离；夹角随距离单调变小。 */
function distanceAlongRay(a: Vector3, b: Vector3, alpha: number, pivot: Vector3, direction: Vector3): number | null {
  const angleAt = (t: number): number => {
    const position = pivot.clone().addScaledVector(direction, t)
    return a.clone().sub(position).angleTo(b.clone().sub(position))
  }
  let low = 1e-4
  let high = 1e5
  if (angleAt(low) < alpha || angleAt(high) > alpha) return null
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const middle = Math.sqrt(low * high)
    if (angleAt(middle) > alpha) low = middle
    else high = middle
  }
  return Math.sqrt(low * high)
}

/** Toric 曲面上的点：β 是在 a 处 ab 与 a→机位的夹角，φ 是绕 ab 从 side 方向往上转的角。 */
function toricPosition(a: Vector3, b: Vector3, alpha: number, beta: number, phi: number, side: Vector3): Vector3 | null {
  if (!(beta > 0 && beta < Math.PI - alpha)) return null
  const ab = b.clone().sub(a)
  const length = ab.length()
  const n = ab.clone().divideScalar(length)
  const zero = side.clone().addScaledVector(n, -n.dot(side))
  if (zero.lengthSq() < 1e-9) zero.crossVectors(n, WORLD_UP)
  if (zero.lengthSq() < 1e-9) zero.set(1, 0, 0)
  zero.normalize()
  const up = WORLD_UP.clone().addScaledVector(n, -n.dot(WORLD_UP)).addScaledVector(zero, -zero.dot(WORLD_UP))
  if (up.lengthSq() < 1e-9) up.crossVectors(n, zero)
  up.normalize()
  const plane = zero.multiplyScalar(Math.cos(phi)).addScaledVector(up, Math.sin(phi))
  const direction = n.multiplyScalar(Math.cos(beta)).addScaledVector(plane, Math.sin(beta))
  return a.clone().addScaledVector(direction, (length * Math.sin(alpha + beta)) / Math.sin(alpha))
}

/** 景别下人物眼睛（或物体中心）在画面里的高度（NDC）。 */
function keyScreenY(size: CameraStageShotSize, subject: StageShotSubject): number {
  const frame = SHOT_FRAMES[size]
  return Math.max(-0.85, Math.min(0.85, 1 - (2 * (frame.top - subjectKeyFraction(subject))) / (frame.top - frame.bottom)))
}

function horizontal(vector: Vector3): Vector3 {
  return new Vector3(vector.x, 0, vector.z)
}

function lensCost(requested: CameraStageShotLens, lens: CameraStageShotLens): number {
  return Math.abs(LENS_ORDER.indexOf(requested) - LENS_ORDER.indexOf(lens)) * 0.6
}

function elevationsFor(angle: CameraStageShotAngle): number[] {
  const range = ANGLE_ELEVATION[angle]
  return [...new Set(ELEVATION_OFFSETS.map((offset) => Math.max(range.min, Math.min(range.max, range.base + offset))))]
}

function candidatesFor(spec: ShotSpec): Candidate[] {
  const base = ANGLE_ELEVATION[spec.angle].base
  const azimuths = spec.kind === 'single' ? AZIMUTH_OFFSETS : [0]
  const betas = spec.kind === 'two_shot' ? BETA_OFFSETS : [0]
  const list: Candidate[] = []
  for (const lens of LENS_ORDER) {
    for (const elevation of elevationsFor(spec.angle)) {
      for (const azimuth of azimuths) {
        for (const beta of betas) {
          list.push({
            azimuth, beta, elevation, lens,
            cost: Math.abs(azimuth) / 45 + Math.abs(beta) / 0.25 + Math.abs(elevation - base) / 20 + lensCost(spec.lens, lens),
          })
        }
      }
    }
  }
  return list.sort((left, right) => left.cost - right.cost)
}

type Solved = { camera: StageShotCamera; key: Vector3 } | { failure: 'too_close' }

function solveSingle(spec: ShotSpec, candidate: Candidate): Solved | null {
  const subject = spec.subjects[0]
  const frame = SHOT_FRAMES[spec.size]
  const fov = focalLengthToFov(SHOT_LENS_FOCAL_LENGTH[candidate.lens])
  const toCamera = horizontal(spec.currentPosition.clone().sub(subject.base))
  const front = subject.front?.clone() ?? (toCamera.lengthSq() > 1e-9 ? toCamera.clone().normalize() : new Vector3(0, 0, 1))
  const left = new Vector3().crossVectors(WORLD_UP, front)
  const viewAzimuth = spec.view ? VIEW_AZIMUTH[spec.view] : toCamera.dot(left) >= 0 ? THREE_QUARTER : -THREE_QUARTER
  const azimuth = (viewAzimuth + candidate.azimuth) * DEG
  const toward = front.clone().multiplyScalar(Math.cos(azimuth)).addScaledVector(left, Math.sin(azimuth))
  const elevation = candidate.elevation * DEG
  const direction = toward.clone().multiplyScalar(Math.cos(elevation)).addScaledVector(WORLD_UP, Math.sin(elevation))

  // 视线前方留空：人朝画面右边看就站左三分线，朝左看站右三分线，正对或背对镜头居中。
  const cameraRight = new Vector3().crossVectors(toward.clone().negate(), WORLD_UP)
  const facing = subject.kind === 'character' && subject.front ? subject.front.dot(cameraRight) : 0
  const screenX = spec.position === 'left' ? -THIRD : spec.position === 'right' ? THIRD : spec.position === 'center' ? 0
    : facing > 0.3 ? -THIRD : facing < -0.3 ? THIRD : 0

  const frameHeight = (frame.top - frame.bottom) * subject.height
  let top: Vector3
  let bottom: Vector3
  let pivot: Vector3
  if (candidate.elevation >= 60) {
    // 鸟瞰：画面上下缘沿水平方向铺在主体顶面，离镜头远的一边在画面上方。
    pivot = subjectAxisPoint(subject, 1)
    top = pivot.clone().addScaledVector(toward, -frameHeight / 2)
    bottom = pivot.clone().addScaledVector(toward, frameHeight / 2)
  } else {
    top = subjectAxisPoint(subject, frame.top)
    bottom = subjectAxisPoint(subject, frame.bottom)
    pivot = subjectAxisPoint(subject, Math.min(frame.top - 0.01, Math.max(frame.bottom + 0.01, subjectKeyFraction(subject))))
  }
  const rayTop = ray(fov, spec.aspect, screenX, 1)
  const rayBottom = ray(fov, spec.aspect, screenX, -1)
  const distance = distanceAlongRay(top, bottom, rayTop.angleTo(rayBottom), pivot, direction)
  if (distance === null) return null
  const position = pivot.clone().addScaledVector(direction, distance)
  const { rotation } = alignTwoRays(position, top, bottom, rayTop, rayBottom)
  return { camera: { position, rotation: { ...rotation, z: 0 }, fov, aspect: spec.aspect }, key: subjectKeyPoint(subject) }
}

/** 从被拍者关键点看机位的仰角（度）；与读回的角度分类同一口径。 */
function elevationFrom(point: Vector3, position: Vector3): number {
  return Math.atan2(position.y - point.y, Math.hypot(position.x - point.x, position.z - point.z)) / DEG
}

const PHI_RANGE = { min: -84, max: 88 }
/** 过肩机位高出前景那人眼睛多少（米），避让时每度俯仰换算成的高度变化。 */
const SHOULDER_CAMERA_RISE = 0.05
const SHOULDER_RISE_PER_DEGREE = 0.02

/**
 * φ 是绕两人连线转的角，不是仰角：过肩时机位贴着连线，φ 转到 85° 机位就跑到前景那人头顶、肩膀出画。
 * 双人镜头按“从被拍者看的仰角”取 φ；过肩镜头按“机位与前景那人眼睛同高”取 φ，俯仰由两人高低自然决定。
 * 在 φ 上扫一遍取误差最小的。
 */
function choosePhi(a: Vector3, b: Vector3, alpha: number, beta: number, side: Vector3, error: (position: Vector3) => number): number | null {
  let best: { phi: number; error: number } | null = null
  for (let degrees = PHI_RANGE.min; degrees <= PHI_RANGE.max; degrees += 2) {
    const position = toricPosition(a, b, alpha, beta, degrees * DEG, side)
    if (!position) continue
    const value = Math.abs(error(position))
    if (!best || value < best.error) best = { phi: degrees, error: value }
  }
  return best?.phi ?? null
}

/** 一组画面参数下的两点定位：先按机位高低取 φ，a 的画面高度由“画面不歪”反求。 */
function solveTwoOnce(
  spec: ShotSpec, candidate: Candidate, fov: number, a: Vector3, b: Vector3,
  screen: { ax: number; bx: number; by: number }, beta: (alpha: number) => number | 'too_close' | null,
): Solved | null {
  const { ax, bx, by } = screen
  const side = spec.axisNormal ?? new Vector3(1, 0, 0)
  let tooClose = false
  const evaluate = (ay: number, phi: number): { position: Vector3; rotation: StageVec3; upright: boolean } | null => {
    const alpha = ray(fov, spec.aspect, ax, ay).angleTo(ray(fov, spec.aspect, bx, by))
    const angle = beta(alpha)
    if (angle === 'too_close') { tooClose = true; return null }
    if (angle === null) return null
    const position = toricPosition(a, b, alpha, angle, phi * DEG, side)
    if (!position) return null
    if (spec.kind === 'over_shoulder' && position.distanceTo(a) < MIN_SHOULDER_DISTANCE) { tooClose = true; return null }
    // 先看两人在机位看来谁左谁右，再把画面位置对上；左右互换不改变夹角，机位不变。
    const forward = a.clone().add(b).multiplyScalar(0.5).sub(position)
    const right = new Vector3().crossVectors(forward, WORLD_UP)
    const sign = (a.clone().sub(position).dot(right) < b.clone().sub(position).dot(right)) !== (ax < bx) ? -1 : 1
    return { position, ...alignTwoRays(position, a, b, ray(fov, spec.aspect, sign * ax, ay), ray(fov, spec.aspect, sign * bx, by)) }
  }

  // a 的画面高度在 [-0.95, 0.95] 里找使滚转为零的值：先粗扫找变号，再二分。
  const levelAt = (phi: number): { ay: number; result: NonNullable<ReturnType<typeof evaluate>> } | null => {
    const samples = Array.from({ length: 21 }, (_, index) => -0.95 + (1.9 * index) / 20)
      .map((ay) => ({ ay, result: evaluate(ay, phi) }))
      .filter((item): item is { ay: number; result: NonNullable<ReturnType<typeof evaluate>> } => item.result !== null && item.result.upright)
    if (samples.length === 0) return null
    let best = samples.reduce((left, right) => (Math.abs(right.result.rotation.z) < Math.abs(left.result.rotation.z) ? right : left))
    for (let index = 1; index < samples.length; index += 1) {
      let low = samples[index - 1]
      let high = samples[index]
      if (Math.sign(low.result.rotation.z) === Math.sign(high.result.rotation.z)) continue
      for (let iteration = 0; iteration < 40; iteration += 1) {
        const ay = (low.ay + high.ay) / 2
        const result = evaluate(ay, phi)
        if (!result || !result.upright) break
        if (Math.sign(result.rotation.z) === Math.sign(low.result.rotation.z)) low = { ay, result }
        else high = { ay, result }
      }
      const refined = Math.abs(low.result.rotation.z) < Math.abs(high.result.rotation.z) ? low : high
      if (Math.abs(refined.result.rotation.z) < Math.abs(best.result.rotation.z)) best = refined
    }
    return best
  }

  // 先按 a 与 b 同高估一个 φ；a 的高低会改变夹角，解完按实际夹角再取一次 φ。
  const heightError = (position: Vector3): number => spec.kind === 'over_shoulder'
    ? position.y - (a.y + SHOULDER_CAMERA_RISE + SHOULDER_RISE_PER_DEGREE * candidate.elevation)
    : elevationFrom(b, position) - candidate.elevation
  const phiAt = (ay: number): number | null => {
    const alpha = ray(fov, spec.aspect, ax, ay).angleTo(ray(fov, spec.aspect, bx, by))
    const angle = beta(alpha)
    if (angle === 'too_close') { tooClose = true; return null }
    return angle === null ? null : choosePhi(a, b, alpha, angle, side, heightError)
  }
  const phi = phiAt(by)
  let best = phi === null ? null : levelAt(phi)
  const refinedPhi = best ? phiAt(best.ay) : null
  if (best && refinedPhi !== null && refinedPhi !== phi) {
    const refined = levelAt(refinedPhi)
    if (refined && Math.abs(heightError(refined.result.position)) < Math.abs(heightError(best.result.position))) best = refined
  }
  if (!best) return tooClose ? { failure: 'too_close' } : null
  return { camera: { position: best.result.position, rotation: { ...best.result.rotation, z: 0 }, fov, aspect: spec.aspect }, key: b }
}

/**
 * 两人：双人镜头两人的眼睛落在两侧，画面上下缘取两人各自该景别画框的并集（一高一矮时高的那个不被切头），
 * 两人在画面上拉开多远由景别反推；过肩镜头被拍者落在三分线上，前景那人头部在另一边画缘附近，机位离被拍者的距离由景别给出。
 * 俯拍、仰拍时身体在画面里被透视压短，按读回的景别把间距或距离校正一两次。
 */
function solveTwo(spec: ShotSpec, candidate: Candidate): Solved | null {
  const [first, second] = spec.subjects
  const shoulder = spec.kind === 'over_shoulder'
  const fov = focalLengthToFov(SHOT_LENS_FOCAL_LENGTH[candidate.lens])
  const a = shoulder ? subjectAxisPoint(first, BODY.eye) : subjectKeyPoint(first)
  const b = subjectKeyPoint(second)
  const separation = a.distanceTo(b)
  if (separation < 0.05) return null
  const frame = SHOT_FRAMES[spec.size]
  const tanV = Math.tan((fov * DEG) / 2)
  const frameTop = Math.max(...spec.subjects.map((subject) => subject.base.y + frame.top * subject.height))
  const frameBottom = Math.min(...spec.subjects.map((subject) => subject.base.y + frame.bottom * subject.height))
  const reference = shoulder ? second : [first, second].sort((left, right) => right.height - left.height)[0]
  const target = shoulder ? shotHeightRatio(spec.size) : reference.height / (frameTop - frameBottom)
  const by = shoulder ? keyScreenY(spec.size, second) : Math.max(-0.85, Math.min(0.85, 1 - (2 * (frameTop - b.y)) / (frameTop - frameBottom)))
  let scale = 1
  let solved: Solved | null = null
  for (let pass = 0; pass < 3; pass += 1) {
    if (shoulder) {
      // 过肩：机位在前景那人身后，离被拍者的距离由景别给出，取 β 的钝角解。
      const subjectDistance = (((frame.top - frame.bottom) * second.height) / (2 * tanV)) * scale
      solved = solveTwoOnce(spec, candidate, fov, a, b, { ax: -SHOULDER_X, bx: THIRD, by }, (alpha) => {
        const sine = (subjectDistance * Math.sin(alpha)) / separation
        return sine > 1 || subjectDistance <= separation ? 'too_close' : Math.PI - Math.asin(sine)
      })
    } else {
      const spread = Math.max(0.15, Math.min(0.72, (horizontal(b.clone().sub(a)).length() / ((frameTop - frameBottom) * spec.aspect)) * scale))
      solved = solveTwoOnce(spec, candidate, fov, a, b, { ax: -spread, bx: spread, by }, (alpha) => (Math.PI - alpha) / 2 + candidate.beta)
    }
    if (!solved || 'failure' in solved || candidate.elevation >= 60) return solved
    const actual = projectedHeightRatio(solved.camera, reference)
    if (actual === null || Math.abs(actual / target - 1) < 0.03) return solved
    // 主体显得太小就离近一些：过肩缩短距离，双人拉开间距。
    scale *= shoulder ? actual / target : target / actual
  }
  return solved
}

interface Evaluated {
  candidate: Candidate
  solved: Solved | null
  /** 几何上不成立的原因；成立为 null */
  invalid: ShotAdjustment['reasons'][number] | 'unsolvable' | null
  clear: boolean
  score: number
  blockedBy: string[]
  /** 机位落进了谁的盒子里 */
  insideOf: string | null
}

function evaluateCandidate(spec: ShotSpec, candidate: Candidate): Evaluated {
  const solved = spec.kind === 'single' ? solveSingle(spec, candidate) : solveTwo(spec, candidate)
  const rejected = { clear: false, score: -Infinity, blockedBy: [], insideOf: null }
  if (!solved) return { ...rejected, candidate, solved, invalid: 'unsolvable' }
  if ('failure' in solved) return { ...rejected, candidate, solved: null, invalid: solved.failure }
  const position = solved.camera.position
  if (position.y < MIN_CAMERA_HEIGHT) return { ...rejected, candidate, solved, invalid: 'ground' }
  const inside = spec.obstacles.find((obstacle) => pointInsideObstacle(position, obstacle, CAMERA_CLEARANCE))
  if (inside) return { ...rejected, candidate, solved, invalid: 'inside_object', insideOf: inside.name }
  const foreground = spec.kind === 'over_shoulder' ? spec.subjects[0] : null
  const ignore = new Set(foreground?.objectId ? [foreground.objectId] : [])
  const main = spec.subjects.filter((subject) => subject !== foreground)
  const visibility = main.map((subject) => measureVisibility(solved.camera, subject, spec.obstacles, ignore))
  const clear = visibility.every((item) => item.keyInFrame && item.keyVisible && item.visibleFraction >= CLEAR_VISIBLE_FRACTION)
  const score = visibility.reduce((total, item) => total + item.visibleFraction + (item.keyVisible ? 1 : 0), 0) - candidate.cost * 0.05
  return { candidate, solved, invalid: null, clear, score, insideOf: null, blockedBy: [...new Set(visibility.flatMap((item) => item.occludedBy.map((blocker) => blocker.name)))] }
}

function describeAdjustment(spec: ShotSpec, requested: Evaluated, chosen: Evaluated): ShotAdjustment | null {
  const reasons: ShotAdjustment['reasons'] = []
  if (requested.invalid && requested.invalid !== 'unsolvable') reasons.push(requested.invalid)
  if (!requested.invalid && !requested.clear && spec.avoidOcclusion) reasons.push('occlusion')
  const azimuth = chosen.candidate.azimuth
  // 过肩的候选按机位高度换算，报告实际升降与从被拍者看的仰角变化，不报候选里的名义度数。
  const shoulder = spec.kind === 'over_shoulder'
  const requestedCamera = requested.solved && !('failure' in requested.solved) ? requested.solved.camera.position : null
  const chosenCamera = chosen.solved && !('failure' in chosen.solved) ? chosen.solved.camera.position : null
  const key = subjectKeyPoint(spec.subjects[spec.subjects.length - 1])
  const rise = shoulder && requestedCamera && chosenCamera ? Math.round((chosenCamera.y - requestedCamera.y) * 100) : 0
  const elevation = shoulder
    ? (requestedCamera && chosenCamera ? Math.round((elevationFrom(key, chosenCamera) - elevationFrom(key, requestedCamera)) * 10) / 10 : 0)
    : chosen.candidate.elevation - requested.candidate.elevation
  const lens = chosen.candidate.lens !== spec.lens ? chosen.candidate.lens : null
  const moved = azimuth !== 0 || chosen.candidate.elevation !== requested.candidate.elevation || chosen.candidate.beta !== 0 || lens !== null
  if (!moved) return null
  const changes: string[] = []
  if (azimuth !== 0) changes.push(`绕主体${azimuth > 0 ? '向主体左手' : '向主体右手'}转了 ${Math.abs(azimuth)}°`)
  // β 是在第一个人处量的角，变大时机位离第一个人更近。
  if (chosen.candidate.beta !== 0) changes.push(`机位往${chosen.candidate.beta > 0 ? '第一个人' : '第二个人'}那边挪了一些`)
  if (shoulder && rise !== 0) changes.push(`机位${rise > 0 ? '升高' : '降低'}了 ${Math.abs(rise)} 厘米`)
  else if (!shoulder && elevation !== 0) changes.push(`机位${elevation > 0 ? '抬高' : '降低'}了 ${Math.abs(elevation)}°`)
  if (lens) changes.push(`焦距从 ${SHOT_LENS_FOCAL_LENGTH[spec.lens]}mm 换成 ${SHOT_LENS_FOCAL_LENGTH[lens]}mm（机位${LENS_ORDER.indexOf(lens) < LENS_ORDER.indexOf(spec.lens) ? '更近' : '更远'}）`)
  const why = reasons.map((reason) => ({
    occlusion: `意图机位被${requested.blockedBy.length > 0 ? `「${requested.blockedBy.join('」「')}」` : '其他对象'}挡住`,
    ground: '意图机位会钻到地面以下',
    inside_object: `意图机位会落进「${requested.insideOf ?? '某个对象'}」里面`,
    too_close: '这个焦距下机位会贴到前景那人身上',
  }[reason]))
  if (why.length === 0 && changes.length === 0) return null
  return {
    reasons,
    blockedBy: requested.blockedBy,
    azimuthDegrees: azimuth,
    elevationDegrees: elevation,
    lens,
    summary: `${[why.join('，'), changes.join('，')].filter(Boolean).join('；')}。`,
  }
}

/** 求一台摄像机的构图机位；意图在任何焦距与角度邻域里都无解时抛 ShotCompositionError。 */
export function composeShot(spec: ShotSpec): ShotSolution {
  const candidates = candidatesFor(spec)
  const evaluated: Evaluated[] = []
  let chosen: Evaluated | null = null
  for (const candidate of candidates) {
    const result = evaluateCandidate(spec, candidate)
    evaluated.push(result)
    if (!result.invalid && (result.clear || !spec.avoidOcclusion)) { chosen = result; break }
  }
  chosen ??= evaluated.filter((item) => !item.invalid).sort((left, right) => right.score - left.score)[0] ?? null
  if (!chosen?.solved || 'failure' in chosen.solved) {
    const failures = new Set(evaluated.map((item) => item.invalid))
    throw new ShotCompositionError(failures.has('too_close')
      ? 'SHOT_NOT_REACHABLE：两人离得太近，任何焦距下机位都会贴到前景那人身上；把两人拉开一些或改用 two_shot。'
      : failures.has('ground') || failures.has('inside_object')
        ? 'SHOT_NOT_REACHABLE：意图附近的机位都在地面以下或其他对象内部；换角度（angle）、景别或主体位置。'
        : 'SHOT_NOT_REACHABLE：这个景别与角度在场景里求不出机位；换景别或角度。')
  }
  const requested = evaluated[0]
  const camera = chosen.solved.camera
  const ignore = spec.kind === 'over_shoulder' && spec.subjects[0].objectId ? new Set([spec.subjects[0].objectId]) : undefined
  return {
    camera,
    lookAtTarget: camera.position.clone().addScaledVector(cameraForward(camera.rotation), Math.max(0.5, camera.position.distanceTo(chosen.solved.key))),
    lens: chosen.candidate.lens,
    adjusted: describeAdjustment(spec, requested, chosen),
    readback: readShot(camera, spec.subjects, spec.obstacles, ignore),
  }
}

/* ── 轴线 ─────────────────────────────────────────────────────────── */

function subjectSortKey(subject: StageShotSubject): string {
  return subject.objectId ?? `point:${subject.base.x},${subject.base.y},${subject.base.z}`
}

/** 两人连线的规范方向：按主体稳定标识排序，谁先谁后与调用顺序无关，同一对人的所有机位用同一条轴线。 */
function canonicalAxisNormal(subjects: readonly StageShotSubject[]): Vector3 {
  const [a, b] = [...subjects].sort((left, right) => (subjectSortKey(left) < subjectSortKey(right) ? -1 : 1))
  const along = horizontal(b.base.clone().sub(a.base))
  if (along.lengthSq() < 1e-9) along.set(1, 0, 0)
  return new Vector3().crossVectors(along.normalize(), WORLD_UP).normalize()
}

/** 某个机位在两人轴线的哪一侧（+1 / -1）。 */
export function axisSideOf(position: Vector3, subjects: readonly StageShotSubject[]): 1 | -1 {
  const middle = subjects[0].base.clone().add(subjects[1].base).multiplyScalar(0.5)
  return position.clone().sub(middle).dot(canonicalAxisNormal(subjects)) >= 0 ? 1 : -1
}

export function axisNormalFor(subjects: readonly StageShotSubject[], side: 1 | -1): Vector3 {
  return canonicalAxisNormal(subjects).multiplyScalar(side)
}
