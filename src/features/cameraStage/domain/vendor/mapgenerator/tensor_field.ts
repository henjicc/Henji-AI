/*
 * 移植自 ProbableTrain/MapGenerator（https://github.com/ProbableTrain/MapGenerator，提交 f487e4cee321d105d5b0e14258363fa8b4d004ef）
 * 的 src/ts/impl/tensor_field.ts。按 LGPL-3.0-only 使用，许可全文见同目录 COPYING.LESSER 与 COPYING。
 *
 * 2026-11-04 痕迹AI 的修改：噪声改用 simplex-noise 4 的 createNoise2D，并由调用方传入种子随机数（原为不可复现的
 * Math.random）；去掉海岸线以外不用的接口与 loglevel。
 */

import { createNoise2D, type NoiseFunction2D } from 'simplex-noise'

import { Grid, Radial, type BasisField } from './basis_field'
import { insidePolygon } from './polygon_util'
import Tensor from './tensor'
import Vector from './vector'

export interface NoiseParams {
  globalNoise: boolean
  noiseSizePark: number
  /** 度 */
  noiseAnglePark: number
  noiseSizeGlobal: number
  /** 度 */
  noiseAngleGlobal: number
}

/** 叠加各基础场；落在公园里或打开全局噪声时再加旋转噪声。 */
export default class TensorField {
  private basisFields: BasisField[] = []
  private noise: NoiseFunction2D

  parks: Vector[][] = []
  sea: Vector[] = []
  river: Vector[] = []
  ignoreRiver = false
  smooth = false

  constructor(public noiseParams: NoiseParams, random: () => number) {
    this.noise = createNoise2D(random)
  }

  /** 积分河流时用 */
  enableGlobalNoise(angle: number, size: number): void {
    this.noiseParams.globalNoise = true
    this.noiseParams.noiseAngleGlobal = angle
    this.noiseParams.noiseSizeGlobal = size
  }

  disableGlobalNoise(): void {
    this.noiseParams.globalNoise = false
  }

  addGrid(centre: Vector, size: number, decay: number, theta: number): void {
    this.basisFields.push(new Grid(centre, size, decay, theta))
  }

  addRadial(centre: Vector, size: number, decay: number): void {
    this.basisFields.push(new Radial(centre, size, decay))
  }

  samplePoint(point: Vector): Tensor {
    if (!this.onLand(point)) return Tensor.zero
    // 没有基础场时整片是方格
    if (this.basisFields.length === 0) return new Tensor(1, [0, 0])
    const tensorAcc = Tensor.zero
    this.basisFields.forEach(field => tensorAcc.add(field.getWeightedTensor(point, this.smooth), this.smooth))
    // 公园里加 -pi/2 到 pi/2 的旋转噪声
    if (this.parks.some(p => insidePolygon(point, p))) {
      tensorAcc.rotate(this.getRotationalNoise(point, this.noiseParams.noiseSizePark, this.noiseParams.noiseAnglePark))
    }
    if (this.noiseParams.globalNoise) {
      tensorAcc.rotate(this.getRotationalNoise(point, this.noiseParams.noiseSizeGlobal, this.noiseParams.noiseAngleGlobal))
    }
    return tensorAcc
  }

  /** noiseAngle 为度 */
  getRotationalNoise(point: Vector, noiseSize: number, noiseAngle: number): number {
    return this.noise(point.x / noiseSize, point.y / noiseSize) * noiseAngle * Math.PI / 180
  }

  onLand(point: Vector): boolean {
    const inSea = insidePolygon(point, this.sea)
    if (this.ignoreRiver) return !inSea
    return !inSea && !insidePolygon(point, this.river)
  }

  inParks(point: Vector): boolean {
    return this.parks.some(p => insidePolygon(point, p))
  }
}
