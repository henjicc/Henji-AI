/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditPersistenceSnapshotV3 } from '@/core/imageEdit/v3/serviceContracts'
import i18n from '@/i18n/config'
import { CanvasEditToolEditorV3Host } from './CanvasEditToolEditorV3Host'

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  save: vi.fn(),
}))

vi.mock('./canvasEditV3Session', async () => {
  const actual = await vi.importActual<typeof import('./canvasEditV3Session')>(
    './canvasEditV3Session',
  )
  return {
    ...actual,
    createCanvasEditV3Repository: () => ({ save: mocks.save }),
    prepareCanvasEditV3Session: mocks.prepare,
  }
})

function persistence(document: ImageEditDocumentV3): ImageEditPersistenceSnapshotV3 {
  return {
    document,
    history: {
      version: 1,
      documentId: document.id,
      headRevision: document.revision,
      undo: [],
      redo: [],
    },
    retainedResources: [],
  }
}

vi.mock('@/features/imageEdit/v3/editor', () => ({
  ImageEditorV3: ({
    document,
    profileId,
    onPersistenceChange,
    toolbarActions,
  }: {
    document: ImageEditDocumentV3
    profileId: string
    onPersistenceChange: (snapshot: ImageEditPersistenceSnapshotV3) => void
    toolbarActions?: ReactNode
  }) => (
    <div data-testid="shared-v3-editor" data-profile={profileId}>
      {toolbarActions}
      <button
        type="button"
        onClick={() => onPersistenceChange(persistence({ ...document, revision: 1 }))}
      >
        persist-one
      </button>
      <button
        type="button"
        onClick={() => onPersistenceChange(persistence({ ...document, revision: 2 }))}
      >
        persist-two
      </button>
    </div>
  ),
}))

const initialDocument = createImageEditDocumentV3({
  width: 640,
  height: 480,
  documentId: 'canvas-host',
})

describe('CanvasEditToolEditorV3Host', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    vi.useFakeTimers()
    mocks.save.mockReset().mockImplementation(async (document: ImageEditDocumentV3) => ({
      documentId: document.id,
      revision: document.revision,
      previewRef: null,
    }))
    mocks.prepare.mockReset().mockResolvedValue({
      sourceUrl: 'source.png',
      document: initialDocument,
      history: persistence(initialDocument).history,
      persistence: persistence(initialDocument),
      reference: { documentId: initialDocument.id, revision: 0, previewRef: null },
      resourceByteSizes: {},
      resourceDescriptors: [],
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('使用 canvas-edit profile，初始化后只发布稳定会话引用', async () => {
    const onOptionsChange = vi.fn()
    const onExecutionReadyChange = vi.fn()
    render(
      <CanvasEditToolEditorV3Host
        plugin={{} as never}
        options={{ document: 'legacy', markDoc: 'legacy-mark' }}
        sourceImageUrl="source.png"
        onOptionsChange={onOptionsChange}
        onExecutionReadyChange={onExecutionReadyChange}
      />,
    )

    await act(async () => { await Promise.resolve() })
    expect(screen.getByTestId('shared-v3-editor').getAttribute('data-profile')).toBe('canvas-edit')
    expect(onOptionsChange).toHaveBeenLastCalledWith({
      imageEditSession: JSON.stringify({
        kind: 'image-edit-v3',
        sourceUrl: 'source.png',
        documentRef: 'image-edit-v3:canvas-host',
        revision: 0,
        previewRef: null,
      }),
    })
    expect(onExecutionReadyChange).toHaveBeenLastCalledWith(true)
  })

  it('500ms 防抖并以 latest-only 保存最后一个持久命令，期间禁止外层执行', async () => {
    const onOptionsChange = vi.fn()
    const onExecutionReadyChange = vi.fn()
    render(
      <CanvasEditToolEditorV3Host
        plugin={{} as never}
        options={{}}
        sourceImageUrl="source.png"
        onOptionsChange={onOptionsChange}
        onExecutionReadyChange={onExecutionReadyChange}
      />,
    )
    await act(async () => { await Promise.resolve() })
    onOptionsChange.mockClear()
    onExecutionReadyChange.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'persist-one' }))
    expect(onExecutionReadyChange).toHaveBeenLastCalledWith(false)
    await act(async () => { vi.advanceTimersByTime(499) })
    expect(mocks.save).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'persist-two' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
      await Promise.resolve()
    })
    expect(mocks.save).toHaveBeenCalledOnce()
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'canvas-host', revision: 2 }),
      expect.objectContaining({ expectedRevision: 0, previewRef: null }),
    )
    expect(onOptionsChange).toHaveBeenCalledOnce()
    expect(JSON.parse(onOptionsChange.mock.calls[0][0].imageEditSession)).toMatchObject({
      documentRef: 'image-edit-v3:canvas-host',
      revision: 2,
    })
    expect(onExecutionReadyChange).toHaveBeenLastCalledWith(true)
  })

  it('保存期间出现新 revision 时不发布过期引用，并从最新命令重新计时', async () => {
    let resolveFirstSave: ((reference: {
      documentId: string
      revision: number
      previewRef: null
    }) => void) | undefined
    mocks.save
      .mockReset()
      .mockImplementationOnce((document: ImageEditDocumentV3) => new Promise((resolve) => {
        resolveFirstSave = resolve
        expect(document.revision).toBe(1)
      }))
      .mockImplementation(async (document: ImageEditDocumentV3) => ({
        documentId: document.id,
        revision: document.revision,
        previewRef: null,
      }))
    const onOptionsChange = vi.fn()
    const onExecutionReadyChange = vi.fn()
    render(
      <CanvasEditToolEditorV3Host
        plugin={{} as never}
        options={{}}
        sourceImageUrl="source.png"
        onOptionsChange={onOptionsChange}
        onExecutionReadyChange={onExecutionReadyChange}
      />,
    )
    await act(async () => { await Promise.resolve() })
    onOptionsChange.mockClear()
    onExecutionReadyChange.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'persist-one' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(mocks.save).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'persist-two' }))
    await act(async () => {
      resolveFirstSave?.({ documentId: 'canvas-host', revision: 1, previewRef: null })
      await Promise.resolve()
    })
    expect(onOptionsChange).not.toHaveBeenCalled()
    expect(onExecutionReadyChange).toHaveBeenLastCalledWith(false)

    await act(async () => { await vi.advanceTimersByTimeAsync(499) })
    expect(mocks.save).toHaveBeenCalledOnce()
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(mocks.save).toHaveBeenCalledTimes(2)
    expect(JSON.parse(onOptionsChange.mock.calls[0][0].imageEditSession)).toMatchObject({
      revision: 2,
    })
    expect(onExecutionReadyChange).toHaveBeenLastCalledWith(true)
  })
})
