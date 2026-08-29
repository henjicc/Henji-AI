import { describe, expect, it, vi } from 'vitest'

import { composeModelDefinition } from '@/core/composeModelDefinition'
import { derivedMediaStateKey } from '@/core/params/derivedMediaState'
import type { ModelDefinition } from '@/core/types'
import { modelPresentations } from '@/models/presentation'
import { apimartGptImage2Model as apimartRuntime } from '../../../../packages/ai-sdk/src/catalog/apimart/gpt-image-2.model'
import { falGptImage2Model as falRuntime } from '../../../../packages/ai-sdk/src/catalog/fal/gpt-image-2.model'
import { kieGptImage2Model as kieRuntime } from '../../../../packages/ai-sdk/src/catalog/kie/gpt-image-2.model'

import {
  ELEMENT_EDIT_MODEL_POLICY,
  prepareElementEditPreflight,
  resolveElementEditMaskParam,
  resolveElementEditVisibleParamIds,
  selectDefaultElementEditModel,
  validateElementEditImageInfo,
  validateElementEditRuntimeInput,
} from './elementEditPolicy'
import { resolveCanvasCapabilityModelCandidates } from './modelCompatibility'

const SOURCE_PATH = '/managed/source.png'
const MASK_PATH = '/managed/mask.png'

function validParams(maskParamId: string): DynamicValueMap {
  return {
    [maskParamId]: [MASK_PATH],
    [derivedMediaStateKey(maskParamId)]: {
      version: 1,
      sourceRef: SOURCE_PATH,
      width: 1024,
      height: 768,
      strokes: [{
        id: 'paint-1',
        kind: 'rectangle',
        mode: 'paint',
        points: [{ x: 10, y: 20 }, { x: 100, y: 120 }],
      }],
    },
  }
}

describe('元素编辑能力策略', () => {
  const compose = (runtime: typeof apimartRuntime): ModelDefinition => (
    composeModelDefinition(runtime, modelPresentations[runtime.meta.id])
  )
  const models = [compose(apimartRuntime), compose(falRuntime)]
  const kieModel = composeModelDefinition(kieRuntime, modelPresentations[kieRuntime.meta.id])
  const candidates = resolveCanvasCapabilityModelCandidates(
    models,
    ELEMENT_EDIT_MODEL_POLICY,
  ).candidates.map(({ model }) => model)

  it('只允许 Fal 与 APIMart 官方 GPT Image 2 遮罩编辑契约', () => {
    expect(candidates.map((model) => model.meta.id).sort()).toEqual([
      'apimart-gpt-image-2',
      'fal-ai-gpt-image-2',
    ])
    expect(selectDefaultElementEditModel(candidates)?.meta.id).toBe('apimart-gpt-image-2')
    expect(resolveElementEditVisibleParamIds(candidates).sort()).toEqual([
      'apimartGptImage2MaskUrl',
      'falGptImage2MaskUrl',
    ])
    expect(resolveElementEditMaskParam(kieModel)).toBeNull()
  })

  it.each([
    ['apimart-gpt-image-2', 'apimartGptImage2MaskUrl'],
    ['fal-ai-gpt-image-2', 'falGptImage2MaskUrl'],
  ])('验证 %s 的受管遮罩与可编辑文档', (modelId, maskParamId) => {
    expect(validateElementEditRuntimeInput({
      model: models.find((model) => model.meta.id === modelId),
      images: [SOURCE_PATH],
      params: validParams(maskParamId),
    })).toMatchObject({
      compatible: true,
      reasons: [],
      maskParamId,
      maskSource: MASK_PATH,
      document: { version: 1, sourceRef: SOURCE_PATH, width: 1024, height: 768 },
    })
  })

  it('拒绝无源图、多源图、空遮罩、旧版本、空选区和来源错位', () => {
    const model = models.find((candidate) => candidate.meta.id === 'fal-ai-gpt-image-2')
    const maskParamId = 'falGptImage2MaskUrl'
    expect(validateElementEditRuntimeInput({ model, images: [], params: {} }).reasons)
      .toContain('元素编辑必须且只能提供 1 张源图')
    expect(validateElementEditRuntimeInput({
      model,
      images: [SOURCE_PATH, '/managed/other.png'],
      params: validParams(maskParamId),
    }).compatible).toBe(false)

    const empty = validParams(maskParamId)
    empty[maskParamId] = []
    expect(validateElementEditRuntimeInput({ model, images: [SOURCE_PATH], params: empty }).reasons)
      .toContain('请先绘制需要编辑的区域')

    const invalidVersion = validParams(maskParamId)
    invalidVersion[derivedMediaStateKey(maskParamId)] = {
      ...(invalidVersion[derivedMediaStateKey(maskParamId)] as DynamicValueMap),
      version: 2,
    }
    expect(validateElementEditRuntimeInput({
      model,
      images: [SOURCE_PATH],
      params: invalidVersion,
    }).reasons).toContain('遮罩编辑文档缺失或版本不受支持，请重新绘制')

    const emptyPaint = validParams(maskParamId)
    emptyPaint[derivedMediaStateKey(maskParamId)] = {
      ...(emptyPaint[derivedMediaStateKey(maskParamId)] as DynamicValueMap),
      strokes: [],
    }
    expect(validateElementEditRuntimeInput({
      model,
      images: [SOURCE_PATH],
      params: emptyPaint,
    }).reasons).toContain('遮罩没有可编辑区域，请至少绘制一个区域')

    const stale = validParams(maskParamId)
    stale[derivedMediaStateKey(maskParamId)] = {
      ...(stale[derivedMediaStateKey(maskParamId)] as DynamicValueMap),
      sourceRef: '/managed/old.png',
    }
    expect(validateElementEditRuntimeInput({
      model,
      images: [SOURCE_PATH],
      params: stale,
    }).reasons).toContain('源图已变化，请基于当前源图重新绘制遮罩')
  })

  it('提交前拒绝尺寸错位和没有 Alpha 的遮罩', () => {
    const document = validateElementEditRuntimeInput({
      model: models.find((candidate) => candidate.meta.id === 'fal-ai-gpt-image-2'),
      images: [SOURCE_PATH],
      params: validParams('falGptImage2MaskUrl'),
    }).document
    if (!document) throw new Error('测试遮罩文档缺失')

    expect(validateElementEditImageInfo({
      source: { width: 1024, height: 768 },
      mask: { width: 1024, height: 768, hasAlpha: true },
      document,
    })).toEqual([])
    expect(validateElementEditImageInfo({
      source: { width: 1024, height: 768 },
      mask: { width: 512, height: 512, hasAlpha: false },
      document,
    })).toEqual([
      '遮罩尺寸必须与源图完全一致',
      '遮罩必须包含 Alpha 通道',
    ])
  })

  it('预检只读取源图与受管遮罩，成功时不注入额外请求参数', async () => {
    const readImageInfo = vi.fn()
      .mockResolvedValueOnce({ width: 1024, height: 768, hasAlpha: false })
      .mockResolvedValueOnce({ width: 1024, height: 768, hasAlpha: true })
    await expect(prepareElementEditPreflight({
      model: models.find((candidate) => candidate.meta.id === 'fal-ai-gpt-image-2'),
      images: [SOURCE_PATH],
      params: validParams('falGptImage2MaskUrl'),
      readImageInfo,
    })).resolves.toEqual({})
    expect(readImageInfo).toHaveBeenNthCalledWith(1, SOURCE_PATH)
    expect(readImageInfo).toHaveBeenNthCalledWith(2, MASK_PATH)
  })

  it('预检在读取文件前拒绝失效文档，并拒绝实际尺寸错位', async () => {
    const model = models.find((candidate) => candidate.meta.id === 'fal-ai-gpt-image-2')
    const invalidParams = validParams('falGptImage2MaskUrl')
    invalidParams[derivedMediaStateKey('falGptImage2MaskUrl')] = {
      ...(invalidParams[derivedMediaStateKey('falGptImage2MaskUrl')] as DynamicValueMap),
      sourceRef: '/managed/replaced.png',
    }
    const unread = vi.fn()
    await expect(prepareElementEditPreflight({
      model,
      images: [SOURCE_PATH],
      params: invalidParams,
      readImageInfo: unread,
    })).rejects.toThrow('源图已变化')
    expect(unread).not.toHaveBeenCalled()

    const readImageInfo = vi.fn()
      .mockResolvedValueOnce({ width: 1024, height: 768, hasAlpha: false })
      .mockResolvedValueOnce({ width: 512, height: 512, hasAlpha: true })
    await expect(prepareElementEditPreflight({
      model,
      images: [SOURCE_PATH],
      params: validParams('falGptImage2MaskUrl'),
      readImageInfo,
    })).rejects.toThrow('遮罩尺寸必须与源图完全一致')
  })
})
