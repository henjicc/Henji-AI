import { afterEach, describe, expect, it } from 'vitest'
import { catalog } from '@henjicc/ai-sdk'
import { composeModelDefinition } from '@/core/composeModelDefinition'
import { registry } from '@/core/ModelRegistry'
import { falPresentation } from '@/models/presentation/fal'
import { mapCanvasNodeMediaReferences as rendererMap, resolveCanvasNodeMediaSchema } from '@/features/canvas/application/canvasNodeMediaReferences'
import { resolveStoryboardProjectMediaSchema, validateStoryboardProjectRecord } from '../../../electron/main/services/storyboard-project-validation'
import { mapCanvasNodeMediaReferences } from './nodeMediaReferences'
import { parseCanvasProjectRecord } from './projectRecordCodec'
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
    expect(resolveStoryboardProjectMediaSchema(modelId)?.find((param) => param.id === parameterId))
      .not.toHaveProperty('derivedMediaAuthoring')
    const data = { modelId, prompt: '__img_ref__:999', params: {
      [parameterId]: '__img_ref__:0', [stateKey]: { sourceRef: '__img_ref__:0' },
    } }
    const mapValue = (value: string) => value === '__img_ref__:0' ? '/photo.png' : value
    const mainMapped = mapCanvasNodeMediaReferences(data, mapValue, resolveStoryboardProjectMediaSchema)
    expect(rendererMap(data, mapValue)).toEqual(mainMapped)
    expect(mainMapped).toMatchObject({ prompt: '__img_ref__:999', params: {
      [parameterId]: '/photo.png', [stateKey]: { sourceRef: '/photo.png' },
    } })
    const record = { nodesJson: JSON.stringify([{ id: 'n', type: 'generator', position: { x: 0, y: 0 }, data }]),
      edgesJson: '[]', viewportJson: '{"x":0,"y":0,"zoom":1}',
      historyJson: '{"past":[],"future":[],"imagePool":["/photo.png"]}' }
    expect(() => validateStoryboardProjectRecord(record)).not.toThrow()
    expect(() => parseCanvasProjectRecord(record, resolveCanvasNodeMediaSchema)).not.toThrow()
    const invalid = { ...record, nodesJson: record.nodesJson.replaceAll('__img_ref__:0', '__img_ref__:1') }
    expect(() => validateStoryboardProjectRecord(invalid)).toThrow()
    expect(() => parseCanvasProjectRecord(invalid, resolveCanvasNodeMediaSchema)).toThrow()
  })

  it('下线模型在两端均保留不透明参数与媒体池，不把缺少schema当成工程损坏', () => {
    const record = { nodesJson: JSON.stringify([{ id: 'n', type: 'generator', position: { x: 0, y: 0 },
      data: { modelId: 'unknown', params: { image: '__img_ref__:0' } } }]), edgesJson: '[]',
      viewportJson: '{"x":0,"y":0,"zoom":1}', historyJson: '{"past":[],"future":[],"imagePool":["/photo.png"]}' }
    expect(() => validateStoryboardProjectRecord(record)).not.toThrow()
    const main = parseCanvasProjectRecord(record, resolveStoryboardProjectMediaSchema)
    const renderer = parseCanvasProjectRecord(record, resolveCanvasNodeMediaSchema)
    expect(renderer).toEqual(main)
    expect(main.nodes[0].data).toEqual({ modelId: 'unknown', params: { image: '__img_ref__:0' } })
    expect(main.imagePool).toEqual(['/photo.png'])
  })
})
