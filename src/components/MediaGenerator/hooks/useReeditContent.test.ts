// @vitest-environment jsdom
import { useState } from 'react'
import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { registry } from '@/core/ModelRegistry'
import type { ModelDefinition } from '@/core/types'
import { useModelParams } from '@/hooks/useModelParams'
import { derivedMediaStateKey } from '@/core/params/derivedMediaState'
import type { UIState } from '../state/useUIState'
import { useReeditContent } from './useReeditContent'

vi.mock('@/platform/desktopApi', () => ({ readFile: vi.fn() }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ info: vi.fn(), error: vi.fn() }) }))
afterEach(() => { registry.clear(); vi.useRealTimers() })
const model = (id: string, alias = false): ModelDefinition => ({
  meta: { id, canonicalModelId: 'nano-banana', provider: 'test-provider', type: 'image', name: { zh: id, en: id }, tags: [],
    ...(alias ? { aliases: ['old-target'], aliasParamMappings: { 'old-target': { legacyRatio: 'ratio' } } } : {}) },
  params: [{ id: 'ratio', type: 'dropdown', order: 1, name: { zh: '比例', en: 'Ratio' }, default: '1:1', options: [{ value: '1:1', label: '1:1' }, { value: '9:16', label: '9:16' }] }],
  linkages: [], endpoints: '/test', request: { builder: () => ({}) }, pricing: { currency: '$', fixed: 0.1, description: '测试价格' },
})
it.each(['target', 'source'])('重新编辑切换到 %s 后由当前模型规范化历史别名，不依赖延迟计时器', async target => {
  vi.useFakeTimers()
  registry.register(model('source', target === 'source'))
  registry.register(model('target', target === 'target'))
  const { result } = renderHook(() => {
    const [selectedModel, setSelectedModel] = useState('source')
    const params = useModelParams(selectedModel)
    const ui = { selectedModel, setSelectedModel } as UIState
    useReeditContent(ui, params)
    return { selectedModel, params: params.params }
  })
  act(() => { window.dispatchEvent(new CustomEvent('reedit-content', { detail: { model: target, options: { legacyRatio: '9:16' } } })) })
  expect(vi.getTimerCount()).toBe(0)
  await act(async () => { await vi.advanceTimersByTimeAsync(100) })
  expect(result.current.selectedModel).toBe(target)
  expect(result.current.params.ratio).toBe('9:16')
})
it('切换模型回填时按目标 schema 清除失去来源的派生遮罩', () => {
  registry.register(model('source'))
  const target = model('target')
  target.params.push({ id: 'mask', type: 'image-upload', order: 2, name: { zh: '遮罩', en: 'Mask' }, default: [], valueType: 'array',
    derivedMediaAuthoring: { kind: 'mask', source: { kind: 'first-image' }, editor: { kind: 'mask' },
      output: { format: 'png', maskEncoding: 'alpha', paintMeaning: 'transparent-edit', dimensions: 'source' }, onSourceChange: 'invalidate',
      actions: { create: { zh: '绘制', en: 'Draw' }, edit: { zh: '编辑', en: 'Edit' } } } })
  registry.register(target)
  const { result } = renderHook(() => {
    const [selectedModel, setSelectedModel] = useState('source')
    const params = useModelParams(selectedModel)
    useReeditContent({ selectedModel, setSelectedModel } as UIState, params)
    return params.params
  })
  act(() => { window.dispatchEvent(new CustomEvent('reedit-content', { detail: { model: 'target', options: { mask: ['old-mask.png'], [derivedMediaStateKey('mask')]: { sourceRef: 'old.png' } } } })) })
  expect(result.current.mask).toEqual([])
  expect(result.current[derivedMediaStateKey('mask')]).toBeUndefined()
})
