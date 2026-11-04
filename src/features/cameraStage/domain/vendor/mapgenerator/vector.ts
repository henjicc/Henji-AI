/*
 * 移植自 ProbableTrain/MapGenerator（https://github.com/ProbableTrain/MapGenerator，提交 f487e4cee321d105d5b0e14258363fa8b4d004ef）
 * 的 src/ts/vector.ts。按 LGPL-3.0-only 使用，许可全文见同目录 COPYING.LESSER 与 COPYING。
 *
 * 2026-11-04 痕迹AI 的修改：只保留路网生成用到的方法；去掉 loglevel 依赖（除零与零向量时原样返回）。
 */

export default class Vector {
  constructor(public x: number, public y: number) {}

  static zeroVector(): Vector {
    return new Vector(0, 0)
  }

  static fromScalar(s: number): Vector {
    return new Vector(s, s)
  }

  /** -pi 到 pi */
  static angleBetween(v1: Vector, v2: Vector): number {
    let angleBetween = v1.angle() - v2.angle()
    if (angleBetween > Math.PI) {
      angleBetween -= 2 * Math.PI
    } else if (angleBetween <= -Math.PI) {
      angleBetween += 2 * Math.PI
    }
    return angleBetween
  }

  add(v: Vector): Vector {
    this.x += v.x
    this.y += v.y
    return this
  }

  /** 与 +x 轴的夹角（弧度），-pi 到 pi */
  angle(): number {
    return Math.atan2(this.y, this.x)
  }

  clone(): Vector {
    return new Vector(this.x, this.y)
  }

  copy(v: Vector): Vector {
    this.x = v.x
    this.y = v.y
    return this
  }

  distanceTo(v: Vector): number {
    return Math.sqrt(this.distanceToSquared(v))
  }

  distanceToSquared(v: Vector): number {
    const dx = this.x - v.x
    const dy = this.y - v.y
    return dx * dx + dy * dy
  }

  divideScalar(s: number): Vector {
    if (s === 0) return this
    return this.multiplyScalar(1 / s)
  }

  dot(v: Vector): number {
    return this.x * v.x + this.y * v.y
  }

  equals(v: Vector): boolean {
    return v.x === this.x && v.y === this.y
  }

  length(): number {
    return Math.sqrt(this.lengthSq())
  }

  lengthSq(): number {
    return this.x * this.x + this.y * this.y
  }

  multiplyScalar(s: number): Vector {
    this.x *= s
    this.y *= s
    return this
  }

  negate(): Vector {
    return this.multiplyScalar(-1)
  }

  normalize(): Vector {
    const l = this.length()
    if (l === 0) return this
    return this.divideScalar(l)
  }

  setLength(length: number): Vector {
    return this.normalize().multiplyScalar(length)
  }

  sub(v: Vector): Vector {
    this.x -= v.x
    this.y -= v.y
    return this
  }
}
