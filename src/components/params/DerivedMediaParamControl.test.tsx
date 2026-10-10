// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n/config'
import type { ImageUploadParamDef } from '@/core/types'
import { derivedMediaStateKey } from '@/core/params/derivedMediaState'
import { UI_FIELD_INLINE_ROW_CLASS, UiFieldLayoutContext } from '@/components/ui'
import { DerivedMediaParamControl } from './DerivedMediaParamControl'

vi.mock('@/platform/runtime', () => ({ isUiInspectionReadOnly: () => true, isDesktopRuntime: () => false }))
vi.mock('@/features/maskEditor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/maskEditor')>()
  const { useUiFieldLayout } = await import('@/components/ui')
  return {
    ...actual,
    MaskEditorModal: ({ isOpen, onCancel, onConfirm }: {
      isOpen: boolean
      onCancel: () => void
      onConfirm: (result: DynamicValue) => void
    }) => {
      const layout = useUiFieldLayout()
      return isOpen ? (
      <div role="dialog" aria-label="测试遮罩编辑器" data-field-layout={layout}>
        <div role="button" tabIndex={0} onClick={onCancel}>取消测试编辑</div>
        <div role="button" tabIndex={0} onClick={() => onConfirm({
          document: {
            version: 1,
            sourceRef: 'data:image/png;base64,source',
            width: 64,
            height: 32,
            strokes: [{ id: 'stroke', mode: 'paint', size: 8, points: [{ x: 1, y: 2 }] }],
          },
          maskDataUrl: 'data:image/png;base64,mask',
          width: 64,
          height: 32,
        })}>确认测试编辑</div>
      </div>
      ) : null
    },
  }
})

const param: ImageUploadParamDef = {
  id: 'mask_url',
  type: 'image-upload',
  order: 2,
  name: { zh: '局部重绘遮罩', en: 'Inpainting Mask' },
  tooltip: { zh: '在首张图上涂抹需要重绘的区域。', en: 'Paint the area to regenerate.' },
  description: { zh: '供助手理解的遮罩语义', en: 'Assistant-facing mask semantics' },
  default: [],
  derivedMediaAuthoring: {
    kind: 'mask',
    source: { kind: 'first-image' },
    editor: { kind: 'mask' },
    output: {
      format: 'png',
      maskEncoding: 'alpha',
      dimensions: 'source',
      paintMeaning: 'transparent-edit',
    },
    onSourceChange: 'invalidate',
    actions: { create: { zh: '绘制', en: 'Draw' }, edit: { zh: '编辑', en: 'Edit' } },
  },
}

beforeEach(async () => {
  await i18n.changeLanguage('zh-CN')
})

afterEach(cleanup)

describe('派生遮罩参数控件', () => {
  it('从首张参考图进入绘制，并一次提交遮罩与可编辑文档', async () => {
    const onParamChanges = vi.fn()
    render(
      <DerivedMediaParamControl
        param={param}
        value={[]}
        allValues={{ uploadedImages: ['data:image/png;base64,source'] }}
        onChange={() => undefined}
        onParamChanges={onParamChanges}
      />
    )

    expect(screen.queryByText('供助手理解的遮罩语义')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '绘制' }))
    expect(screen.getByRole('dialog', { name: '测试遮罩编辑器' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '确认测试编辑' }))

    expect(onParamChanges).toHaveBeenCalledTimes(1)
    expect(onParamChanges).toHaveBeenCalledWith(expect.objectContaining({
      mask_url: ['data:image/png;base64,mask'],
      [derivedMediaStateKey('mask_url')]: expect.objectContaining({
        sourceRef: 'data:image/png;base64,source',
      }),
    }))
  })

  it('已有遮罩只显示编辑入口，取消编辑不改变状态', () => {
    const onParamChanges = vi.fn()
    render(
      <DerivedMediaParamControl
        param={param}
        value={['/managed/mask.png']}
        allValues={{ uploadedImages: ['data:image/png;base64,source'] }}
        onChange={() => undefined}
        onParamChanges={onParamChanges}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.click(screen.getByRole('button', { name: '取消测试编辑' }))
    expect(onParamChanges).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: '清除遮罩' })).toBeNull()
  })

  it('生成页按钮使用参数控件高度，画布按钮保持节点紧凑高度', () => {
    const { rerender } = render(
      <DerivedMediaParamControl
        param={param}
        value={[]}
        allValues={{ uploadedImages: ['data:image/png;base64,source'] }}
        onChange={() => undefined}
      />
    )

    // 生成页：与参数字段同一行的醒目档（36）
    expect(screen.getByRole('button', { name: '绘制' }).dataset.size).toBe('lg')

    rerender(
      <DerivedMediaParamControl
        param={param}
        value={[]}
        allValues={{ uploadedImages: ['data:image/png;base64,source'] }}
        onChange={() => undefined}
        compact
      />
    )

    // 画布节点：紧凑档（28）
    expect(screen.getByRole('button', { name: '绘制' }).dataset.size).toBe('sm')
  })

  it('允许专用宿主直接打开唯一编辑器，取消不写入且确认仍原子提交', () => {
    const onEditorDismiss = vi.fn()
    const onParamChanges = vi.fn()
    render(
      <DerivedMediaParamControl
        param={param}
        value={[]}
        allValues={{ uploadedImages: ['data:image/png;base64,source'] }}
        onChange={() => undefined}
        onParamChanges={onParamChanges}
        editorOpen
        renderTrigger={false}
        onEditorDismiss={onEditorDismiss}
      />
    )

    expect(screen.queryByRole('button', { name: '绘制' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '取消测试编辑' }))
    expect(onEditorDismiss).toHaveBeenCalledTimes(1)
    expect(onParamChanges).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '确认测试编辑' }))
    expect(onParamChanges).toHaveBeenCalledTimes(1)
    expect(onEditorDismiss).toHaveBeenCalledTimes(1)
  })
})

describe('派生遮罩参数控件的工具条排布（3.7：生成底栏）', () => {
  it('底栏里标签在左、按钮与行同高（md），编辑弹窗内部重置为表单排布', () => {
    const view = render(
      <UiFieldLayoutContext.Provider value="toolbar">
        <DerivedMediaParamControl
          param={param}
          value={[]}
          allValues={{ uploadedImages: ['data:image/png;base64,source'] }}
          onChange={() => undefined}
        />
      </UiFieldLayoutContext.Provider>
    )
    const button = screen.getByRole('button', { name: '绘制' })
    expect(button.getAttribute('data-size')).toBe('md')
    const row = view.getByText('局部重绘遮罩').closest(`[class*="${UI_FIELD_INLINE_ROW_CLASS.split(' ')[0]}"]`)
    expect(row?.className).toBe(UI_FIELD_INLINE_ROW_CLASS)
    expect(row?.contains(button)).toBe(true)
    fireEvent.click(button)
    expect(screen.getByRole('dialog', { name: '测试遮罩编辑器' }).getAttribute('data-field-layout')).toBe('form')
  })

  it('表单排布（画布、弹窗）保持标签在上与大号按钮', () => {
    render(
      <DerivedMediaParamControl
        param={param}
        value={[]}
        allValues={{ uploadedImages: ['data:image/png;base64,source'] }}
        onChange={() => undefined}
      />
    )
    expect(screen.getByRole('button', { name: '绘制' }).getAttribute('data-size')).toBe('lg')
    expect(screen.getByText('局部重绘遮罩').closest('.flex-col')).toBeTruthy()
  })
})
