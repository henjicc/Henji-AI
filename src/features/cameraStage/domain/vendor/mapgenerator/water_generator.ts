/*
 * 移植自 ProbableTrain/MapGenerator（https://github.com/ProbableTrain/MapGenerator，提交 f487e4cee321d105d5b0e14258363fa8b4d004ef）
 * 的 src/ts/impl/water_generator.ts。按 LGPL-3.0-only 使用，许可全文见同目录 COPYING.LESSER 与 COPYING。
 *
 * 2026-11-04 痕迹AI 的修改：
 * - 只移植河流（不做海岸线）；撒种随机数由调用方传入，种子可限定在范围中央；
 * - 折线缓冲区由 jsts 换成 clipper2-ts 的 inflatePathsD（圆角连接、平头端点）；
 * - 两岸沿河路不再用“范围被河流切开的较小一块”区分左右岸，改为把缓冲区外轮廓按范围内连续的顶点切成几段，
 *   每段是一条沿河路（效果相同，不需要 jsts 的多边形化）。
 */

import { EndType, JoinType, areaD, inflatePathsD, type PathD } from 'clipper2-ts'

import type FieldIntegrator from './integrator'
import StreamlineGenerator, { type StreamlineParams } from './streamlines'
import type TensorField from './tensor_field'
import Vector from './vector'

export interface NoiseStreamlineParams {
  noiseEnabled: boolean
  noiseSize: number
  /** 度 */
  noiseAngle: number
}

export interface WaterParams extends StreamlineParams {
  riverNoise: NoiseStreamlineParams
  /** 河岸宽：沿河路中心线到水面边缘的距离 */
  riverBankSize: number
  /** 河流中心线到沿河路中心线的距离 */
  riverSize: number
  /** 河流种子只在范围中央这一比例的方框里撒（0–1），河就从城中间穿过 */
  seedRegion: number
}

/** 积分出一条带噪声、两头都出范围的河流，再沿两岸各生成一条沿河路。 */
export default class WaterGenerator extends StreamlineGenerator {
  private readonly TRIES = 100
  private _river: Vector[] = []
  private _riverPolygon: Vector[] = []
  private _bankRoads: Vector[][] = []

  constructor(
    integrator: FieldIntegrator,
    origin: Vector,
    worldDimensions: Vector,
    protected params: WaterParams,
    private tensorField: TensorField,
    random: () => number,
  ) {
    super(integrator, origin, worldDimensions, params, random)
  }

  /** 河流中心线（加密到步长间隔） */
  get river(): Vector[] {
    return this._river
  }

  /** 水面 */
  get riverPolygon(): Vector[] {
    return this._riverPolygon
  }

  /** 沿河路（已简化），每条都在范围以内 */
  get bankRoads(): Vector[][] {
    return this._bankRoads
  }

  protected samplePoint(): Vector {
    const region = this.params.seedRegion
    const margin = (1 - region) / 2
    return new Vector(
      (margin + this.random() * region) * this.worldDimensions.x,
      (margin + this.random() * region) * this.worldDimensions.y,
    ).add(this.origin)
  }

  /** major 为河流沿张量场的哪个方向走；找不到两头都出范围的河流时返回 false，什么都不加。 */
  createRiver(major: boolean): boolean {
    let riverStreamline: Vector[] = []
    let found = false
    if (this.params.riverNoise.noiseEnabled) {
      this.tensorField.enableGlobalNoise(this.params.riverNoise.noiseAngle, this.params.riverNoise.noiseSize)
    }
    for (let i = 0; i < this.TRIES; i++) {
      const seed = this.getSeed(major)
      if (seed === null) break
      riverStreamline = this.extendStreamline(this.integrateStreamline(seed, major))
      if (this.reachesEdges(riverStreamline)) {
        found = true
        break
      }
    }
    this.tensorField.disableGlobalNoise()
    if (!found) return false

    this._river = riverStreamline
    const banks = this.buffer(riverStreamline, this.params.riverSize)
    this._riverPolygon = this.buffer(riverStreamline, this.params.riverSize - this.params.riverBankSize)
    // 两岸之间（含河岸）不让别的路进来
    this.tensorField.river = this.simplifyStreamline(banks)

    // 外轮廓从一个范围外的顶点开始，按范围内连续的顶点切段，每段一条沿河路
    const firstOffScreen = banks.findIndex(v => this.vectorOffScreen(v))
    const ring = firstOffScreen > 0 ? [...banks.slice(firstOffScreen), ...banks.slice(0, firstOffScreen)] : banks
    let run: Vector[] = []
    // 沿河路与河流同向，记进同一向的采样，后面同向的路与它保持间距
    const flush = (): void => {
      if (run.length > 5) this.addBankRoad(run, major)
      run = []
    }
    for (const v of ring) {
      if (this.vectorOffScreen(v)) flush()
      else run.push(v)
    }
    flush()
    return true
  }

  private addBankRoad(points: Vector[], major: boolean): void {
    const simple = this.simplifyStreamline(points)
    this._bankRoads.push(simple)
    const complex = this.complexifyStreamline(simple)
    this.grid(major).addPolyline(complex)
    this.streamlines(major).push(complex)
    this.allStreamlines.push(complex)
    this.allStreamlinesSimple.push(simple)
  }

  /** 折线向两侧各扩 distance 得到的闭合轮廓；河流自己绕回来时取面积最大的那一圈 */
  private buffer(line: readonly Vector[], distance: number): Vector[] {
    const outlines = inflatePathsD([line.map(v => ({ x: v.x, y: v.y }))], distance, JoinType.Round, EndType.Butt, 2, 3)
    let best: PathD = []
    let bestArea = 0
    for (const outline of outlines) {
      const size = Math.abs(areaD(outline))
      if (size > bestArea) {
        best = outline
        bestArea = size
      }
    }
    return best.map(point => new Vector(point.x, point.y))
  }

  /** 在折线上插点，使相邻两点不远于 dstep */
  private complexifyStreamline(s: readonly Vector[]): Vector[] {
    const out: Vector[] = []
    for (let i = 0; i < s.length - 1; i++) out.push(...this.complexifyStreamlineRecursive(s[i], s[i + 1]))
    return out
  }

  private complexifyStreamlineRecursive(v1: Vector, v2: Vector): Vector[] {
    if (v1.distanceToSquared(v2) <= this.paramsSq.dstep) return [v1, v2]
    const halfway = v1.clone().add(v2.clone().sub(v1).multiplyScalar(0.5))
    const complex = this.complexifyStreamlineRecursive(v1, halfway)
    complex.push(...this.complexifyStreamlineRecursive(halfway, v2))
    return complex
  }

  /** 两头各顺着端点方向延长 5 步 */
  private extendStreamline(streamline: Vector[]): Vector[] {
    if (streamline.length < 2) return streamline
    streamline.unshift(streamline[0].clone().add(streamline[0].clone().sub(streamline[1]).setLength(this.params.dstep * 5)))
    const last = streamline.length - 1
    streamline.push(streamline[last].clone().add(streamline[last].clone().sub(streamline[last - 1]).setLength(this.params.dstep * 5)))
    return streamline
  }

  private reachesEdges(streamline: readonly Vector[]): boolean {
    return streamline.length > 1 && this.vectorOffScreen(streamline[0]) && this.vectorOffScreen(streamline[streamline.length - 1])
  }

  private vectorOffScreen(v: Vector): boolean {
    const toOrigin = v.clone().sub(this.origin)
    return toOrigin.x <= 0 || toOrigin.y <= 0 || toOrigin.x >= this.worldDimensions.x || toOrigin.y >= this.worldDimensions.y
  }
}
