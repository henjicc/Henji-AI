import { afterEach, describe, expect, it } from 'vitest'
import { catalog } from '@henjicc/ai-sdk'
import { composeModelDefinition } from '@/core/composeModelDefinition'
import { registry } from '@/core/ModelRegistry'
import { falPresentation } from '@/models/presentation/fal'
import { mapCanvasNodeMediaReferences as rendererMap, resolveCanvasNodeMediaSchema } from '@/features/canvas/application/canvasNodeMediaReferences'
import { resolveCanvasMediaSchema } from '../../../electron/main/services/canvas-media-schema'
import { mapCanvasNodeMediaReferences } from './nodeMediaReferences'
import { parseCanvasDocumentGraph } from './canvasDocumentGraph'
import { derivedMediaStateKey } from '../params/derivedMediaStateKey'

const modelId = 'fal-ai-gpt-image-2'
const parameterId = 'falGptImage2MaskUrl'
const stateKey = derivedMediaStateKey(parameterId)
afterEach(() => registry.unregister(modelId))

describe('渲染层与主进程共用媒体引用字段规则', () => {
  it('真实SDK目录没有应用派生创作标志时，仍与应用schema映射相同sourceRef', () => {
    const runtime = catalog.find((model) => model.meta.id === modelId)!
    const applicationModel = composeModelDefinition(runtime, falPresentation[modelId])
    registry.register(applicationModel)
    expect(applicationModel.params.find((param) => param.id === parameterId)).toHaveProperty('derivedMediaAuthoring')
    expect(resolveCanvasMediaSchema(modelId)?.find((param) => param.id === parameterId))
      .not.toHaveProperty('derivedMediaAuthoring')
    const data = { modelId, prompt: '__img_ref__:999', params: {
      [parameterId]: '__img_ref__:0', [stateKey]: { sourceRef: '__img_ref__:0' },
    } }
    const mapValue = (value: string) => value === '__img_ref__:0' ? '/photo.png' : value
    const mainMapped = mapCanvasNodeMediaReferences(data, mapValue, resolveCanvasMediaSchema)
    expect(rendererMap(data, mapValue)).toEqual(mainMapped)
    expect(mainMapped).toMatchObject({ prompt: '__img_ref__:999', params: {
      [parameterId]: '/photo.png', [stateKey]: { sourceRef: '/photo.png' },
    } })
    const content = { nodes: [{ id: 'n', type: 'generator', position: { x: 0, y: 0 }, data }], edges: [], imagePool: ['/photo.png'] }
    expect(() => parseCanvasDocumentGraph(content, resolveCanvasMediaSchema)).not.toThrow()
    expect(() => parseCanvasDocumentGraph(content, resolveCanvasNodeMediaSchema)).not.toThrow()
    const invalid = JSON.parse(JSON.stringify(content).replaceAll('__img_ref__:0', '__img_ref__:1')) as typeof content
    expect(() => parseCanvasDocumentGraph(invalid, resolveCanvasMediaSchema)).toThrow()
    expect(() => parseCanvasDocumentGraph(invalid, resolveCanvasNodeMediaSchema)).toThrow()
  })

  it('下线模型在两端均保留不透明参数与媒体池，不把缺少schema当成工程损坏', () => {
    const content = { nodes: [{ id: 'n', type: 'generator', position: { x: 0, y: 0 },
      data: { modelId: 'unknown', params: { image: '__img_ref__:0' } } }], edges: [], imagePool: ['/photo.png'] }
    const main = parseCanvasDocumentGraph(content, resolveCanvasMediaSchema)
    const renderer = parseCanvasDocumentGraph(content, resolveCanvasNodeMediaSchema)
    expect(renderer).toEqual(main)
    expect(main.nodes[0].data).toEqual({ modelId: 'unknown', params: { image: '__img_ref__:0' } })
    expect(main.imagePool).toEqual(['/photo.png'])
  })
})
