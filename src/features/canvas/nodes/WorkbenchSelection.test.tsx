// @vitest-environment jsdom
import { useState, type ComponentProps, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const renders = vi.hoisted(() => ({ relight: 0, multiAngle: 0, frame: 0 }))
vi.mock('./shared/ToolWorkbenchNodeFrame', () => ({
  ToolWorkbenchNodeFrame: ({ children }: { children: ReactNode }) => { renders.frame++; return <div>{children}</div> },
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

afterEach(() => { cleanup(); renders.relight = 0; renders.multiAngle = 0; renders.frame = 0 })
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

import { nodeTypes } from './index'
it('正式节点注册入口隔离移动帧，仍响应选中、尺寸和工作面数据', () => {
  const RegisteredNode = nodeTypes.relightGenNode
  const props: ComponentProps<typeof RelightGenerationNode> = { ...common, id: 'relight-drag', type: 'relightGenNode',
    data: { prompt: '', imageUrl: null, aspectRatio: 'auto', capabilityId: 'image.relight', relightSettings: DEFAULT_RELIGHT_SETTINGS,
      promptTemplateVersion: '', lightingReferenceImages: [] } }
  const view = render(<RegisteredNode {...props} />)
  const before = renders.frame
  for (let x = 1; x <= 60; x++) view.rerender(<RegisteredNode {...props} positionAbsoluteX={x} dragging />)
  expect(renders.frame).toBe(before)
  view.rerender(<RegisteredNode {...props} selected />)
  expect(renders.frame).toBe(before + 1)
  view.rerender(<RegisteredNode {...props} selected width={900} />)
  expect(renders.frame).toBe(before + 2)
  const workbenchBefore = renders.relight
  view.rerender(<RegisteredNode {...props} selected data={{ ...props.data, relightSettings: { ...DEFAULT_RELIGHT_SETTINGS, manual: { ...DEFAULT_RELIGHT_SETTINGS.manual, extraPrompt: '新要求' } } }} />)
  expect(renders.relight).toBeGreaterThan(workbenchBefore)
})
