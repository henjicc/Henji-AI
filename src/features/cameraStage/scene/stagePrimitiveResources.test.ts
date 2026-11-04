import { describe, expect, it } from 'vitest'
import { Box3, BoxGeometry, Color, Matrix4, Mesh, Object3D, Raycaster, Vector3 } from 'three'
import { StagePrimitiveResources } from './stagePrimitiveResources'

const ORIGIN = { x: 0, y: 0, z: 0 }
const UNIT = { x: 1, y: 1, z: 1 }

function instanceX(resources: StagePrimitiveResources, index: number): number {
  const matrix = new Matrix4()
  resources.batchMesh('box')!.getMatrixAt(index, matrix)
  return matrix.elements[12]
}

describe('基础几何体合批', () => {
  it('增删物体时末位补洞、容量翻倍保留已有实例，变换只在渲染前落进实例', () => {
    const resources = new StagePrimitiveResources()
    const slots = Array.from({ length: 200 }, (_, i) => {
      const slot = resources.acquireSlot(`box-${i}`, 'box', i === 199 ? 'red' : 'lime')
      resources.setSlotTransform(slot, { position: { x: i, y: 0, z: 0 }, rotation: ORIGIN, scale: UNIT })
      return slot
    })
    resources.flushSlots()
    expect(resources.batchMesh('box')!.count).toBe(200)
    expect(instanceX(resources, 150)).toBe(150)

    // 移走中间一个：最后一个物体搬进空位，矩阵、颜色与点选反查都跟着走
    resources.releaseSlot(slots[10])
    expect(slots[199].index).toBe(10)
    expect(resources.batchMesh('box')!.count).toBe(199)
    expect(instanceX(resources, 10)).toBe(199)
    const color = new Color()
    resources.batchMesh('box')!.getColorAt(10, color)
    expect(color.equals(new Color('red'))).toBe(true)
    expect(resources.objectIdAt(resources.batchMesh('box')!, 10)).toBe('box-199')
    expect(resources.slot('box-10')).toBeUndefined()

    // 播放写入只记脏，flush 时才写进实例
    resources.setSlotTransform(slots[5], { position: { x: 42, y: 0, z: 0 } })
    expect(instanceX(resources, 5)).toBe(5)
    resources.flushSlots()
    expect(instanceX(resources, 5)).toBe(42)

    // 已移出的物体不会再写进别人的位置
    resources.setSlotTransform(slots[10], { position: { x: -1, y: 0, z: 0 } })
    resources.setSlotColor(slots[10], 'blue')
    resources.flushSlots()
    expect(instanceX(resources, 10)).toBe(199)

    for (const slot of slots) resources.releaseSlot(slot)
    expect(resources.batchMesh('box')!.count).toBe(0)
    expect(resources.batchMesh('box')!.visible).toBe(false)
    resources.dispose()
  })

  it('实例矩阵与包围盒等同于一个按同样变换摆放的网格，点选按实例反查物体', () => {
    const resources = new StagePrimitiveResources()
    const transform = { position: { x: 3, y: 1, z: -2 }, rotation: { x: 10, y: 35, z: -20 }, scale: { x: 2, y: 0.5, z: 1.5 } }
    const slot = resources.acquireSlot('a', 'box', 'lime')
    resources.setSlotTransform(slot, transform)
    resources.flushSlots()

    const reference = new Mesh(new BoxGeometry(1, 1, 1))
    reference.position.set(3, 1, -2)
    reference.rotation.set(10 * Math.PI / 180, 35 * Math.PI / 180, -20 * Math.PI / 180)
    reference.scale.set(2, 0.5, 1.5)
    reference.updateMatrixWorld(true)
    const instance = new Matrix4()
    resources.batchMesh('box')!.getMatrixAt(0, instance)
    // 实例数组是单精度
    expect(instance.equals(new Matrix4().fromArray(Float32Array.from(reference.matrixWorld.elements)))).toBe(true)
    expect(resources.slotBounds(slot, new Box3()).equals(new Box3().setFromObject(reference))).toBe(true)

    // 移动后点选用的包围球按新位置重算
    const root = new Object3D()
    root.add(resources.batchRoot)
    root.updateMatrixWorld(true)
    const raycaster = new Raycaster(new Vector3(3, 10, -2), new Vector3(0, -1, 0))
    const hitAt = (): string | undefined => {
      const hit = raycaster.intersectObject(resources.batchRoot, true)[0]
      return hit ? resources.objectIdAt(hit.object, hit.instanceId) : undefined
    }
    expect(hitAt()).toBe('a')
    resources.setSlotTransform(slot, { position: { x: 30, y: 1, z: -2 } })
    resources.flushSlots()
    expect(hitAt()).toBeUndefined()
    raycaster.ray.origin.set(30, 10, -2)
    expect(hitAt()).toBe('a')
    resources.dispose()
  })

  it('缩放过零的镜像物体换进镜像批次，批次网格叠回实例后仍是物体的世界矩阵，颜色随行', () => {
    const resources = new StagePrimitiveResources()
    const slot = resources.acquireSlot('m', 'box', 'red')
    resources.setSlotTransform(slot, { position: { x: 3, y: 0, z: 0 }, rotation: ORIGIN, scale: UNIT })
    resources.flushSlots()
    expect(resources.batchMesh('box')!.count).toBe(1)

    resources.setSlotTransform(slot, { scale: { x: -2, y: 1, z: 1 } })
    resources.flushSlots()
    const mirroredMesh = resources.batchMesh('box', true)!
    expect(resources.batchMesh('box')!.count).toBe(0)
    expect(mirroredMesh.count).toBe(1)
    // three 按网格自身世界矩阵的行列式翻转正反面；flush 发生在场景矩阵更新之后，新批次当帧就得是镜像
    expect(mirroredMesh.matrixWorld.determinant()).toBeLessThan(0)
    const instance = new Matrix4()
    mirroredMesh.getMatrixAt(0, instance)
    const world = new Matrix4().multiplyMatrices(mirroredMesh.matrixWorld, instance)
    expect(world.equals(new Matrix4().makeScale(-2, 1, 1).setPosition(3, 0, 0))).toBe(true)
    const color = new Color()
    mirroredMesh.getColorAt(0, color)
    expect(color.equals(new Color('red'))).toBe(true)

    resources.setSlotTransform(slot, { scale: UNIT })
    resources.flushSlots()
    expect(mirroredMesh.count).toBe(0)
    expect(resources.batchMesh('box')!.count).toBe(1)
    resources.dispose()
  })
})
