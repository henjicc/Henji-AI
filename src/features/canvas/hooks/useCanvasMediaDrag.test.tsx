/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UiInput } from '@/components/ui/primitives'
import { useCanvasMediaDrag } from './useCanvasMediaDrag'

const { startDrag, endDrag } = vi.hoisted(() => ({ startDrag: vi.fn(), endDrag: vi.fn() }))
vi.mock('@/contexts/DragDropContext', () => ({ useDragDrop: () => ({ startDrag, endDrag }) }))
vi.mock('@/stores/canvasStore', () => ({ useCanvasStore: { getState: () => ({ nodes: [{
  id: 'image', type: 'uploadNode', position: { x: 0, y: 0 }, data: { imageUrl: 'https://fixture.invalid/a.png', aspectRatio: '1:1' },
}] }) } }))

function setup() {
  const nodeDown = vi.fn()
  function Fixture() {
    const capture = useCanvasMediaDrag()
    return <div onMouseDownCapture={capture}>
      <div className="react-flow__node" data-id="image" onMouseDown={nodeDown}>
        <img src="https://fixture.invalid/a.png" alt="素材" />
        <UiInput aria-label="节点输入" />
      </div>
    </div>
  }
  return { ...render(<Fixture />), nodeDown }
}
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks() })

describe('Shift 素材拖动', () => {
  it('只有 Shift 左键移动超过阈值才开始素材拖动，不触发节点移动；Escape 清理会话', () => {
    const view = setup()
    fireEvent.mouseDown(view.getByAltText('素材'), { button: 0, shiftKey: true, clientX: 10, clientY: 10 })
    fireEvent.mouseMove(window, { buttons: 1, clientX: 12, clientY: 10 })
    expect(startDrag).not.toHaveBeenCalled()
    expect(view.nodeDown).not.toHaveBeenCalled()
    fireEvent.mouseMove(window, { buttons: 1, clientX: 20, clientY: 10 })
    expect(startDrag).toHaveBeenCalledTimes(1)
    expect(startDrag).toHaveBeenCalledWith(expect.objectContaining({ type: 'image', imageUrl: 'https://fixture.invalid/a.png' }), 'https://fixture.invalid/a.png')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(endDrag).toHaveBeenCalledTimes(1)
    fireEvent.mouseMove(window, { buttons: 1, clientX: 30, clientY: 10 })
    expect(startDrag).toHaveBeenCalledTimes(1)
  })

  it.each([{}, { shiftKey: true, altKey: true }, { shiftKey: true, ctrlKey: true }, { shiftKey: true, metaKey: true }, { shiftKey: true, button: 2 }])('不接管已有修饰键组合 %o', modifiers => {
    const view = setup()
    fireEvent.mouseDown(view.getByAltText('素材'), { button: 0, ...modifiers })
    fireEvent.mouseMove(window, { buttons: 1, clientX: 20 })
    expect(view.nodeDown).toHaveBeenCalledTimes(1)
    expect(startDrag).not.toHaveBeenCalled()
  })

  it('输入控件保留交互，失焦和卸载都清理已开始的拖放', () => {
    const view = setup()
    fireEvent.mouseDown(view.getByLabelText('节点输入'), { shiftKey: true })
    expect(view.nodeDown).toHaveBeenCalledTimes(1)
    for (const finish of [() => fireEvent.blur(window), () => view.unmount()]) {
      fireEvent.mouseDown(view.getByAltText('素材'), { shiftKey: true })
      fireEvent.mouseMove(window, { buttons: 1, clientX: 20 })
      finish()
    }
    expect(endDrag).toHaveBeenCalledTimes(2)
  })

  it('放置区阻止冒泡时仍会清理，且先允许放置区消费会话', () => {
    vi.useFakeTimers()
    const view = setup()
    const target = view.getByAltText('素材')
    fireEvent.mouseDown(target, { shiftKey: true })
    fireEvent.mouseMove(window, { buttons: 1, clientX: 20 })
    target.addEventListener('mouseup', event => {
      event.stopPropagation()
      expect(endDrag).not.toHaveBeenCalled()
    }, { once: true })
    fireEvent.mouseUp(target)
    vi.runAllTimers()
    expect(endDrag).toHaveBeenCalledTimes(1)
    fireEvent.blur(window)
    expect(endDrag).toHaveBeenCalledTimes(1)
  })
})
