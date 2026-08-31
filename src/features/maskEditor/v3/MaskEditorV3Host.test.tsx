/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createImageEditDocumentV3,
  createImageEditRasterLayerV3,
} from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditPersistenceSnapshotV3 } from '@/core/imageEdit/v3/serviceContracts'
import type { ImageEditSessionReferenceV3 } from '@/core/imageEdit/v3/sessionReference'
import type { ImageEditorV3DocumentSnapshot } from '@/platform/contracts/imageEditorV3'
import {
  MaskEditorV3Host,
  type MaskEditorV3HostHandle,
} from './MaskEditorV3Host'

const editorProps = vi.hoisted(() => ({ current: null as null | {
  profileId: string
  initialSelectedLayerId?: string
  initialToolId?: string
  onPersistenceChange?: (snapshot: ImageEditPersistenceSnapshotV3) => void
} }))

vi.mock('@/features/imageEdit/v3/editor', () => ({
  ImageEditorV3: (props: typeof editorProps.current) => {
    editorProps.current = props
    return (
      <div data-testid="v3-mask-editor">
        <button
          type="button"
          onClick={() => props?.onPersistenceChange?.(persistence(1))}
        >
          revision 1
        </button>
        <button
          type="button"
          onClick={() => props?.onPersistenceChange?.(persistence(2))}
        >
          revision 2
        </button>
      </div>
    )
  },
}))

function document(revision = 0): ImageEditDocumentV3 {
  const value = createImageEditDocumentV3({ width: 64, height: 64, documentId: 'mask-doc' })
  value.revision = revision
  value.layers = [createImageEditRasterLayerV3('mask-target', '目标')]
  return value
}

function persistence(revision: number): ImageEditPersistenceSnapshotV3 {
  return {
    document: document(revision),
    history: {
      version: 1,
      documentId: 'mask-doc',
      headRevision: revision,
      undo: [],
      redo: [],
    },
    retainedResources: [],
  }
}

const session: ImageEditSessionReferenceV3 = {
  kind: 'image-edit-v3',
  sourceUrl: 'managed://source',
  documentRef: 'image-edit-v3:mask-doc',
  revision: 0,
  previewRef: null,
}

function snapshot(revision = 0): ImageEditorV3DocumentSnapshot {
  return {
    documentRef: 'image-edit-v3:mask-doc',
    revision,
    previewRef: null,
    document: document(revision),
    history: null,
    resourceRefs: [],
    resources: [],
    sourceFingerprint: `sha256:${'a'.repeat(64)}`,
  }
}

describe('MaskEditorV3Host', () => {
  beforeEach(() => {
    editorProps.current = null
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('只接受同 source/ref/revision 的权威快照并以 mask profile 打开目标图层', async () => {
    const loadSnapshot = vi.fn(async () => snapshot())
    const save = vi.fn()
    const ref = createRef<MaskEditorV3HostHandle>()
    render(
      <MaskEditorV3Host
        ref={ref}
        sourceImageUrl="managed://source"
        sessionReference={session}
        targetLayerId="mask-target"
        loadSnapshot={loadSnapshot}
        repository={{ save }}
      />,
    )

    await screen.findByTestId('v3-mask-editor')
    expect(editorProps.current).toMatchObject({
      profileId: 'mask',
      initialSelectedLayerId: 'mask-target',
      initialToolId: 'mask-edit',
    })
    await expect(ref.current?.flush()).resolves.toEqual(session)
    expect(save).not.toHaveBeenCalled()
  })

  it('source 或 revision 不一致时明确失败，不回退旧 MaskEditor', async () => {
    render(
      <MaskEditorV3Host
        sourceImageUrl="managed://other-source"
        sessionReference={session}
        targetLayerId="mask-target"
        loadSnapshot={vi.fn(async () => snapshot(1))}
        repository={{ save: vi.fn() }}
      />,
    )

    expect(await screen.findByText(/source\/ref\/revision 与权威快照不一致/)).toBeTruthy()
    expect(screen.queryByTestId('v3-mask-editor')).toBeNull()
  })

  it('500ms 内只自动保存最新 revision，并只发布持久化后的会话引用', async () => {
    const save = vi.fn(async (next: ImageEditDocumentV3) => ({
      documentId: next.id,
      revision: next.revision,
      previewRef: null,
    }))
    const onSessionChange = vi.fn()
    render(
      <MaskEditorV3Host
        sourceImageUrl="managed://source"
        sessionReference={session}
        targetLayerId="mask-target"
        loadSnapshot={vi.fn(async () => snapshot())}
        repository={{ save }}
        onSessionChange={onSessionChange}
      />,
    )

    await screen.findByTestId('v3-mask-editor')
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'revision 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'revision 2' }))
    expect(save).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })

    expect(save).toHaveBeenCalledOnce()
    expect(save.mock.calls[0][0].revision).toBe(2)
    expect(onSessionChange).toHaveBeenCalledOnce()
    expect(onSessionChange).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 }))
  })
})
