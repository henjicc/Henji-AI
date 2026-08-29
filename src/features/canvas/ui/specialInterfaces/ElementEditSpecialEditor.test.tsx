// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CanvasSpecialEditorSession } from '@/features/canvas/application/specialEditorController'

import ElementEditSpecialEditor from './ElementEditSpecialEditor'

vi.mock('@/core/ModelRegistry', () => ({
  registry: {
    getModel: () => ({
      params: [{
        id: 'apimartGptImage2MaskUrl',
        type: 'image-upload',
        order: 2,
        name: { zh: '遮罩', en: 'Mask' },
        description: { zh: '受管遮罩', en: 'Managed mask' },
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
      }],
    }),
  },
}))

vi.mock('@/components/params/DerivedMediaParamControl', () => ({
  DerivedMediaParamControl: ({
    editorOpen,
    renderTrigger,
    onParamChanges,
    onEditorDismiss,
  }: {
    editorOpen: boolean
    renderTrigger: boolean
    onParamChanges: (changes: DynamicValueMap) => void
    onEditorDismiss: () => void
  }) => (
    <div>
      <span>{editorOpen && !renderTrigger ? '唯一遮罩编辑器' : '错误宿主'}</span>
      <div role="button" tabIndex={0} onClick={() => onParamChanges({
        apimartGptImage2MaskUrl: ['/managed/mask.png'],
        __henjiDerivedMediaAuthoring__apimartGptImage2MaskUrl: {
          version: 1,
          sourceRef: '/managed/source.png',
        },
      })}>确认遮罩</div>
      <div role="button" tabIndex={0} onClick={onEditorDismiss}>取消遮罩</div>
    </div>
  ),
}))

afterEach(cleanup)

function session(): CanvasSpecialEditorSession {
  const state: DynamicValueMap = {
    modelId: 'apimart-gpt-image-2',
    prompt: '把选区中的杯子换成花瓶',
    mediaInputs: { image: ['/managed/source.png'] },
    params: { apimartGptImage2Quality: 'medium' },
  }
  return {
    sessionId: 'element-session',
    projectId: 'project-1',
    nodeId: 'element-node',
    editorKey: 'mask',
    initialState: state,
    draftState: state,
    isDirty: false,
    discardConfirmationRequested: false,
  }
}

describe('元素编辑专用宿主', () => {
  it('复用唯一遮罩控件并将遮罩与文档一次写入节点草稿', () => {
    const onDraftChange = vi.fn()
    const onConfirm = vi.fn()
    render(
      <ElementEditSpecialEditor
        session={session()}
        onDraftChange={onDraftChange}
        onConfirm={onConfirm}
        onCancel={vi.fn(() => 'closed')}
        onKeepEditing={vi.fn()}
        onDiscard={vi.fn()}
      />
    )

    expect(screen.getByText('唯一遮罩编辑器')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '确认遮罩' }))
    expect(onDraftChange).toHaveBeenCalledWith(expect.objectContaining({
      params: expect.objectContaining({
        apimartGptImage2Quality: 'medium',
        apimartGptImage2MaskUrl: ['/managed/mask.png'],
        __henjiDerivedMediaAuthoring__apimartGptImage2MaskUrl: expect.objectContaining({
          sourceRef: '/managed/source.png',
        }),
      }),
    }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('取消时不写入草稿', () => {
    const onDraftChange = vi.fn()
    const onCancel = vi.fn(() => 'closed' as const)
    render(
      <ElementEditSpecialEditor
        session={session()}
        onDraftChange={onDraftChange}
        onConfirm={vi.fn()}
        onCancel={onCancel}
        onKeepEditing={vi.fn()}
        onDiscard={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: '取消遮罩' }))
    expect(onDraftChange).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
