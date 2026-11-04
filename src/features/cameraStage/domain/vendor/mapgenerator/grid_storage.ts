/*
 * 移植自 ProbableTrain/MapGenerator（https://github.com/ProbableTrain/MapGenerator，提交 f487e4cee321d105d5b0e14258363fa8b4d004ef）
 * 的 src/ts/impl/grid_storage.ts。按 LGPL-3.0-only 使用，许可全文见同目录 COPYING.LESSER 与 COPYING。
 *
 * 2026-11-04 痕迹AI 的修改：去掉 loglevel，按本项目代码风格排版；逻辑不变。
 */

import Vector from './vector'

/** 均匀格子加速的采样点存储：每格一组点，按间距查附近有没有别的流线。 */
export default class GridStorage {
  private gridDimensions: Vector
  private grid: Vector[][][]
  private dsepSq: number

  constructor(private worldDimensions: Vector, private origin: Vector, private dsep: number) {
    this.dsepSq = this.dsep * this.dsep
    this.gridDimensions = worldDimensions.clone().divideScalar(this.dsep)
    this.grid = []
    for (let x = 0; x < this.gridDimensions.x; x++) {
      this.grid.push([])
      for (let y = 0; y < this.gridDimensions.y; y++) this.grid[x].push([])
    }
  }

  /** 把另一份存储的全部采样点加进来 */
  addAll(gridStorage: GridStorage): void {
    for (const row of gridStorage.grid) {
      for (const cell of row) {
        for (const sample of cell) this.addSample(sample)
      }
    }
  }

  addPolyline(line: readonly Vector[]): void {
    for (const v of line) this.addSample(v)
  }

  /** 不检查间距、不复制 */
  addSample(v: Vector, coords?: Vector): void {
    const cell = coords ?? this.getSampleCoords(v)
    this.grid[cell.x][cell.y].push(v)
  }

  /** v 离已有采样点是否都不近于 sqrt(dSq)。每个积分步都要调用，避免创建数组。 */
  isValidSample(v: Vector, dSq = this.dsepSq): boolean {
    const coords = this.getSampleCoords(v)
    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        const cell = coords.clone().add(new Vector(x, y))
        if (!this.vectorOutOfBounds(cell, this.gridDimensions)) {
          if (!this.vectorFarFromVectors(v, this.grid[cell.x][cell.y], dSq)) return false
        }
      }
    }
    return true
  }

  vectorFarFromVectors(v: Vector, vectors: readonly Vector[], dSq: number): boolean {
    for (const sample of vectors) {
      if (sample !== v && sample.distanceToSquared(v) < dSq) return false
    }
    return true
  }

  /** 返回 v 周围格子里的全部点（以方代圆的近似） */
  getNearbyPoints(v: Vector, distance: number): Vector[] {
    const radius = Math.ceil(distance / this.dsep - 0.5)
    const coords = this.getSampleCoords(v)
    const out: Vector[] = []
    for (let x = -1 * radius; x <= 1 * radius; x++) {
      for (let y = -1 * radius; y <= 1 * radius; y++) {
        const cell = coords.clone().add(new Vector(x, y))
        if (!this.vectorOutOfBounds(cell, this.gridDimensions)) {
          for (const v2 of this.grid[cell.x][cell.y]) out.push(v2)
        }
      }
    }
    return out
  }

  private worldToGrid(v: Vector): Vector {
    return v.clone().sub(this.origin)
  }

  private vectorOutOfBounds(gridV: Vector, bounds: Vector): boolean {
    return gridV.x < 0 || gridV.y < 0 || gridV.x >= bounds.x || gridV.y >= bounds.y
  }

  private getSampleCoords(worldV: Vector): Vector {
    const v = this.worldToGrid(worldV)
    if (this.vectorOutOfBounds(v, this.worldDimensions)) return Vector.zeroVector()
    return new Vector(Math.floor(v.x / this.dsep), Math.floor(v.y / this.dsep))
  }
}
