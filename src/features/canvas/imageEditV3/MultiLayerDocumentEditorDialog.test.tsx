/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, useRef, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { runApplicationCloseGuards } from '@/core/applicationLifecycle/applicationCloseGuards'
import { canvasEventBus } from '@/features/canvas/application/canvasServices'
import { CANVAS_NODE_TYPES, type CanvasNode } from '@/features/canvas/domain/canvasNodes'
import i18n from '@/i18n/config'
import { MultiLayerDocumentEditorDialog } from './MultiLayerDocumentEditorDialog'

const session = {
  kind: 'image-edit-v3' as const,
  sourceUrl: 'henji-media://multi-layer/composite.png',
  documentRef: 'image-edit-v3:multi-layer-document' as const,
  revision: 4,
  previewRef: null,
}

const mocks = vi.hoisted(() => ({
  flush: vi.fn(),
  openAndValidate: vi.fn(),
}))

vi.mock('@/features/canvas/application/multiLayerDocumentNodeGenerationAdapter', () => ({
  openMultiLayerDocumentForEditing: mocks.openAndValidate,
}))

vi.mock('./CanvasEditToolEditorV3Host', () => ({
  CanvasEditToolEditorV3Host: (props: {
    beforePrepare?: (signal: AbortSignal) => Promise<typeof session>
    onLifecycleChange?: (lifecycle: { flushPending: () => Promise<typeof session> } | null) => void
    onBootstrapKindChange?: (kind: 'loading' | 'failed' | 'ready') => void
    toolbarLeading?: ReactNode
    toolbarActions?: ReactNode
  }) => {
    const initialProps = useRef(props)
    useEffect(() => {
      const mountedProps = initialProps.current
      const controller = new AbortController()
      void mountedProps.beforePrepare?.(controller.signal).then(() => {
        mountedProps.onBootstrapKindChange?.('ready')
        mountedProps.onLifecycleChange?.({ flushPending: mocks.flush })
      })
      return () => {
        controller.abort()
        mountedProps.onLifecycleChange?.(null)
      }
    }, [])
    return <div>{props.toolbarLeading}{props.toolbarActions}</div>
  },
}))

function documentNode(): CanvasNode {
  return {
    id: 'multi-layer-node',
    type: CANVAS_NODE_TYPES.layerStackResult,
    position: { x: 0, y: 0 },
    data: {
      resultKind: 'layer-stack',
      imageUrl: session.sourceUrl,
      previewImageUrl: 'henji-media://multi-layer/preview.webp',
      aspectRatio: '2:1',
      imageEditSession: session,
    },
  }
}

describe('MultiLayerDocumentEditorDialog', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    mocks.flush.mockReset().mockResolvedValue(session)
    mocks.openAndValidate.mockReset().mockResolvedValue(session)
  })

  afterEach(() => cleanup())

  it.each([
    ['命令带关闭按钮', async () => {
      fireEvent.click(screen.getByRole('button', { name: '关闭编辑器' }))
    }],
    ['Escape', async () => {
      fireEvent.keyDown(document, { key: 'Escape' })
    }],
    ['遮罩', async () => {
      const scrim = document.querySelector<HTMLElement>('.ui-glass-scrim')
      if (!scrim) throw new Error('missing modal scrim')
      fireEvent.click(scrim)
    }],
  ])('%s 都等待同一 flush 后关闭', async (_label, close) => {
    const closed: unknown[] = []
    const unsubscribe = canvasEventBus.subscribe('tool-dialog/close', (payload) => closed.push(payload))
    const continuation = vi.fn(async () => undefined)
    render(
      <MultiLayerDocumentEditorDialog
        isOpen
        node={documentNode()}
        onCloseReady={continuation}
      />,
    )
    await waitFor(() => expect(mocks.openAndValidate).toHaveBeenCalledOnce())

    await close()

    await waitFor(() => expect(closed).toHaveLength(1))
    expect(mocks.flush).toHaveBeenCalledOnce()
    expect(continuation).toHaveBeenCalledWith({ nodeId: 'multi-layer-node', session })
    unsubscribe()
  })

  it('保存失败时保持打开并允许重试关闭', async () => {
    mocks.flush.mockRejectedValueOnce(new Error('disk unavailable')).mockResolvedValueOnce(session)
    const closed: unknown[] = []
    const unsubscribe = canvasEventBus.subscribe('tool-dialog/close', (payload) => closed.push(payload))
    render(<MultiLayerDocumentEditorDialog isOpen node={documentNode()} />)
    await waitFor(() => expect(mocks.openAndValidate).toHaveBeenCalledOnce())

    fireEvent.click(screen.getByRole('button', { name: '关闭编辑器' }))
    expect(await screen.findByRole('button', { name: '保存失败，重试关闭' })).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(closed).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: '保存失败，重试关闭' }))
    await waitFor(() => expect(closed).toHaveLength(1))
    expect(mocks.flush).toHaveBeenCalledTimes(2)
    unsubscribe()
  })

  it('重复关闭请求复用同一个进行中的 Promise', async () => {
    let resolveFlush: ((value: typeof session) => void) | null = null
    mocks.flush.mockImplementationOnce(() => new Promise((resolve) => {
      resolveFlush = resolve
    }))
    const closed: unknown[] = []
    const unsubscribe = canvasEventBus.subscribe('tool-dialog/close', (payload) => closed.push(payload))
    render(<MultiLayerDocumentEditorDialog isOpen node={documentNode()} />)
    await waitFor(() => expect(mocks.openAndValidate).toHaveBeenCalledOnce())

    fireEvent.click(screen.getByRole('button', { name: '关闭编辑器' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(mocks.flush).toHaveBeenCalledOnce()
    await act(async () => resolveFlush?.(session))

    await waitFor(() => expect(closed).toHaveLength(1))
    unsubscribe()
  })

  it('窗口级关闭守卫也等待同一保存协议', async () => {
    const closed: unknown[] = []
    const unsubscribe = canvasEventBus.subscribe('tool-dialog/close', (payload) => closed.push(payload))
    render(<MultiLayerDocumentEditorDialog isOpen node={documentNode()} />)
    await waitFor(() => expect(mocks.openAndValidate).toHaveBeenCalledOnce())

    await runApplicationCloseGuards()

    expect(mocks.flush).toHaveBeenCalledOnce()
    expect(closed).toHaveLength(1)
    unsubscribe()
  })
})
