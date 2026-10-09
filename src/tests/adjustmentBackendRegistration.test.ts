import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { GAUSSIAN_EFFECT } from '@/core/imaging/effects/gaussian'
import { registerImageEditSharedEffectV3 } from '@/core/imageEdit/v3/builtInRenderNodes'
import { listImageEditCpuNodeIdsV3, executeImageEditCpuEffectNodeV3 } from '@/core/imageEdit/v3/execution/cpuRenderPlanExecutor'
import { imageEditorGpuGraphAdjustmentValuesV3 } from '@/features/imageEdit/v3/gpu/imageEditorGpuGraphUniformsV3'
import { listImageEditLayerOperationsV3, createImageEditOperationParametersV3 } from '@/core/imageEdit/v3/operationCatalog'
import { createImageEditEffectLayerV3, createImageEditAdjustmentLayerV3, createImageEditDocumentV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { createBuiltInImageEditRenderNodeRegistry } from '@/core/imageEdit/v3/builtInRenderNodes'
import { compileImageEditRenderPlanV3 } from '@/core/imageEdit/v3/renderPlanCompiler'
import { executeImageEditCpuAdjustmentNodeV3 } from '@/core/imageEdit/v3/execution/cpuRenderPlanExecutor'
import { createFloat32PremultipliedRgbaTile } from '@/core/imageEdit/v3/effects'
import { compileImageEditorGpuRasterSceneV3 } from '@/features/imageEdit/v3/gpu/imageEditorGpuRasterSceneCompilerV3'
import type { ImageEditRenderPlanNode } from '@/core/imageEdit/v3/renderPlan'

const operations = listImageEditLayerOperationsV3().filter(entry => entry.creatable)

function node(definitionId: string): ImageEditRenderPlanNode {
  return { id: 'adjustment', layerId: 'adjustment', layerPath: ['adjustment'], definitionId,
    definitionVersion: 1, category: 'pointwise', inputNodeIds: ['source'], parameters: {}, mask: null, subtreeHash: 'probe' }
}

function tile(): ReturnType<typeof createFloat32PremultipliedRgbaTile> {
  return createFloat32PremultipliedRgbaTile(1, 1, 'linear-light', new Float32Array([0.2, 0.1, 0.05, 1]))
}

describe('可创建调整层的 CPU/GPU 登记覆盖', () => {
  it.each(operations)('$operationId 能编译到登记节点，并在 CPU 和 GPU 明确处理', async (entry) => {
    const document = createImageEditDocumentV3({ width: 1, height: 1, documentId: 'registration' })
    const resourceRef = `sha256:${'1'.repeat(64)}` as const
    document.layers = [createImageEditRasterLayerV3('source', '原图', resourceRef),
      (entry.layerType === 'adjustment' ? createImageEditAdjustmentLayerV3 : createImageEditEffectLayerV3)('adjustment', '调整', entry.operationId, createImageEditOperationParametersV3(entry.operationId))]
    const plan = compileImageEditRenderPlanV3(document, createBuiltInImageEditRenderNodeRegistry(), 'stable')
    expect(plan.diagnostics).toEqual([])
    const adjustment = plan.nodes.find((value) => value.definitionId === entry.renderDefinitionId)
    expect(adjustment, `可创建的 ${entry.operationId} 没有映射到登记节点`).toBeDefined()
    if (!adjustment) throw new Error('缺少调整节点')
    const definition = createBuiltInImageEditRenderNodeRegistry().get(entry.renderDefinitionId)!
    expect(listImageEditCpuNodeIdsV3().has(entry.renderDefinitionId)).toBe(!!definition.cpu)
    expect(definition.backends.includes('cpu-libvips')).toBe(!!definition.cpu)
    expect(definition.backends.includes('webgpu')).toBe(!!definition.gpu)
    await expect(entry.layerType === 'adjustment' ? executeImageEditCpuAdjustmentNodeV3(adjustment, tile(), undefined) : executeImageEditCpuEffectNodeV3(adjustment, tile(), undefined, {})).resolves.toMatchObject({ width: 1, height: 1 })
    const gpu = compileImageEditorGpuRasterSceneV3(document, [{ resourceRef, mediaType: 'image/png', byteLength: 4 }])
    expect(gpu.supported, 'reason' in gpu ? gpu.reason : '').toBe(true)
    if (gpu.supported) expect(gpu.scene.graph.some(value => value.kind === 'effect' ? value.definitionId === entry.renderDefinitionId : value.kind === 'adjustment' && value.adjustments.some(item => item.definitionId === entry.renderDefinitionId))).toBe(true)
  })

  it('未登记的 CPU 调整必须明确失败，不能落到默认 HSL 分支', async () => {
    await expect(executeImageEditCpuAdjustmentNodeV3(node('adjustment.unregistered-probe'), tile(), undefined)).rejects.toThrow()
  })

  it('未登记的 GPU 调整必须明确失败', () => {
    const document = createImageEditDocumentV3({ width: 1, height: 1, documentId: 'unknown-registration' })
    const resourceRef = `sha256:${'1'.repeat(64)}` as const
    document.layers = [createImageEditRasterLayerV3('source', '原图', resourceRef),
      createImageEditAdjustmentLayerV3('unknown', '未知调整', 'unregistered-probe', {})]
    const gpu = compileImageEditorGpuRasterSceneV3(document, [{ resourceRef, mediaType: 'image/png', byteLength: 4 }])
    expect(gpu.supported).toBe(false)
    if (!gpu.supported) expect(gpu.reason.length).toBeGreaterThan(0)
  })
})

it('临时共享探针由一处登记派生创建/执行/后端拒绝，卸载后不残留', async () => {
  const release = registerImageEditSharedEffectV3({ ...GAUSSIAN_EFFECT, id: 'registration_probe',
    hosts: ['image'], parameterSchema: z.object({ gain: z.number().default(2) }).strict(), parameters: [],
    resolve: value => value,
  }, { cpu: (node, source) => createFloat32PremultipliedRgbaTile(source.width, source.height,
    'linear-light', Float32Array.from(source.data, value => value * Number(node.parameters.gain))),
    estimateBytes: () => 16 })
  try {
    const entry = listImageEditLayerOperationsV3().find(value => value.operationId === 'registration_probe')!
    expect(entry.creatable).toBe(true)
    const document = createImageEditDocumentV3({ width: 1, height: 1, documentId: 'probe' })
    const resourceRef = `sha256:${'1'.repeat(64)}` as const
    document.layers = [createImageEditRasterLayerV3('source', '源', resourceRef), createImageEditEffectLayerV3('probe', '探针', entry.operationId, {})]
    const registry = createBuiltInImageEditRenderNodeRegistry()
    expect(registry.get(entry.renderDefinitionId)?.backends).toEqual(['cpu-libvips'])
    const plan = compileImageEditRenderPlanV3(document, registry, 'export')
    const effect = plan.nodes.find(value => value.definitionId === entry.renderDefinitionId)!
    const result = await executeImageEditCpuEffectNodeV3(effect, tile(), undefined, {})
    expect(result.data[0]).toBeCloseTo(.4)
    const gpu = compileImageEditorGpuRasterSceneV3(document, [{ resourceRef, mediaType: 'image/png', byteLength: 4 }])
    expect(gpu).toMatchObject({ supported: false, reason: expect.stringContaining('GPU') })
  } finally { release() }
  expect(listImageEditLayerOperationsV3().some(value => value.operationId === 'registration_probe')).toBe(false)
  expect(createBuiltInImageEditRenderNodeRegistry().get('effect.registration_probe')).toBeNull()
  expect(listImageEditCpuNodeIdsV3().has('effect.registration_probe')).toBe(false)
})

it('未知 uniform 不会默认按 HSL 打包', () => {
  expect(() => imageEditorGpuGraphAdjustmentValuesV3({ kind: 'adjustment', nodeId: 'probe', layerId: 'probe', fingerprint: 'probe', inputNodeId: 'source',
    adjustments: [{ definitionId: 'adjustment.probe', parameters: {}, opacity: 1, blendMode: 'normal', mask: null }] })).toThrow(/不支持/)
})
