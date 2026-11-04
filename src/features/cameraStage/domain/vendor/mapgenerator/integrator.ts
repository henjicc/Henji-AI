/*
 * 移植自 ProbableTrain/MapGenerator（https://github.com/ProbableTrain/MapGenerator，提交 f487e4cee321d105d5b0e14258363fa8b4d004ef）
 * 的 src/ts/impl/integrator.ts。按 LGPL-3.0-only 使用，许可全文见同目录 COPYING.LESSER 与 COPYING。
 *
 * 2026-11-04 痕迹AI 的修改：只保留原程序实际使用的四阶龙格-库塔积分器。
 */

import type TensorField from './tensor_field'
import Vector from './vector'

export default abstract class FieldIntegrator {
  constructor(protected field: TensorField) {}

  abstract integrate(point: Vector, major: boolean): Vector

  protected sampleFieldVector(point: Vector, major: boolean): Vector {
    const tensor = this.field.samplePoint(point)
    return major ? tensor.getMajor() : tensor.getMinor()
  }

  onLand(point: Vector): boolean {
    return this.field.onLand(point)
  }
}

export class RK4Integrator extends FieldIntegrator {
  constructor(field: TensorField, private dstep: number) {
    super(field)
  }

  integrate(point: Vector, major: boolean): Vector {
    const k1 = this.sampleFieldVector(point, major)
    const k23 = this.sampleFieldVector(point.clone().add(Vector.fromScalar(this.dstep / 2)), major)
    const k4 = this.sampleFieldVector(point.clone().add(Vector.fromScalar(this.dstep)), major)
    return k1.add(k23.multiplyScalar(4)).add(k4).multiplyScalar(this.dstep / 6)
  }
}
