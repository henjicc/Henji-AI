/*
 * 移植自 ProbableTrain/MapGenerator（https://github.com/ProbableTrain/MapGenerator，提交 f487e4cee321d105d5b0e14258363fa8b4d004ef）
 * 的 src/ts/impl/basis_field.ts。按 LGPL-3.0-only 使用，许可全文见同目录 COPYING.LESSER 与 COPYING。
 *
 * 2026-11-04 痕迹AI 的修改：去掉 dat.GUI 面板与拖动编辑，只保留方格场与放射场的取值。
 */

import Tensor from './tensor'
import Vector from './vector'

/** 方格场或放射场，叠加成整个张量场。 */
export abstract class BasisField {
  protected readonly centre: Vector

  constructor(centre: Vector, protected size: number, protected decay: number) {
    this.centre = centre.clone()
  }

  abstract getTensor(point: Vector): Tensor

  getWeightedTensor(point: Vector, smooth: boolean): Tensor {
    return this.getTensor(point).scale(this.getTensorWeight(point, smooth))
  }

  /** 权重随离中心的距离衰减：(1 - d/size)^decay */
  protected getTensorWeight(point: Vector, smooth: boolean): number {
    const normDistanceToCentre = point.clone().sub(this.centre).length() / this.size
    if (smooth) return normDistanceToCentre ** -this.decay
    // decay 为 0 时不让 (1 - d)^0 恒为 1 而铺满整个范围
    if (this.decay === 0 && normDistanceToCentre >= 1) return 0
    return Math.max(0, 1 - normDistanceToCentre) ** this.decay
  }
}

export class Grid extends BasisField {
  constructor(centre: Vector, size: number, decay: number, private theta: number) {
    super(centre, size, decay)
  }

  getTensor(): Tensor {
    return new Tensor(1, [Math.cos(2 * this.theta), Math.sin(2 * this.theta)])
  }
}

export class Radial extends BasisField {
  getTensor(point: Vector): Tensor {
    const t = point.clone().sub(this.centre)
    return new Tensor(1, [t.y ** 2 - t.x ** 2, -2 * t.x * t.y])
  }
}
