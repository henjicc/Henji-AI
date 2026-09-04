/** @vitest-environment jsdom */

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ImageEditorRenderSessionV3 } from '../execution/imageEditorRenderSessionV3'
import { ImageEditorViewportTilesV3 } from './ImageEditorViewportTilesV3'

describe('图片编辑 V3 常驻显示表面', () => {
  afterEach(cleanup)

  it('只挂载固定稳定双表面与唯一GPU表面，并交给同一个 RenderSession', () => {
    const detach = vi.fn()
    let attached: Parameters<ImageEditorRenderSessionV3['attachSurface']>[0] | null = null
    const attachSurface: ImageEditorRenderSessionV3['attachSurface'] = (elements) => {
      attached = elements
      return detach
    }
    const updateViewport = vi.fn()
    const session = {
      attachSurface,
      updateViewport,
      updateSnapshot: vi.fn(),
      updateTransientLayerTransform: vi.fn(),
      clearTransientLayerTransform: vi.fn(),
      requestFrame: vi.fn(),
      subscribeDiagnostics: vi.fn(),
      setVisibility: vi.fn(),
      dispose: vi.fn(),
    } satisfies ImageEditorRenderSessionV3
    const layout = {
      stageWidth: 800,
      stageHeight: 400,
      viewportKey: 'viewport',
      viewport: {
        documentX: 0,
        documentY: 0,
        width: 800,
        height: 600,
        zoom: 0.8,
        devicePixelRatio: 1,
      },
    }
    const rendered = render(
      <ImageEditorViewportTilesV3 session={session} layout={layout} label="预览" />,
    )

    expect(rendered.container.querySelectorAll('canvas')).toHaveLength(3)
    expect(attached).not.toBeNull()
    expect(attached!.front.dataset.presentationFrontSurface).toBe('true')
    expect(attached!.safety.dataset.presentationSafetySurface).toBe('true')
    expect(attached!.gpu?.dataset.presentationGpuSurface).toBe('true')
    expect(updateViewport).toHaveBeenCalledWith(layout)

    rendered.rerender(
      <ImageEditorViewportTilesV3 session={session} layout={layout} label="预览" />,
    )
    expect(attached).not.toBeNull()
    rendered.unmount()
    expect(detach).toHaveBeenCalledOnce()
  })
})
