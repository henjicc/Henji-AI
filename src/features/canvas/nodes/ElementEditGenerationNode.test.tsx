// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'

import type { GenerationNodeShellProps } from './shared/generationNodeShellTypes'
import type { LocalRedrawWorkbenchStage } from './localRedraw/LocalRedrawWorkbenchStage'

const state = vi.hoisted(() => ({ images: ['/managed/source.png'] }))

vi.mock('./shared/GenerationNodeShell', () => ({
  GenerationNodeShell: ({ workbenchStage }: GenerationNodeShellProps) => (
    <>{typeof workbenchStage === 'function'
      ? workbenchStage({ images: state.images, videos: [], audios: [] })
      : workbenchStage}</>
  ),
}))
vi.mock('./localRedraw/LocalRedrawWorkbenchStage', () => ({
  LocalRedrawWorkbenchStage: ({ sourceImage, initialDocument }: ComponentProps<typeof LocalRedrawWorkbenchStage>) => (
    <div data-testid="mask-editor" data-source={sourceImage} data-strokes={initialDocument?.strokes.length} />
  ),
}))
vi.mock('@/features/canvas/application/imageData', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/features/canvas/application/imageData')>(),
  resolveImageDisplayUrl: (source: string) => `henji-media://local${source}`,
}))

import { ElementEditGenerationNode } from './ElementEditGenerationNode'
import { elementEditGenerationNodeDefinition } from '../domain/nodeRegistryCapabilityDefinitions'

afterEach(() => {
  cleanup()
  state.images = ['/managed/source.png']
})

function nodeProps(selected: boolean): ComponentProps<typeof ElementEditGenerationNode> {
  return {
    id: 'redraw', type: 'elementEditGenNode', selected,
    dragging: false, zIndex: 0, isConnectable: true,
    selectable: true, deletable: true, draggable: true,
    positionAbsoluteX: 0, positionAbsoluteY: 0,
    data: {
      ...elementEditGenerationNodeDefinition.createDefaultData(),
      localRedrawMaskDocument: {
        version: 1, sourceRef: '/managed/source.png', width: 640, height: 480,
        strokes: [{ id: 'stroke-1', kind: 'stroke', mode: 'paint', size: 24, points: [{ x: 80, y: 90 }] }],
      },
    },
  }
}

describe('局部重绘工作面选中状态切换', () => {
  it('选中结果后仍显示源图，再选中操作节点时恢复原遮罩', () => {
    const { rerender } = render(<ElementEditGenerationNode {...nodeProps(true)} />)
    expect(screen.getByTestId('mask-editor').getAttribute('data-strokes')).toBe('1')

    rerender(<ElementEditGenerationNode {...nodeProps(false)} />)
    expect(screen.queryByTestId('mask-editor')).toBeNull()
    expect(screen.getByRole('img').getAttribute('src')).toBe('henji-media://local/managed/source.png')

    rerender(<ElementEditGenerationNode {...nodeProps(true)} />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByTestId('mask-editor').getAttribute('data-source')).toBe('/managed/source.png')
    expect(screen.getByTestId('mask-editor').getAttribute('data-strokes')).toBe('1')
  })

  it('输入图断开时显示缺少输入的提示，不挂载空编辑器', () => {
    state.images = []
    const { container } = render(<ElementEditGenerationNode {...nodeProps(true)} />)
    expect(screen.queryByTestId('mask-editor')).toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
    expect(container.textContent?.trim()).toBeTruthy()
  })
})
