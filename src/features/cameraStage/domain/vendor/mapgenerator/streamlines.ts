/*
 * 移植自 ProbableTrain/MapGenerator（https://github.com/ProbableTrain/MapGenerator，提交 f487e4cee321d105d5b0e14258363fa8b4d004ef）
 * 的 src/ts/impl/streamlines.ts。按 LGPL-3.0-only 使用，许可全文见同目录 COPYING.LESSER 与 COPYING。
 * 算法见 Chen 等，Interactive Procedural Street Modeling（SIGGRAPH 2008）。
 *
 * 2026-11-04 痕迹AI 的修改：
 * - 撒种与“提前碰撞”的随机数由调用方传入（原为 Math.random），同一种子总是得到同一张路网；
 * - 一次同步生成全部流线（原为分帧动画的 Promise 接口），去掉 loglevel；
 * - 参数平方值显式列出（原为遍历带 any 索引签名的参数对象）。
 */

import simplify from 'simplify-js'

import type FieldIntegrator from './integrator'
import GridStorage from './grid_storage'
import Vector from './vector'

interface StreamlineIntegration {
  seed: Vector
  originalDir: Vector
  streamline: Vector[]
  previousDirection: Vector
  previousPoint: Vector
  valid: boolean
}

export interface StreamlineParams {
  /** 同向流线的撒种间距 */
  dsep: number
  /** 积分时与其他流线保持的间距 */
  dtest: number
  /** 积分步长 */
  dstep: number
  /** 首尾相接成环的判定距离（约 2 倍步长） */
  dcirclejoin: number
  /** 悬空端点向前找连接点的距离 */
  dlookahead: number
  /** 连接悬空端点允许的夹角（弧度） */
  joinangle: number
  /** 单条流线的积分步数上限 */
  pathIterations: number
  /** 连续撒种失败多少次后结束 */
  seedTries: number
  simplifyTolerance: number
  /** 同时与主次两组流线保持间距的概率 0–1 */
  collideEarly: number
}

/** 积分张量场得到道路折线。 */
export default class StreamlineGenerator {
  protected readonly SEED_AT_ENDPOINTS = false

  protected majorGrid: GridStorage
  protected minorGrid: GridStorage
  protected paramsSq: { dsep: number; dtest: number; dstep: number; dcirclejoin: number }

  protected candidateSeedsMajor: Vector[] = []
  protected candidateSeedsMinor: Vector[] = []

  allStreamlines: Vector[][] = []
  streamlinesMajor: Vector[][] = []
  streamlinesMinor: Vector[][] = []
  /** 简化后的折线（顶点更少） */
  allStreamlinesSimple: Vector[][] = []

  constructor(
    protected integrator: FieldIntegrator,
    protected origin: Vector,
    protected worldDimensions: Vector,
    protected params: StreamlineParams,
    protected random: () => number,
  ) {
    // 积分间距不能大于撒种间距
    params.dtest = Math.min(params.dtest, params.dsep)
    this.majorGrid = new GridStorage(this.worldDimensions, this.origin, params.dsep)
    this.minorGrid = new GridStorage(this.worldDimensions, this.origin, params.dsep)
    this.paramsSq = { dsep: params.dsep ** 2, dtest: params.dtest ** 2, dstep: params.dstep ** 2, dcirclejoin: params.dcirclejoin ** 2 }
  }

  /** 把悬空的端点接到附近的路上 */
  joinDanglingStreamlines(): void {
    for (const major of [true, false]) {
      for (const streamline of this.streamlines(major)) {
        // 环不处理
        if (streamline[0].equals(streamline[streamline.length - 1])) continue
        const newStart = this.getBestNextPoint(streamline[0], streamline[4])
        if (newStart !== null) {
          for (const p of this.pointsBetween(streamline[0], newStart, this.params.dstep)) {
            streamline.unshift(p)
            this.grid(major).addSample(p)
          }
        }
        const newEnd = this.getBestNextPoint(streamline[streamline.length - 1], streamline[streamline.length - 4])
        if (newEnd !== null) {
          for (const p of this.pointsBetween(streamline[streamline.length - 1], newEnd, this.params.dstep)) {
            streamline.push(p)
            this.grid(major).addSample(p)
          }
        }
      }
    }
    this.allStreamlinesSimple = this.allStreamlines.map(s => this.simplifyStreamline(s))
  }

  /** v1 到 v2 之间按不超过 dstep 的间隔取点，不含 v1 */
  pointsBetween(v1: Vector, v2: Vector, dstep: number): Vector[] {
    const d = v1.distanceTo(v2)
    const nPoints = Math.floor(d / dstep)
    if (nPoints === 0) return []
    const stepVector = v2.clone().sub(v1)
    const out: Vector[] = []
    let next = v1.clone().add(stepVector.clone().multiplyScalar(1 / nPoints))
    for (let i = 1; i <= nPoints; i++) {
      // 退化点（水面上）停下
      if (this.integrator.integrate(next, true).lengthSq() > 0.001) {
        out.push(next)
      } else {
        return out
      }
      next = v1.clone().add(stepVector.clone().multiplyScalar(i / nPoints))
    }
    return out
  }

  /** 找最适合接上的下一点；没有合适的返回 null */
  getBestNextPoint(point: Vector, previousPoint: Vector): Vector | null {
    const nearbyPoints = this.majorGrid.getNearbyPoints(point, this.params.dlookahead)
    nearbyPoints.push(...this.minorGrid.getNearbyPoints(point, this.params.dlookahead))
    const direction = point.clone().sub(previousPoint)
    let closestSample: Vector | null = null
    let closestDistance = Infinity
    for (const sample of nearbyPoints) {
      if (sample.equals(point) || sample.equals(previousPoint)) continue
      const differenceVector = sample.clone().sub(point)
      // 往回走的不要
      if (differenceVector.dot(direction) < 0) continue
      const distanceToSample = point.distanceToSquared(sample)
      if (distanceToSample < 2 * this.paramsSq.dstep) {
        closestSample = sample
        break
      }
      const angleBetween = Math.abs(Vector.angleBetween(direction, differenceVector))
      if (angleBetween < this.params.joinangle && distanceToSample < closestDistance) {
        closestDistance = distanceToSample
        closestSample = sample
      }
    }
    // 端点越过目标一点，简化后的折线仍与目标相交
    if (closestSample !== null) {
      closestSample = closestSample.clone().add(direction.setLength(this.params.simplifyTolerance * 4))
    }
    return closestSample
  }

  /** s 已生成完毕 */
  addExistingStreamlines(s: StreamlineGenerator): void {
    this.majorGrid.addAll(s.majorGrid)
    this.minorGrid.addAll(s.minorGrid)
  }

  /** 一次生成全部流线 */
  createAllStreamlines(): void {
    let major = true
    while (this.createStreamline(major)) major = !major
    this.joinDanglingStreamlines()
  }

  protected simplifyStreamline(streamline: readonly Vector[]): Vector[] {
    return simplify(streamline as Vector[], this.params.simplifyTolerance).map(point => new Vector(point.x, point.y))
  }

  /** 找种子并积分出一条流线；撒种 seedTries 次都失败时返回 false */
  protected createStreamline(major: boolean): boolean {
    const seed = this.getSeed(major)
    if (seed === null) return false
    const streamline = this.integrateStreamline(seed, major)
    if (this.validStreamline(streamline)) {
      this.grid(major).addPolyline(streamline)
      this.streamlines(major).push(streamline)
      this.allStreamlines.push(streamline)
      this.allStreamlinesSimple.push(this.simplifyStreamline(streamline))
      if (!streamline[0].equals(streamline[streamline.length - 1])) {
        this.candidateSeeds(!major).push(streamline[0])
        this.candidateSeeds(!major).push(streamline[streamline.length - 1])
      }
    }
    return true
  }

  protected validStreamline(s: readonly Vector[]): boolean {
    return s.length > 5
  }

  protected samplePoint(): Vector {
    return new Vector(this.random() * this.worldDimensions.x, this.random() * this.worldDimensions.y).add(this.origin)
  }

  /** 先试候选种子，再随机撒 */
  protected getSeed(major: boolean): Vector | null {
    if (this.SEED_AT_ENDPOINTS && this.candidateSeeds(major).length > 0) {
      while (this.candidateSeeds(major).length > 0) {
        const seed = this.candidateSeeds(major).pop()!
        if (this.isValidSample(major, seed, this.paramsSq.dsep)) return seed
      }
    }
    let seed = this.samplePoint()
    let i = 0
    while (!this.isValidSample(major, seed, this.paramsSq.dsep)) {
      if (i >= this.params.seedTries) return null
      seed = this.samplePoint()
      i++
    }
    return seed
  }

  protected isValidSample(major: boolean, point: Vector, dSq: number, bothGrids = false): boolean {
    let gridValid = this.grid(major).isValidSample(point, dSq)
    if (bothGrids) gridValid = gridValid && this.grid(!major).isValidSample(point, dSq)
    return this.integrator.onLand(point) && gridValid
  }

  protected candidateSeeds(major: boolean): Vector[] {
    return major ? this.candidateSeedsMajor : this.candidateSeedsMinor
  }

  protected streamlines(major: boolean): Vector[][] {
    return major ? this.streamlinesMajor : this.streamlinesMinor
  }

  protected grid(major: boolean): GridStorage {
    return major ? this.majorGrid : this.minorGrid
  }

  protected pointInBounds(v: Vector): boolean {
    return v.x >= this.origin.x && v.y >= this.origin.y
      && v.x < this.worldDimensions.x + this.origin.x && v.y < this.worldDimensions.y + this.origin.y
  }

  /** 流线是否已转过 180 度（防止绕成螺旋） */
  protected streamlineTurned(seed: Vector, originalDir: Vector, point: Vector, direction: Vector): boolean {
    if (originalDir.dot(direction) < 0) {
      const perpendicularVector = new Vector(originalDir.y, -originalDir.x)
      const isLeft = point.clone().sub(seed).dot(perpendicularVector) < 0
      const directionUp = direction.dot(perpendicularVector) > 0
      return isLeft === directionUp
    }
    return false
  }

  /** 积分一步 */
  protected streamlineIntegrationStep(params: StreamlineIntegration, major: boolean, collideBoth: boolean): void {
    if (!params.valid) return
    params.streamline.push(params.previousPoint)
    const nextDirection = this.integrator.integrate(params.previousPoint, major)
    // 退化点停下
    if (nextDirection.lengthSq() < 0.01) {
      params.valid = false
      return
    }
    // 保持同一方向前进
    if (nextDirection.dot(params.previousDirection) < 0) nextDirection.negate()
    const nextPoint = params.previousPoint.clone().add(nextDirection)
    if (this.pointInBounds(nextPoint)
      && this.isValidSample(major, nextPoint, this.paramsSq.dtest, collideBoth)
      && !this.streamlineTurned(params.seed, params.originalDir, nextPoint, nextDirection)) {
      params.previousPoint = nextPoint
      params.previousDirection = nextDirection
    } else {
      // 再走一步
      params.streamline.push(nextPoint)
      params.valid = false
    }
  }

  /** 从种子向两头同时积分：首尾相接成环时两头的误差相等，环能闭上 */
  protected integrateStreamline(seed: Vector, major: boolean): Vector[] {
    let count = 0
    // 两头都离开 dcirclejoin 之后才开始判断成环
    let pointsEscaped = false
    const collideBoth = this.random() < this.params.collideEarly
    const d = this.integrator.integrate(seed, major)
    const forwardParams: StreamlineIntegration = {
      seed,
      originalDir: d,
      streamline: [seed],
      previousDirection: d,
      previousPoint: seed.clone().add(d),
      valid: true,
    }
    forwardParams.valid = this.pointInBounds(forwardParams.previousPoint)
    const negD = d.clone().negate()
    const backwardParams: StreamlineIntegration = {
      seed,
      originalDir: negD,
      streamline: [],
      previousDirection: negD,
      previousPoint: seed.clone().add(negD),
      valid: true,
    }
    backwardParams.valid = this.pointInBounds(backwardParams.previousPoint)
    while (count < this.params.pathIterations && (forwardParams.valid || backwardParams.valid)) {
      this.streamlineIntegrationStep(forwardParams, major, collideBoth)
      this.streamlineIntegrationStep(backwardParams, major, collideBoth)
      const sqDistanceBetweenPoints = forwardParams.previousPoint.distanceToSquared(backwardParams.previousPoint)
      if (!pointsEscaped && sqDistanceBetweenPoints > this.paramsSq.dcirclejoin) pointsEscaped = true
      if (pointsEscaped && sqDistanceBetweenPoints <= this.paramsSq.dcirclejoin) {
        forwardParams.streamline.push(forwardParams.previousPoint)
        forwardParams.streamline.push(backwardParams.previousPoint)
        backwardParams.streamline.push(backwardParams.previousPoint)
        break
      }
      count++
    }
    backwardParams.streamline.reverse().push(...forwardParams.streamline)
    return backwardParams.streamline
  }
}
