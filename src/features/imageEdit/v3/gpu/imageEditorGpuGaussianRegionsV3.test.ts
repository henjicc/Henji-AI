import { expect, it } from 'vitest'
import { createImageEditDocumentV3, createImageEditEffectLayerV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3'
import { compileImageEditorGpuRasterSceneV3 } from './imageEditorGpuRasterSceneCompilerV3'
import { planImageEditorGpuGaussianRegionsV3 } from './imageEditorGpuGaussianRegionsV3'
import type { ImageEditorViewportLayoutV3 } from '../editor/useImageEditorViewportLayoutV3'

it.each(['stable', 'export'] as const)('%s：8K 串联高斯按完整网格反传 halo，局部窗口不改变计划', quality => {
  const ref = `sha256:${'a'.repeat(64)}` as const
  const document = createImageEditDocumentV3({ width: 7680, height: 4320 })
  document.layers = [createImageEditRasterLayerV3('source', '源', ref), createImageEditEffectLayerV3('one', '一', 'gaussian_blur', { sigma_fraction_height: .003 }), createImageEditEffectLayerV3('two', '二', 'gaussian_blur', { sigma_fraction_height: .03, axis: 'horizontal' })]
  const compiled = compileImageEditorGpuRasterSceneV3(document, [{ resourceRef: ref, byteLength: 7680 * 4320 * 4, mediaType: 'image/png' }], undefined, quality)
  if (!compiled.supported) throw new Error(compiled.reason)
  const layout: ImageEditorViewportLayoutV3 = { stageWidth: 512, stageHeight: 511, viewportKey: 'test', viewport: { documentX: 3147, documentY: 1811, width: 512, height: 511, zoom: 1, devicePixelRatio: 1 } }
  const local = planImageEditorGpuGaussianRegionsV3(compiled.scene, layout)
  const full = planImageEditorGpuGaussianRegionsV3(compiled.scene, { ...layout, viewport: { ...layout.viewport, documentX: 0, documentY: 0, width: 7680, height: 4320 } })
  const regions = [...local.effects.values()]
  expect(regions).toHaveLength(2)
  expect(regions[1].output).toEqual(regions[0].windows[0])
  expect(local.input.width).toBeLessThan(2200)
  expect(local.input.height).toBeLessThan(1500)
  for (const [id, region] of local.effects) expect(region.plan).toEqual(full.effects.get(id)?.plan)
  const explicitGrid = planImageEditorGpuGaussianRegionsV3(compiled.scene, { ...layout,
    viewport: { ...layout.viewport, documentX: 50, documentY: 60, zoom: .5 } }, [3840, 2159])
  expect(explicitGrid.outputSize).toEqual([3840, 2159])
  for (const region of explicitGrid.effects.values()) expect(region.plan.outputSize).toEqual({ width: 3840, height: 2159 })
})
