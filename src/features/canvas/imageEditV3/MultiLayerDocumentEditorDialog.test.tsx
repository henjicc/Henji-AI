/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, useRef, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { runApplicationCloseGuards } from '@/core/applicationLifecycle/applicationCloseGuards'
import {
  createImageEditDocumentV3,
  createImageEditRasterLayerV3,
} from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import { canvasEventBus } from '@/features/canvas/application/canvasServices'
import { CANVAS_NODE_TYPES, type CanvasNode } from '@/features/canvas/domain/canvasNodes'
import i18n from '@/i18n/config'
import { useImageEditorSessionStoreV3 } from '@/features/imageEdit/v3/store/imageEditorSessionStoreV3'
import { useProjectStore } from '@/stores/projectStore'
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
  exportTarget: vi.fn(),
  registerSession: vi.fn(() => vi.fn()),
}))

vi.mock('@/features/canvas/application/multiLayerDocumentNodeGenerationAdapter', () => ({
  openMultiLayerDocumentForEditing: mocks.openAndValidate,
  exportMultiLayerDocumentTargetToCanvas: mocks.exportTarget,
  registerMultiLayerDocumentExportSession: mocks.registerSession,
}))

const editorDocument: ImageEditDocumentV3 = {
  ...createImageEditDocumentV3({ width: 640, height: 480, documentId: 'multi-layer-document' }),
  layers: [createImageEditRasterLayerV3('raster-a', '图层 A')],
}

vi.mock('./CanvasEditToolEditorV3Host', () => ({
  CanvasEditToolEditorV3Host: (props: {
    beforePrepare?: (signal: AbortSignal) => Promise<typeof session>
    onLifecycleChange?: (lifecycle: { flushPending: () => Promise<typeof session> } | null) => void
    onBootstrapKindChange?: (kind: 'loading' | 'failed' | 'ready') => void
    onEditorContextChange?: (context: { sessionId: string; document: ImageEditDocumentV3 } | null) => void
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
        mountedProps.onEditorContextChange?.({ sessionId: 'editor-session', document: editorDocument })
      })
      return () => {
        controller.abort()
        mountedProps.onLifecycleChange?.(null)
        mountedProps.onEditorContextChange?.(null)
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
    mocks.exportTarget.mockReset().mockResolvedValue({
      nodeRef: { kind: 'canvas.node', id: 'exported' },
      edgeRef: { kind: 'canvas.edge', id: 'edge-exported' },
    })
    mocks.registerSession.mockClear()
    useProjectStore.setState({
      currentProjectId: 'project-a',
      currentProject: { id: 'project-a' } as never,
    })
    useImageEditorSessionStoreV3.setState({ sessions: {} })
    useImageEditorSessionStoreV3.getState().ensureSession('editor-session', ['move'], 'raster-a')
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

  it('恰好选择一个栅格图层时导出到画布，重复点击被抑制且编辑器保持打开', async () => {
    let resolveExport: (() => void) | null = null
    mocks.exportTarget.mockImplementationOnce(() => new Promise((resolve) => {
      resolveExport = () => resolve({
        nodeRef: { kind: 'canvas.node', id: 'exported' },
        edgeRef: { kind: 'canvas.edge', id: 'edge-exported' },
      })
    }))
    render(<MultiLayerDocumentEditorDialog isOpen node={documentNode()} />)
    const button = await screen.findByRole('button', { name: '导出到画布' })

    fireEvent.click(button)
    fireEvent.click(button)
    expect(mocks.exportTarget).toHaveBeenCalledOnce()
    expect(mocks.exportTarget).toHaveBeenCalledWith(expect.objectContaining({
      projectRef: { kind: 'canvas.project', id: 'project-a' },
      sourceNodeRef: { kind: 'canvas.node', id: 'multi-layer-node' },
      targetRef: expect.objectContaining({ kind: 'image_edit.layer' }),
    }))
    expect(screen.getByRole('dialog')).toBeTruthy()

    await act(async () => resolveExport?.())
    expect(await screen.findByRole('button', { name: '导出到画布' })).toBeTruthy()
  })

  it('没有唯一支持目标时按钮禁用并显示用户态原因', async () => {
    useImageEditorSessionStoreV3.getState().setSelectedLayerIds('editor-session', [])
    render(<MultiLayerDocumentEditorDialog isOpen node={documentNode()} />)
    const button = await screen.findByRole('button', { name: '导出到画布' })
    expect(button).toHaveProperty('disabled', true)
    expect(button.getAttribute('title')).toBe('请先选择一个图层或元素')
  })
})
