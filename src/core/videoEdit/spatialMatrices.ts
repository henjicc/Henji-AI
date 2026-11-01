// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- Electron 工程按导入闭包编译，需要带入冻结 npm 别名的 ambient 声明。
/// <reference path="./spatialThree.d.ts" />
import { Matrix4, Vector3, Vector4 } from 'henji-author-three-0.186.1'
import type { SpatialMat4, SpatialVec3 } from './spatialTypes'

/** 此模块只在空间求值入口加载；three 实例不跨越领域边界。 */
function array(matrix: Matrix4): SpatialMat4 { return matrix.elements.slice() as unknown as SpatialMat4 }
export function spatialIdentityMatrix(): SpatialMat4 { return array(new Matrix4()) }
export function spatialMultiply(...matrices: readonly SpatialMat4[]): SpatialMat4 {
  const result = new Matrix4()
  for (const matrix of matrices) result.multiply(new Matrix4().fromArray(matrix))
  return array(result)
}
export function spatialTranslation(x: number, y: number, z: number): SpatialMat4 { return array(new Matrix4().makeTranslation(x, y, z)) }
export function spatialScale(x: number, y: number, z: number): SpatialMat4 { return array(new Matrix4().makeScale(x, y, z)) }
export function spatialRotation(x: number, y: number, clockwiseZ: number): SpatialMat4 {
  const degrees = Math.PI / 180
  return array(new Matrix4().makeRotationZ(-clockwiseZ * degrees).multiply(new Matrix4().makeRotationY(y * degrees)).multiply(new Matrix4().makeRotationX(x * degrees)))
}
export function spatialTransform(matrix: SpatialMat4, point: SpatialVec3): SpatialVec3 {
  return new Vector3(...point).applyMatrix4(new Matrix4().fromArray(matrix)).toArray() as SpatialVec3
}
export function spatialHomogeneous(matrix: SpatialMat4, point: SpatialVec3): readonly [number, number, number, number] {
  return new Vector4(...point, 1).applyMatrix4(new Matrix4().fromArray(matrix)).toArray() as [number, number, number, number]
}
export function spatialInverse(matrix: SpatialMat4): SpatialMat4 {
  const value = new Matrix4().fromArray(matrix)
  if (value.determinant() === 0) throw new Error('空间矩阵不可逆。')
  return array(value.invert())
}
export function spatialView(position: SpatialVec3, target: SpatialVec3, rotation: SpatialVec3 = [0, 0, 0]): { view: SpatialMat4; up: SpatialVec3 } {
  const eye = new Vector3(...position); const center = new Vector3(...target)
  const direction = center.clone().sub(eye)
  if (direction.lengthSq() === 0) throw new Error('相机与瞄准目标重合，无法确定视向。')
  direction.normalize()
  let up = new Vector3(0, 1, 0)
  if (Math.abs(direction.dot(up)) === 1) {
    up = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)].sort((a, b) => Math.abs(direction.dot(a)) - Math.abs(direction.dot(b)))[0]
  }
  const world = new Matrix4().lookAt(eye, center, up).multiply(new Matrix4().fromArray(spatialRotation(...rotation))).setPosition(eye)
  return { view: array(world.clone().invert()), up: new Vector3(0, 1, 0).transformDirection(world).toArray() as SpatialVec3 }
}
export function spatialProjection(aspect: number, distance: number, near: number, far: number, webGpu: boolean): SpatialMat4 {
  const top = near * .5 / distance
  // r186 的坐标系统常量：WebGPU=2001，WebGL=2000。
  return array(new Matrix4().makePerspective(-top * aspect, top * aspect, top, -top, near, far, webGpu ? 2001 : 2000))
}
