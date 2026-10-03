const assert = require('node:assert/strict')
const test = require('node:test')
const { estimatePatchDisplacement, patchTextureStdDev, selectFeaturePatch } = require('./uiInspectionCompositedMove.cjs')

/** 合成一张“图层”：渐变底上一个白色矩形，整层随 (rectX, rectY) 平移（模拟图层被拖动）。 */
function syntheticImage(width, height, rectX, rectY, rectSize = 24) {
  const data = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3
      const localX = x - rectX
      const localY = y - rectY
      const inside = localX >= 0 && localX < rectSize && localY >= 0 && localY < rectSize
      data[offset] = inside ? 245 : Math.max(0, Math.min(255, 120 + localX))
      data[offset + 1] = inside ? 248 : Math.max(0, Math.min(255, 120 + localY))
      data[offset + 2] = inside ? 255 : 90
    }
  }
  return { data, width, height, channels: 3 }
}

test('位移估计：找到与指针一致的平移，并证明画面确实移动了', () => {
  const before = syntheticImage(160, 120, 40, 50)
  const after = syntheticImage(160, 120, 47, 38)
  const patch = { x: 52, y: 62, width: 24, height: 24 }
  const estimate = estimatePatchDisplacement(before, after, patch, { x: 7, y: -12 }, 4)
  assert.deepEqual([estimate.dx, estimate.dy, estimate.error], [7, -12, 0])
  assert.ok(estimate.zeroError > 20)
})

test('位移估计：画面没跟随指针（DOM 动了但合成画面没动）时最佳位移偏离预期', () => {
  const still = syntheticImage(160, 120, 40, 50)
  const estimate = estimatePatchDisplacement(still, still, { x: 52, y: 62, width: 24, height: 24 }, { x: 7, y: -12 }, 4)
  assert.notDeepEqual([estimate.dx, estimate.dy], [7, -12])
  assert.equal(estimate.zeroError, 0)
})

test('特征块：选移动前后都在可见区域里的锚点；纹理强度拒绝平坦区域', () => {
  const box = { x: 100, y: 100, width: 400, height: 250 }
  const anchors = [{ x: 0.5, y: 0.1 }, { x: 0.4, y: 0.6 }]
  const selected = selectFeaturePatch({ anchorBox: box, visibleBox: box, anchors, delta: { x: 42, y: -100 } })
  assert.deepEqual(selected.anchor, { x: 0.4, y: 0.6 })
  assert.equal(selectFeaturePatch({ anchorBox: box, visibleBox: box, anchors, delta: { x: 0, y: -400 } }), null)
  const image = syntheticImage(160, 120, 40, 50)
  assert.ok(patchTextureStdDev(image, { x: 52, y: 62, width: 24, height: 24 }) > 12)
  const flat = { data: Buffer.alloc(40 * 40 * 3, 128), width: 40, height: 40, channels: 3 }
  assert.equal(patchTextureStdDev(flat, { x: 0, y: 0, width: 20, height: 20 }), 0)
})
