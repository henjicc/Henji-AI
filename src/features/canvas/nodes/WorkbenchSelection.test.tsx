// @vitest-environment jsdom
import { useState, type ComponentProps, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const renders = vi.hoisted(() => ({ relight: 0, multiAngle: 0 }))
vi.mock('./shared/ToolWorkbenchNodeFrame', () => ({
  ToolWorkbenchNodeFrame: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/features/canvas/ui/specialInterfaces/RelightSpecialEditor', () => ({
  RelightWorkbench: () => {
    renders.relight++
    const [view, setView] = useState(0)
    return <button onClick={() => setView(view + 1)}>灯位视图 {view}</button>
  },
}))
vi.mock('@/features/canvas/ui/specialInterfaces/multiAngle/MultiAngleSpecialEditor', () => ({
  MultiAngleWorkbench: () => {
    renders.multiAngle++
    const [view, setView] = useState(0)
    return <button onClick={() => setView(view + 1)}>相机视图 {view}</button>
  },
}))

import { RelightGenerationNode } from './RelightGenerationNode'
import { MultiAngleGenerationNode } from './MultiAngleGenerationNode'
import { DEFAULT_RELIGHT_SETTINGS } from '../capabilities/relightPolicy'
import { normalizeMultiAngleConfig } from '../capabilities/multiAnglePolicy'
import { useCanvasStore } from '@/stores/canvasStore'

afterEach(() => { cleanup(); renders.relight = 0; renders.multiAngle = 0 })
const common = {
  selected: false, dragging: false, zIndex: 0, isConnectable: true, selectable: true, deletable: true, draggable: true,
  positionAbsoluteX: 0, positionAbsoluteY: 0,
}

describe('功能节点选中态与渲染隔离', () => {
  it('打光从未选中开始也显示工作面，切换选中不重建、不刷新工作面', () => {
    const props: ComponentProps<typeof RelightGenerationNode> = { ...common, id: 'relight-selection', type: 'relightGenNode',
      data: { prompt: '', imageUrl: null, aspectRatio: 'auto', capabilityId: 'image.relight', relightSettings: DEFAULT_RELIGHT_SETTINGS,
        promptTemplateVersion: '', lightingReferenceImages: [] } }
    const view = render(<RelightGenerationNode {...props} selected={false} />)
    const control = screen.getByRole('button', { name: '灯位视图 0' })
    fireEvent.click(control)
    const before = renders.relight
    for (const selected of [true, false, true, false]) {
      view.rerender(<RelightGenerationNode {...props} selected={selected} />)
      expect(screen.getByRole('button', { name: '灯位视图 1' })).toBe(control)
    }
    expect(renders.relight).toBe(before)
  })
  it('多角度持续保留当前相机视图，其他节点选中不会刷新工作面', () => {
    const props: ComponentProps<typeof MultiAngleGenerationNode> = { ...common, id: 'angle-selection', type: 'multiAngleGenNode',
      data: { prompt: '', imageUrl: null, aspectRatio: 'auto', capabilityId: 'image.multi-angle', multiAngleConfig: normalizeMultiAngleConfig(undefined) } }
    const view = render(<MultiAngleGenerationNode {...props} selected={false} />)
    const control = screen.getByRole('button', { name: '相机视图 0' })
    fireEvent.click(control)
    const before = renders.multiAngle
    for (const selected of [true, false, true, false]) {
      view.rerender(<MultiAngleGenerationNode {...props} selected={selected} />)
      expect(screen.getByRole('button', { name: '相机视图 1' })).toBe(control)
    }
    useCanvasStore.getState().setSelectedNode('another-node')
    expect(renders.multiAngle).toBe(before)
  })
})
