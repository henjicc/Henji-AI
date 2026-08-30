import { describe, expect, it, vi } from 'vitest'

import { composeModelDefinition } from '@/core/composeModelDefinition'
import type { ModelDefinition } from '@/core/types'
import { modelPresentations } from '@/models/presentation'
import { apimartGptImage2Model as apimartRuntime } from '../../../../packages/ai-sdk/src/catalog/apimart/gpt-image-2.model'
import { kieGptImage2Model as kieRuntime } from '../../../../packages/ai-sdk/src/catalog/kie/gpt-image-2.model'
import {
  DEFAULT_LOCAL_REDRAW_SETTINGS,
  ELEMENT_EDIT_MODEL_POLICY,
  normalizeLocalRedrawSettings,
  prepareElementEditPreflight,
  selectDefaultElementEditModel,
  validateElementEditImageInfo,
  validateElementEditRuntimeInput,
} from './elementEditPolicy'
import { resolveCanvasCapabilityModelCandidates, resolveCanvasCapabilityVisibleParamIds } from './modelCompatibility'

const SOURCE_PATH = '/managed/source.png'
const MASK_PATH = '/managed/mask.png'
const DOCUMENT = {
  version: 1 as const,
  sourceRef: SOURCE_PATH,
  width: 1024,
  height: 768,
  strokes: [{
    id: 'paint-1',
    kind: 'rectangle' as const,
    mode: 'paint' as const,
    points: [{ x: 10, y: 20 }, { x: 100, y: 120 }],
  }],
}

describe('局部重绘能力策略', () => {
  const compose = (runtime: typeof apimartRuntime | typeof kieRuntime): ModelDefinition => (
    composeModelDefinition(runtime, modelPresentations[runtime.meta.id])
  )
  const models = [compose(apimartRuntime), compose(kieRuntime)]

  it('开放所有带图片编辑标签的模型，不要求供应商遮罩参数', () => {
    const candidates = resolveCanvasCapabilityModelCandidates(models, ELEMENT_EDIT_MODEL_POLICY)
      .candidates.map(({ model }) => model)
    expect(candidates.map((model) => model.meta.id)).toEqual([
      'apimart-gpt-image-2',
      'kie-gpt-image-2',
    ])
    expect(selectDefaultElementEditModel(candidates)?.meta.id).toBe('apimart-gpt-image-2')
    const visible = resolveCanvasCapabilityVisibleParamIds(candidates[0], ELEMENT_EDIT_MODEL_POLICY, {
      hiddenTemplateVersion: null,
      fixedSemanticParams: {},
      visibleParameterKeys: [],
      showAllModelParameters: true,
    })
    expect(visible).toContain('apimartGptImage2Quality')
    expect(visible).not.toContain('apimartGptImage2MaskUrl')
  })

  it('验证节点自己的受管遮罩与可编辑文档', () => {
    expect(validateElementEditRuntimeInput({
      images: [SOURCE_PATH], maskSource: MASK_PATH, maskDocument: DOCUMENT,
    })).toMatchObject({ compatible: true, reasons: [], maskSource: MASK_PATH })
    expect(validateElementEditRuntimeInput({ images: [], maskSource: null, maskDocument: null }).reasons)
      .toEqual(expect.arrayContaining(['局部重绘必须且只能提供 1 张源图', '请先绘制需要重绘的区域']))
    expect(validateElementEditRuntimeInput({
      images: [SOURCE_PATH], maskSource: MASK_PATH, maskDocument: { ...DOCUMENT, sourceRef: '/old.png' },
    }).reasons).toContain('源图已变化，请基于当前源图重新绘制遮罩')
  })

  it('保留三档配准、裁剪比例和回贴参数', () => {
    expect(normalizeLocalRedrawSettings({
      contextScale: 3,
      aspectRatio: '16:9',
      registrationQuality: 'extreme',
      featherPixels: 24,
      forceRegistration: true,
    })).toEqual({
      contextScale: 3,
      aspectRatio: '16:9',
      registrationQuality: 'extreme',
      featherPixels: 24,
      forceRegistration: true,
    })
    expect(normalizeLocalRedrawSettings({})).toEqual(DEFAULT_LOCAL_REDRAW_SETTINGS)
  })

  it('提交前校验尺寸与 Alpha，并读取真实文件信息', async () => {
    expect(validateElementEditImageInfo({
      source: { width: 1024, height: 768 },
      mask: { width: 512, height: 512, hasAlpha: false },
      document: DOCUMENT,
    })).toEqual(['遮罩尺寸必须与源图完全一致', '遮罩必须包含 Alpha 通道'])
    const readImageInfo = vi.fn()
      .mockResolvedValueOnce({ width: 1024, height: 768, hasAlpha: false })
      .mockResolvedValueOnce({ width: 1024, height: 768, hasAlpha: true })
    await expect(prepareElementEditPreflight({
      images: [SOURCE_PATH], maskSource: MASK_PATH, maskDocument: DOCUMENT, readImageInfo,
    })).resolves.toBeUndefined()
    expect(readImageInfo).toHaveBeenNthCalledWith(1, SOURCE_PATH)
    expect(readImageInfo).toHaveBeenNthCalledWith(2, MASK_PATH)
  })
})
