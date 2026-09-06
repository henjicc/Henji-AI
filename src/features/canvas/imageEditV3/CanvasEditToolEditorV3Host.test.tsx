/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useEffect, useRef, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditPersistenceSnapshotV3 } from '@/core/imageEdit/v3/serviceContracts'
import i18n from '@/i18n/config'
import { ImageEditCommandBusV3 } from '@/features/imageEdit/v3/application/imageEditCommandBus'
import { registerImageEditV3LiveSession } from '@/features/imageEdit/v3/application/imageEditLiveSessionRegistry'
import type { ImageEditPersistenceHostV3 } from '@/features/imageEdit/v3/application/imageEditPersistenceOwner'
import { createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { MultiLayerDocumentNodeApplicationError } from '../application/multiLayerDocumentNodeApplicationContracts'
import {
  CanvasEditToolEditorV3Host,
  type CanvasEditToolEditorV3Lifecycle,
} from './CanvasEditToolEditorV3Host'

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  save: vi.fn(),
  live: false,
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
    persistenceHost,
  }: {
    document: ImageEditDocumentV3
    profileId: string
    onPersistenceChange: (snapshot: ImageEditPersistenceSnapshotV3) => void
    toolbarActions?: ReactNode
    persistenceHost?: ImageEditPersistenceHostV3
  }) => {
    const bus = useRef(new ImageEditCommandBusV3(document)).current
    useEffect(() => mocks.live
      ? registerImageEditV3LiveSession('test-host', bus, persistenceHost) : undefined, [bus, persistenceHost])
    const edit = (revision: number): void => {
      if (!mocks.live) { onPersistenceChange(persistence({ ...document, revision })); return }
      bus.dispatch({ type: 'layer.add', commandId: `add-${revision}`,
        expectedRevision: bus.getSnapshot().document.revision, parentId: null, index: 0,
        layer: createImageEditRasterLayerV3(`layer-${revision}`, '测试图层') })
      onPersistenceChange(bus.getPersistenceSnapshot())
    }
    return (
    <div data-testid="shared-v3-editor" data-profile={profileId}>
      {toolbarActions}
      <button
        type="button"
        onClick={() => edit(1)}
      >
        persist-one
      </button>
      <button
        type="button"
        onClick={() => edit(2)}
      >
        persist-two
      </button>
    </div>
    )
  },
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
    mocks.live = false
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

  it('允许文档节点先校验权威引用，并由关闭协议立即 flush 未到期防抖', async () => {
    const validatedSession = {
      kind: 'image-edit-v3' as const,
      sourceUrl: 'source.png',
      documentRef: 'image-edit-v3:canvas-host' as const,
      revision: 0,
      previewRef: null,
    }
    const beforePrepare = vi.fn(async () => validatedSession)
    let lifecycle: CanvasEditToolEditorV3Lifecycle | null = null
    render(
      <CanvasEditToolEditorV3Host
        plugin={{} as never}
        options={{ legacy: true }}
        sourceImageUrl="source.png"
        onOptionsChange={vi.fn()}
        beforePrepare={beforePrepare}
        onLifecycleChange={(next) => { lifecycle = next }}
      />,
    )
    await act(async () => { await Promise.resolve() })
    expect(beforePrepare).toHaveBeenCalledOnce()
    expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({
      toolOptions: expect.objectContaining({
        imageEditSession: JSON.stringify(validatedSession),
      }),
    }))

    fireEvent.click(screen.getByRole('button', { name: 'persist-one' }))
    await act(async () => {
      await lifecycle?.flushPending()
    })

    expect(mocks.save).toHaveBeenCalledOnce()
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 1 }),
      expect.objectContaining({ expectedRevision: 0 }),
    )
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

  it('节点同步失败只显示一个准确入口；重试成功清除提示且不重复编辑或保存', async () => {
    mocks.live = true
    const confirm = vi.fn().mockRejectedValueOnce(new Error('预览写入失败')).mockResolvedValue(undefined)
    let lifecycle: CanvasEditToolEditorV3Lifecycle | null = null
    render(<CanvasEditToolEditorV3Host plugin={{} as never} options={{}} sourceImageUrl="source.png"
      onOptionsChange={vi.fn()} onPersistenceConfirmed={confirm}
      onLifecycleChange={(next) => { lifecycle = next }} />)
    await act(async () => { await Promise.resolve() })
    fireEvent.click(screen.getByRole('button', { name: 'persist-one' }))
    await act(async () => { await expect(lifecycle!.confirmPending()).rejects.toThrow('保存未确认') })
    expect(mocks.save).toHaveBeenCalledOnce()
    expect(screen.getAllByRole('button', { name: '节点同步失败，重试' })).toHaveLength(1)
    expect(screen.queryByText('保存失败，重试关闭')).toBeNull()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '节点同步失败，重试' })) })
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(mocks.save).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: '节点同步失败，重试' })).toBeNull()
  })

  it('节点变化的提示不会被后续文档落盘清掉，也不会混称文件保存失败', async () => {
    mocks.live = true
    const confirm = vi.fn().mockRejectedValue(new MultiLayerDocumentNodeApplicationError(
      'NODE_TARGET_CHANGED', '原节点已变化', true))
    let lifecycle: CanvasEditToolEditorV3Lifecycle | null = null
    render(<CanvasEditToolEditorV3Host plugin={{} as never} options={{}} sourceImageUrl="source.png"
      onOptionsChange={vi.fn()} onPersistenceConfirmed={confirm}
      onLifecycleChange={(next) => { lifecycle = next }} />)
    await act(async () => { await Promise.resolve() })
    fireEvent.click(screen.getByRole('button', { name: 'persist-one' }))
    await act(async () => { await expect(lifecycle!.confirmPending()).rejects.toThrow('保存未确认') })
    const retry = screen.getByRole('button', { name: '原节点已变化，重试同步' })
    expect(retry.title).toContain('图片内容已保存')
    let resolveSave!: (value: { documentId: string; revision: number; previewRef: null }) => void
    mocks.save.mockImplementationOnce(() => new Promise((resolve) => { resolveSave = resolve }))
    fireEvent.click(screen.getByRole('button', { name: 'persist-two' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(screen.getByRole('button', { name: '原节点已变化，重试同步' })).toHaveProperty('disabled', true)
    await act(async () => { resolveSave({ documentId: 'canvas-host', revision: 2, previewRef: null }) })
    expect(screen.getByRole('button', { name: '原节点已变化，重试同步' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '保存失败，重试' })).toBeNull()
  })
})
