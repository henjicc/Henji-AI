/** @vitest-environment jsdom */
import { cleanup, fireEvent, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCanvasShortcuts } from './useCanvasShortcuts'

function setup() {
  const undo = vi.fn(() => true)
  const redo = vi.fn(() => true)
  const deleteNodes = vi.fn(async () => undefined)
  const addNode = vi.fn(() => 'new')
  const persist = vi.fn()
  renderHook(() => useCanvasShortcuts({
    wrapperRef: { current: null }, reactFlowInstance: {} as never,
    selectedUploadNodeId: 'selected', selectedUploadKinds: ['image'],
    selectedNodeIds: ['selected'], selectedNodeId: 'selected', focusedNodeId: null,
    nodes: [], edges: [], deleteNodes, groupNodes: vi.fn(), createAssetGroup: vi.fn(),
    undo, redo, scheduleCanvasPersist: persist, duplicateNodes: vi.fn(), addNode, setSelectedNode: vi.fn(),
  }))
  return { undo, redo, deleteNodes, addNode, persist }
}

afterEach(cleanup)
describe('画布快捷键作用域', () => {
  it('弹窗打开时不撤销、重做、删除或粘贴背景节点，关闭后恢复', () => {
    const calls = setup()
    const modal = document.createElement('div')
    modal.setAttribute('aria-modal', 'true')
    document.body.append(modal)
    try {
      for (const modifiers of [{ ctrlKey: true }, { metaKey: true }]) {
        fireEvent.keyDown(document, { key: 'z', ...modifiers })
        fireEvent.keyDown(document, { key: 'z', shiftKey: true, ...modifiers })
      }
      fireEvent.keyDown(document, { key: 'Delete' })
      expect(fireEvent.paste(modal, { clipboardData: { files: [new File(['x'], 'test.png', { type: 'image/png' })], items: [] } })).toBe(true)
      Object.values(calls).forEach((call) => expect(call).not.toHaveBeenCalled())
    } finally { modal.remove() }
    fireEvent.keyDown(document.body, { key: 'z', metaKey: true })
    expect(calls.undo).toHaveBeenCalledOnce()
    expect(calls.persist).toHaveBeenCalledOnce()
  })

  it('不接管已被子控件消费的撤销', () => {
    const { undo } = setup()
    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })
    event.preventDefault()
    document.dispatchEvent(event)
    expect(undo).not.toHaveBeenCalled()
  })
})
