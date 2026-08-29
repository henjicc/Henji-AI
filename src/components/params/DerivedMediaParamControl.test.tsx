// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n/config'
import type { ImageUploadParamDef } from '@/core/types'
import { derivedMediaStateKey } from '@/core/params/derivedMediaState'
import { DerivedMediaParamControl } from './DerivedMediaParamControl'

vi.mock('@/platform/runtime', () => ({ isUiInspectionReadOnly: () => true }))
vi.mock('@/features/maskEditor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/maskEditor')>()
  return {
    ...actual,
    MaskEditorModal: ({ isOpen, onCancel, onConfirm }: {
      isOpen: boolean
      onCancel: () => void
      onConfirm: (result: DynamicValue) => void
    }) => isOpen ? (
      <div role="dialog" aria-label="测试遮罩编辑器">
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
    ) : null,
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

    expect(screen.getByRole('button', { name: '绘制' }).className).toContain('h-[38px]')

    rerender(
      <DerivedMediaParamControl
        param={param}
        value={[]}
        allValues={{ uploadedImages: ['data:image/png;base64,source'] }}
        onChange={() => undefined}
        compact
      />
    )

    expect(screen.getByRole('button', { name: '绘制' }).className).toContain('!h-7')
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
