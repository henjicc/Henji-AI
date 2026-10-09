import { expect, it } from 'vitest'
import { createBuiltInImageEditRenderNodeRegistry } from '../builtInRenderNodes'
import { createImageEditAdjustmentLayerV3, createImageEditDocumentV3 } from '../documentFactory'
import { compileImageEditRenderPlanV3 } from '../renderPlanCompiler'
import { createFloat32MaskTile, createFloat32PremultipliedRgbaTile } from '../effects/contracts'
import { applyExposureAdjustment } from '../effects/exposure'
import { executeImageEditCpuAdjustmentNodeV3 } from './cpuRenderPlanExecutor'

it.each([0, .1, -4])('中性gamma曝光优化保留原Float32舍入、HDR、Alpha和蒙版：stops=%s', async stops => {
  const document = createImageEditDocumentV3({ width: 257, height: 1, sourceResourceId: 'sha256:source' })
  document.layers.push(createImageEditAdjustmentLayerV3('exposure', '曝光', 'exposure', { stops, offset: -.001, gamma: 1 }))
  const node = compileImageEditRenderPlanV3(document, createBuiltInImageEditRenderNodeRegistry(), 'export').nodes.find(entry => entry.definitionId === 'adjustment.exposure')!
  const data = new Float32Array(257 * 4)
  for (let index = 0; index < 257; index++) {
    const alpha = index % 256 / 255
    data.set([-.2 * alpha, 2 * alpha, index / 257 * alpha, alpha], index * 4)
  }
  const source = createFloat32PremultipliedRgbaTile(257, 1, 'linear-light', data)
  const mask = createFloat32MaskTile(257, 1, Float32Array.from({ length: 257 }, (_, index) => index % 3 / 2))
  for (const currentMask of [undefined, mask]) {
    const expected = applyExposureAdjustment(source, { stops, offset: -.001, gamma: 1 }, { mask: currentMask })
    expect((await executeImageEditCpuAdjustmentNodeV3(node, source, currentMask)).data).toEqual(expected.data)
  }
})
