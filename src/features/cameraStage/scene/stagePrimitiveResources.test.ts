import { describe, expect, it } from 'vitest'
import { Color, Matrix4, Object3D } from 'three'
import { StagePrimitiveResources } from './stagePrimitiveResources'

function sourceAt(x: number): Object3D {
  const node = new Object3D()
  node.position.set(x, 0, 0)
  node.updateMatrixWorld(true)
  return node
}

function instanceX(resources: StagePrimitiveResources, index: number): number {
  const matrix = new Matrix4()
  resources.batchMesh('box')!.getMatrixAt(index, matrix)
  return matrix.elements[12]
}

describe('基础几何体合批', () => {
  it('增删物体时末位补洞、容量翻倍保留已有实例，渲染前按来源网格的世界矩阵落位', () => {
    const resources = new StagePrimitiveResources()
    const slots = Array.from({ length: 200 }, (_, i) => {
      const source = sourceAt(i)
      const slot = resources.acquireSlot('box', source, source)
      resources.setSlotColor(slot, i === 199 ? 'red' : 'lime')
      return slot
    })
    resources.flushSlots()
    const firstMesh = resources.batchMesh('box')!
    expect(firstMesh.count).toBe(200)
    expect(instanceX(resources, 150)).toBe(150)

    // 移走中间一个：最后一个物体搬进空位，矩阵与颜色跟着走
    resources.releaseSlot(slots[10])
    expect(slots[199].index).toBe(10)
    expect(resources.batchMesh('box')!.count).toBe(199)
    expect(instanceX(resources, 10)).toBe(199)
    const color = new Color()
    resources.batchMesh('box')!.getColorAt(10, color)
    expect(color.equals(new Color('red'))).toBe(true)

    // 合批期间场景的逐帧矩阵更新跳过它；播放改了变换只记脏，flush 时才重算并写进实例
    slots[5].source.position.x = 42
    slots[5].source.updateMatrixWorld(true)
    expect(slots[5].source.matrixWorld.elements[12]).toBe(5)
    resources.markSlotDirty(slots[5])
    expect(instanceX(resources, 5)).toBe(5)
    resources.flushSlots()
    expect(instanceX(resources, 5)).toBe(42)

    // 已移出的物体不会再写进别人的位置
    resources.markSlotDirty(slots[10])
    resources.setSlotColor(slots[10], 'blue')
    resources.flushSlots()
    expect(instanceX(resources, 10)).toBe(199)

    // 移出合批（如被选中）后恢复逐帧更新，gizmo 拖动才能生效
    slots[5].source.position.x = 7
    slots[5].source.updateMatrixWorld(true)
    expect(slots[5].source.matrixWorld.elements[12]).toBe(42)
    resources.releaseSlot(slots[5])
    slots[5].source.updateMatrixWorld(true)
    expect(slots[5].source.matrixWorld.elements[12]).toBe(7)

    for (const slot of slots) resources.releaseSlot(slot)
    expect(resources.batchMesh('box')!.count).toBe(0)
    expect(resources.batchMesh('box')!.visible).toBe(false)
    resources.dispose()
  })

  it('缩放过零的镜像物体换进镜像批次，批次网格叠回实例后仍是物体的世界矩阵，颜色随行', () => {
    const resources = new StagePrimitiveResources()
    const source = sourceAt(3)
    const slot = resources.acquireSlot('box', source, source)
    resources.setSlotColor(slot, 'red')
    resources.flushSlots()
    expect(resources.batchMesh('box')!.count).toBe(1)

    source.scale.set(-2, 1, 1)
    resources.markSlotDirty(slot)
    resources.flushSlots()
    const mirroredMesh = resources.batchMesh('box', true)!
    expect(resources.batchMesh('box')!.count).toBe(0)
    expect(mirroredMesh.count).toBe(1)
    // three 按网格自身世界矩阵的行列式翻转正反面；flush 发生在场景矩阵更新之后，新批次当帧就得是镜像
    expect(mirroredMesh.matrixWorld.determinant()).toBeLessThan(0)
    const instance = new Matrix4()
    mirroredMesh.getMatrixAt(0, instance)
    const world = new Matrix4().multiplyMatrices(mirroredMesh.matrixWorld, instance)
    expect(world.equals(source.matrixWorld)).toBe(true)
    const color = new Color()
    mirroredMesh.getColorAt(0, color)
    expect(color.equals(new Color('red'))).toBe(true)

    source.scale.set(1, 1, 1)
    resources.markSlotDirty(slot)
    resources.flushSlots()
    expect(mirroredMesh.count).toBe(0)
    expect(resources.batchMesh('box')!.count).toBe(1)
    resources.dispose()
  })
})
