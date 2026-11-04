/*
 * 移植自 ProbableTrain/MapGenerator（https://github.com/ProbableTrain/MapGenerator，提交 f487e4cee321d105d5b0e14258363fa8b4d004ef）
 * 的 src/ts/impl/tensor.ts。按 LGPL-3.0-only 使用，许可全文见同目录 COPYING.LESSER 与 COPYING。
 *
 * 2026-11-04 痕迹AI 的修改：只保留路网生成用到的方法，按本项目代码风格排版。
 */

import Vector from './vector'

/** 二阶对称无迹张量：主方向与次方向分别是主干道与支路走向。矩阵只存 [cos 2θ, sin 2θ] 两个分量。 */
export default class Tensor {
  private oldTheta = false
  private _theta: number

  constructor(private r: number, private matrix: number[]) {
    this._theta = this.calculateTheta()
  }

  static get zero(): Tensor {
    return new Tensor(0, [0, 0])
  }

  get theta(): number {
    if (this.oldTheta) {
      this._theta = this.calculateTheta()
      this.oldTheta = false
    }
    return this._theta
  }

  add(tensor: Tensor, smooth: boolean): Tensor {
    this.matrix = this.matrix.map((v, i) => v * this.r + tensor.matrix[i] * tensor.r)
    if (smooth) {
      this.r = Math.hypot(...this.matrix)
      this.matrix = this.matrix.map(v => v / this.r)
    } else {
      this.r = 2
    }
    this.oldTheta = true
    return this
  }

  scale(s: number): Tensor {
    this.r *= s
    this.oldTheta = true
    return this
  }

  /** 弧度 */
  rotate(theta: number): Tensor {
    if (theta === 0) return this
    let newTheta = this.theta + theta
    if (newTheta < Math.PI) newTheta += Math.PI
    if (newTheta >= Math.PI) newTheta -= Math.PI
    this.matrix[0] = Math.cos(2 * newTheta) * this.r
    this.matrix[1] = Math.sin(2 * newTheta) * this.r
    this._theta = newTheta
    return this
  }

  getMajor(): Vector {
    if (this.r === 0) return Vector.zeroVector()
    return new Vector(Math.cos(this.theta), Math.sin(this.theta))
  }

  getMinor(): Vector {
    if (this.r === 0) return Vector.zeroVector()
    const angle = this.theta + Math.PI / 2
    return new Vector(Math.cos(angle), Math.sin(angle))
  }

  private calculateTheta(): number {
    if (this.r === 0) return 0
    return Math.atan2(this.matrix[1] / this.r, this.matrix[0] / this.r) / 2
  }
}
