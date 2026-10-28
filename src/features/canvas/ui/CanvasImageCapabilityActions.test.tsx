/** @vitest-environment jsdom */

import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  CANVAS_IMAGE_CAPABILITY_IDS,
  getCanvasImageCapability,
} from '@/features/canvas/capabilities'
import { CANVAS_NODE_TYPES, NODE_TOOL_TYPES, type CanvasNode } from '@/features/canvas/domain/canvasNodes'
import { getNodeToolPlugins } from '@/features/canvas/tools'

import {
  CanvasImageCapabilityActions,
} from './CanvasImageCapabilityActions'
import {
  excludeClaimedLocalTools,
  resolveCanvasImageCapabilityActionsForSourceNode,
  type CanvasImageCapabilityAction,
} from './canvasImageCapabilityLayout'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key }),
  }
})

beforeAll(() => {
  Object.defineProperty(window, 'requestAnimationFrame', {
    configurable: true,
    value: (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    },
  })
  Object.defineProperty(window, 'ResizeObserver', {
    configurable: true,
    value: class {
      observe(): void {}
      disconnect(): void {}
    },
  })
})

afterEach(() => {
  cleanup()
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
})

function enabledAction(capabilityId: (typeof CANVAS_IMAGE_CAPABILITY_IDS)[keyof typeof CANVAS_IMAGE_CAPABILITY_IDS]): CanvasImageCapabilityAction {
  const capability = getCanvasImageCapability(capabilityId)
  if (!capability) throw new Error(`缺少能力：${capabilityId}`)
  return { capability, disabledReasonKey: null }
}

describe('画布图片能力工具条入口', () => {
  it('只有一项能力时直接显示，不产生多余的更多入口', () => {
    const capability = getCanvasImageCapability(CANVAS_IMAGE_CAPABILITY_IDS.gridSplit)
    if (!capability) throw new Error('缺少宫格切分能力')
    const onExecute = vi.fn()
    const rendered = render(
      <CanvasImageCapabilityActions
        actions={[{ capability, disabledReasonKey: null }]}
        pendingCapabilityId={null}
        onExecute={onExecute}
      />,
    )

    fireEvent.click(rendered.getByRole('button', { name: capability.titleKey }))
    expect(onExecute).toHaveBeenCalledWith(capability.id)
    expect(rendered.queryByRole('button', { name: 'nodeToolbar.moreImageCapabilities' })).toBeNull()
  })

  it('执行中禁用所有能力入口，阻止重复触发', () => {
    const onExecute = vi.fn()
    const capability = getCanvasImageCapability(CANVAS_IMAGE_CAPABILITY_IDS.gridSplit)
    if (!capability) throw new Error('缺少宫格切分能力')
    const rendered = render(
      <CanvasImageCapabilityActions
        actions={[{ capability, disabledReasonKey: null }]}
        pendingCapabilityId={capability.id}
        onExecute={onExecute}
      />,
    )

    const button = rendered.getByRole('button', { name: capability.titleKey })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(button)
    expect(onExecute).not.toHaveBeenCalled()
  })

  it('能力目录接管同一本地工具后只保留一个入口', () => {
    const sourceNode: CanvasNode = {
      id: 'image-source',
      type: CANVAS_NODE_TYPES.upload,
      position: { x: 0, y: 0 },
      data: { imageUrl: 'managed-source.png', aspectRatio: '1:1' },
    }
    const actions = resolveCanvasImageCapabilityActionsForSourceNode(sourceNode)
    const remainingTools = excludeClaimedLocalTools(
      getNodeToolPlugins(sourceNode),
      actions.map(({ capability }) => capability),
    )

    expect(actions.map(({ capability }) => capability.id))
      .toContain(CANVAS_IMAGE_CAPABILITY_IDS.gridSplit)
    expect(remainingTools.map(({ type }) => type)).toContain(NODE_TOOL_TYPES.edit)
    expect(remainingTools.map(({ type }) => type)).not.toContain(NODE_TOOL_TYPES.splitStoryboard)
  })

  it('更多菜单暴露描述、实验状态与完整键盘导航', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 960 })
    const actions = [
      enabledAction(CANVAS_IMAGE_CAPABILITY_IDS.elementEdit),
      enabledAction(CANVAS_IMAGE_CAPABILITY_IDS.upscale),
      enabledAction(CANVAS_IMAGE_CAPABILITY_IDS.relight),
      enabledAction(CANVAS_IMAGE_CAPABILITY_IDS.multiAngle),
      enabledAction(CANVAS_IMAGE_CAPABILITY_IDS.gridSplit),
    ]
    const rendered = render(
      <CanvasImageCapabilityActions
        actions={actions}
        pendingCapabilityId={null}
        onExecute={vi.fn()}
      />,
    )
    const more = rendered.getByRole('button', { name: 'nodeToolbar.moreImageCapabilities' })

    fireEvent.click(more)
    const menu = rendered.getByRole('menu', { name: 'nodeToolbar.moreImageCapabilities' })
    const items = rendered.getAllByRole('menuitem')
    expect(document.activeElement).toBe(items[0])
    expect(rendered.getByText('imageCapabilities.groups.transformation')).toBeTruthy()
    expect(rendered.getByText('imageCapabilities.groups.structure')).toBeTruthy()
    expect(rendered.getByText('imageCapabilities.groups.local')).toBeTruthy()
    expect(rendered.getByText('imageCapabilities.status.experimental')).toBeTruthy()
    expect(menu.textContent).toContain('imageCapabilities.items.relight.description')

    fireEvent.keyDown(menu, { key: 'End' })
    expect(document.activeElement).toBe(items.at(-1))
    fireEvent.keyDown(menu, { key: 'Home' })
    expect(document.activeElement).toBe(items[0])
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(items.at(-1))
  })

  it('禁用项保持可聚焦并展示用户可处理的原因，但不会触发执行', () => {
    const sourceNode: CanvasNode = {
      id: 'empty-image',
      type: CANVAS_NODE_TYPES.upload,
      position: { x: 0, y: 0 },
      data: { imageUrl: '', aspectRatio: '1:1' },
    }
    const onExecute = vi.fn()
    const rendered = render(
      <CanvasImageCapabilityActions
        actions={resolveCanvasImageCapabilityActionsForSourceNode(sourceNode)}
        pendingCapabilityId={null}
        onExecute={onExecute}
      />,
    )

    fireEvent.click(rendered.getByRole('button', { name: 'nodeToolbar.moreImageCapabilities' }))
    const firstItem = rendered.getAllByRole('menuitem')[0]
    expect(firstItem.getAttribute('aria-disabled')).toBe('true')
    expect(rendered.getAllByText('imageCapabilities.unavailable.sourceNotReady').length)
      .toBeGreaterThan(0)
    fireEvent.click(firstItem)
    expect(onExecute).not.toHaveBeenCalled()
  })
})
