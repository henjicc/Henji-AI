import { describe, expect, it } from 'vitest'
import { IMAGE_EDIT_LAYER_OPERATION_CATALOG_V3 } from '@/core/imageEdit/v3/operationCatalog'
import { createImageEditAdjustmentLayerV3, createImageEditDocumentV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { createBuiltInImageEditRenderNodeRegistry } from '@/core/imageEdit/v3/builtInRenderNodes'
import { compileImageEditRenderPlanV3 } from '@/core/imageEdit/v3/renderPlanCompiler'
import { executeImageEditCpuAdjustmentNodeV3 } from '@/core/imageEdit/v3/execution/cpuRenderPlanExecutor'
import { createFloat32PremultipliedRgbaTile } from '@/core/imageEdit/v3/effects'
import { compileImageEditorGpuRasterSceneV3 } from '@/features/imageEdit/v3/gpu/imageEditorGpuRasterSceneCompilerV3'
import type { ImageEditRenderPlanNode } from '@/core/imageEdit/v3/renderPlan'

const adjustments = IMAGE_EDIT_LAYER_OPERATION_CATALOG_V3.filter((entry) => entry.creatable && entry.layerType === 'adjustment')

function node(definitionId: string): ImageEditRenderPlanNode {
  return { id: 'adjustment', layerId: 'adjustment', layerPath: ['adjustment'], definitionId,
    definitionVersion: 1, category: 'pointwise', inputNodeIds: ['source'], parameters: {}, mask: null, subtreeHash: 'probe' }
}

function tile(): ReturnType<typeof createFloat32PremultipliedRgbaTile> {
  return createFloat32PremultipliedRgbaTile(1, 1, 'linear-light', new Float32Array([0.2, 0.1, 0.05, 1]))
}

describe('可创建调整层的 CPU/GPU 登记覆盖', () => {
  it.each(adjustments)('$operationId 能编译到登记节点，并在 CPU 和 GPU 明确处理', async (entry) => {
    const document = createImageEditDocumentV3({ width: 1, height: 1, documentId: 'registration' })
    const resourceRef = `sha256:${'1'.repeat(64)}` as const
    document.layers = [createImageEditRasterLayerV3('source', '原图', resourceRef),
      createImageEditAdjustmentLayerV3('adjustment', '调整', entry.operationId, {})]
    const plan = compileImageEditRenderPlanV3(document, createBuiltInImageEditRenderNodeRegistry(), 'stable')
    expect(plan.diagnostics).toEqual([])
    const adjustment = plan.nodes.find((value) => value.definitionId === entry.renderDefinitionId)
    expect(adjustment, `可创建的 ${entry.operationId} 没有映射到登记节点`).toBeDefined()
    if (!adjustment) throw new Error('缺少调整节点')
    await expect(executeImageEditCpuAdjustmentNodeV3(adjustment, tile(), undefined)).resolves.toMatchObject({ width: 1, height: 1 })
    const gpu = compileImageEditorGpuRasterSceneV3(document, [{ resourceRef, mediaType: 'image/png', byteLength: 4 }])
    expect(gpu.supported, 'reason' in gpu ? gpu.reason : '').toBe(true)
    if (gpu.supported) expect(gpu.scene.graph.some((value) => value.kind === 'adjustment'
      && value.adjustments.some((adjustmentNode) => adjustmentNode.definitionId === entry.renderDefinitionId))).toBe(true)
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
