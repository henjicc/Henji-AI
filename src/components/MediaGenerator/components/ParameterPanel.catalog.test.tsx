// @vitest-environment jsdom
import React, { createRef } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { registry } from '@/core/ModelRegistry'
import { analyzeRatioResolutionParams } from '@/core/params/ratioResolution'
import { getPresentedParamIds } from '@/core/params/paramPresentation'
import type { ModelDefinition, ParamDef } from '@/core/types'
import { isParamVisible } from '@/components/params/paramVisibility'
import { UiFieldLayoutContext } from '@/components/ui'
import { NotificationProvider } from '@/contexts/NotificationContext'
import { loadRealModelsIntoRegistry } from '@/tests/loadRealModels'
import ParameterPanel, { type ParameterPanelController } from './ParameterPanel'
import { isDurationParam, isPrimarySelectorParam, resolveParameterPanelLayout } from './parameterOrder'

const SHARED_SELECTOR_KEYS = new Set(['params.fields.mode', 'params.fields.version', 'params.fields.variant', 'params.fields.apiChannel'])
const LITERAL_SELECTOR_NAMES = new Set(['模式', '版本', '变体', '渠道'])

function looksLikeSelector(param: ParamDef): boolean {
  if (param.type !== 'dropdown' && param.type !== 'radio') return false
  const name = param.name as unknown as Record<string, unknown>
  return SHARED_SELECTOR_KEYS.has(String(name?.key)) || LITERAL_SELECTOR_NAMES.has(String(name?.zh ?? '').trim())
}

function defaultLayout(model: ModelDefinition) {
  const values = registry.getDefaultValues(model.meta.id)
  const visible = model.params.filter((param) => isParamVisible(param, values, null))
  const spec = model.meta.provider === 'modelscope' ? null : analyzeRatioResolutionParams(visible, [])
  const consumed = new Set(spec?.consumedParamIds ?? [])
  return resolveParameterPanelLayout(visible.filter((param) => !consumed.has(param.id)), model.paramPresentation, Boolean(spec))
}

beforeAll(async () => {
  await loadRealModelsIntoRegistry()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('全部模型的主选择器顺序（任务 4.3）', () => {
  it('名称是模式/版本/变体/渠道的顶层选择器都声明了 role（断牙：漏写 role 会掉到时长之后）', () => {
    const missing = registry.listAllModels().flatMap((model) => {
      const grouped = getPresentedParamIds(model.paramPresentation)
      return model.params
        .filter((param) => !grouped.has(param.id) && looksLikeSelector(param) && !isPrimarySelectorParam(param))
        .map((param) => `${model.meta.id}:${param.id}`)
    })
    expect(missing).toEqual([])
  })

  it('默认值下，主选择器排在比例/分辨率面板与时长之前', () => {
    const violations = registry.listAllModels().flatMap((model) => {
      const layout = defaultLayout(model)
      const selectorsOutsidePrimary = layout.items
        .filter((item) => item.kind === 'param' && isPrimarySelectorParam(item.param))
        .map((item) => `${model.meta.id}:${item.kind === 'param' ? item.param.id : ''}`)
      return selectorsOutsidePrimary
    })
    expect(violations).toEqual([])
  })

  it('Seedance 2.0（KIE）：模式第一，随后比例/分辨率面板，再是时长', () => {
    const model = registry.getModel('kie-seedance-2.0')!
    const layout = defaultLayout(model)
    expect(layout.primary.map((param) => param.id)).toEqual(['kieSeedance20Mode'])
    expect(layout.hasSpecialPanel).toBe(true)
    const first = layout.items[0]
    expect(first?.kind === 'param' && isDurationParam(first.param)).toBe(true)
  })
})

/** jsdom 不排版：给溢出行与各项固定宽度，模拟窄窗口。 */
function mockRowGeometry(containerWidth: number, itemWidth: number): void {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-ui-overflow-row') ? containerWidth : 0
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const width = this.hasAttribute('data-overflow-item') || this.hasAttribute('data-overflow-menu') ? itemWidth : 0
    return { width, height: 32, top: 0, left: 0, right: width, bottom: 32, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  })
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} })
}

function renderBar(modelId: string, values: DynamicValueMap, controllerRef = createRef<ParameterPanelController>()) {
  const view = render(
    <NotificationProvider>
    <UiFieldLayoutContext.Provider value="toolbar">
      <ParameterPanel
        currentModel={registry.getModel(modelId)}
        selectedModel={modelId}
        uploadedImages={[]}
        uploadedVideos={[]}
        values={values}
        onChange={() => {}}
        onChanges={() => {}}
        toolbarLeading={<span>模型</span>}
        controllerRef={controllerRef}
      />
    </UiFieldLayoutContext.Provider>
    </NotificationProvider>
  )
  return { view, controllerRef }
}

describe('生成底栏单行溢出（任务 4.3）', () => {
  it('窄宽度下低优先级参数收进“更多参数”，在浮层里仍可修改', () => {
    mockRowGeometry(420, 100)
    const values = registry.getDefaultValues('kie-seedance-2.0')
    const { view } = renderBar('kie-seedance-2.0', values)
    const row = document.querySelector('[data-ui-overflow-row]')!
    // 模型、模式 pinned；放得下比例面板，开关类收起
    expect(row.querySelector('[data-overflow-item="leading"]')).not.toBeNull()
    expect(row.querySelector('[data-overflow-item="param:kieSeedance20Mode"]')).not.toBeNull()
    expect(row.querySelector('[data-overflow-item="param:kieSeedance20ReturnLastFrame"]')).toBeNull()
    const more = view.container.querySelector<HTMLElement>('[data-more-params-trigger]')!
    fireEvent.click(more)
    expect(document.querySelector('[data-param-id="kieSeedance20ReturnLastFrame"]')).not.toBeNull()
  })

  it('收起的必填参数未填时提示“需填写”，点生成时打开“更多参数”并聚焦该参数', async () => {
    mockRowGeometry(320, 100)
    const modelId = 'volcengine-seed-icl-2.0'
    const values = { ...registry.getDefaultValues(modelId), volcIclMode: 'clone', volcCloneName: '' }
    const { controllerRef } = renderBar(modelId, values)
    const more = document.querySelector<HTMLElement>('[data-more-params-trigger]')!
    expect(more.getAttribute('data-missing-required')).toBe('true')
    expect(more.textContent).toMatch(/需填写|Required/)

    let revealed = false
    act(() => {
      revealed = controllerRef.current?.revealFirstMissingRequired() ?? false
    })
    // 浮层挂载后再聚焦（实现里等两帧）
    await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => setTimeout(resolve, 0))))
    expect(revealed).toBe(true)
    expect(more.getAttribute('aria-expanded')).toBe('true')
    const field = document.querySelector('[data-param-id="volcCloneName"]')
    expect(field).not.toBeNull()
    expect(field?.contains(document.activeElement)).toBe(true)
  })
})
