// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CanvasSpecialEditorSession } from '@/features/canvas/application/specialEditorController'
import ElementEditSpecialEditor from './ElementEditSpecialEditor'

vi.mock('@/commands/image', () => ({
  persistImageSource: vi.fn(async () => '/managed/local-redraw-mask.png'),
}))
vi.mock('@/features/maskEditor', () => ({
  parseMaskEditorDocument: (value: unknown) => value ?? null,
  MaskEditorModal: ({ onConfirm, onCancel }: {
    onConfirm: (result: DynamicValueMap) => void
    onCancel: () => void
  }) => (
    <div>
      <span>唯一遮罩编辑器</span>
      <button type="button" onClick={() => onConfirm({
        maskDataUrl: 'data:image/png;base64,bWFzaw==',
        width: 1024,
        height: 768,
        document: { version: 1, sourceRef: '/managed/source.png', width: 1024, height: 768, strokes: [{ id: 'paint' }] },
      })}>确认遮罩</button>
      <button type="button" onClick={onCancel}>取消遮罩</button>
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
    sessionId: 'element-session', projectId: 'project-1', nodeId: 'element-node', editorKey: 'mask',
    initialState: state, draftState: state, isDirty: false, discardConfirmationRequested: false,
  }
}

describe('局部重绘专用遮罩宿主', () => {
  it('保持唯一遮罩编辑器，先持久化遮罩再写入节点级字段', async () => {
    const onDraftChange = vi.fn()
    const onConfirm = vi.fn()
    render(<ElementEditSpecialEditor
      session={session()}
      onDraftChange={onDraftChange}
      onConfirm={onConfirm}
      onCancel={vi.fn(() => 'closed')}
      onKeepEditing={vi.fn()}
      onDiscard={vi.fn()}
    />)
    expect(screen.getByText('唯一遮罩编辑器')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '确认遮罩' }))
    await waitFor(() => {
      expect(onDraftChange).toHaveBeenCalledWith(expect.objectContaining({
        localRedrawMaskSource: '/managed/local-redraw-mask.png',
        localRedrawMaskDocument: expect.objectContaining({ sourceRef: '/managed/source.png' }),
        params: { apimartGptImage2Quality: 'medium' },
      }))
      expect(onConfirm).toHaveBeenCalledTimes(1)
    })
  })

  it('取消时不写入草稿', () => {
    const onDraftChange = vi.fn()
    const onCancel = vi.fn(() => 'closed' as const)
    render(<ElementEditSpecialEditor
      session={session()}
      onDraftChange={onDraftChange}
      onConfirm={vi.fn()}
      onCancel={onCancel}
      onKeepEditing={vi.fn()}
      onDiscard={vi.fn()}
    />)
    fireEvent.click(screen.getByRole('button', { name: '取消遮罩' }))
    expect(onDraftChange).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
