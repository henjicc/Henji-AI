// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type MouseEvent } from 'react'
import { useCanvasStore } from '@/stores/canvasStore'
import { CANVAS_NODE_TYPES, type CanvasNode } from '../domain/canvasNodes'
import { canvasEventBus } from '../application/canvasServices'
import { nodeParameterDefaults } from '../application/nodeParameterDefaults'
import { useNodeParameterContextMenu } from './useNodeParameterContextMenu'

const node: CanvasNode = { id: 'default-source', type: CANVAS_NODE_TYPES.intSource, position: { x: 0, y: 0 }, data: { value: 4 } }
const closeAddMenu = vi.fn()
function Harness({ target = node }: { target?: CanvasNode }) {
  const menu = useNodeParameterContextMenu(closeAddMenu)
  return <div onContextMenu={(event: MouseEvent) => menu.onNodeContextMenu(event, target)} data-testid="node">{menu.nodeContextMenu}</div>
}
afterEach(() => {
  vi.restoreAllMocks()
  useCanvasStore.setState({ nodes: [] })
})

describe('节点参数右键菜单', () => {
  it('右击打开菜单、点击保存最新参数并反馈，Escape 可关闭', async () => {
    useCanvasStore.setState({ nodes: [node] })
    const save = vi.spyOn(nodeParameterDefaults, 'save').mockImplementation(() => {})
    const toast = vi.spyOn(canvasEventBus, 'publish')
    const view = render(<Harness />)
    fireEvent.contextMenu(screen.getByTestId('node'), { clientX: 50, clientY: 60 })
    expect(closeAddMenu).toHaveBeenCalled()
    expect(screen.getByText(/设置默认值|Set as defaults/)).toBeTruthy()
    act(() => useCanvasStore.setState({ nodes: [{ ...node, data: { value: 7 } }] }))
    fireEvent.click(screen.getByText(/设置默认值|Set as defaults/))
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ type: node.type }), { value: 7 }))
    expect(toast).toHaveBeenCalledWith('canvas/toast', expect.objectContaining({ type: 'success' }))
    fireEvent.contextMenu(screen.getByTestId('node'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByText(/设置默认值|Set as defaults/)).toBeNull()
    view.unmount()
  })

  it('保存异常显示失败，文本输入节点不显示该菜单', async () => {
    useCanvasStore.setState({ nodes: [node] })
    vi.spyOn(nodeParameterDefaults, 'save').mockImplementation(() => { throw new Error('full') })
    const toast = vi.spyOn(canvasEventBus, 'publish')
    const view = render(<Harness />)
    fireEvent.contextMenu(screen.getByTestId('node'))
    fireEvent.click(screen.getByText(/设置默认值|Set as defaults/))
    await waitFor(() => expect(toast).toHaveBeenCalledWith('canvas/toast', expect.objectContaining({ type: 'error' })))
    view.rerender(<Harness target={{ ...node, type: CANVAS_NODE_TYPES.stringSource }} />)
    fireEvent.contextMenu(screen.getByTestId('node'))
    expect(screen.queryByText(/设置默认值|Set as defaults/)).toBeNull()
    view.unmount()
  })
})
