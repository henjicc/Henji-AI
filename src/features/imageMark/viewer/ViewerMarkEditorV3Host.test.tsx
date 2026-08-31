/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n/config'
import { ViewerMarkEditorV3Host } from './ViewerMarkEditorV3Host'

const mocks = vi.hoisted(() => ({
  finish: vi.fn(async () => undefined),
  materialize: vi.fn(async () => undefined),
  cancelMaterialization: vi.fn(),
  outputState: 'ready' as 'ready' | 'disabled',
  outputReason: undefined as string | undefined,
  outputReasonKey: undefined as string | undefined,
  bootstrapState: 'ready' as 'ready' | 'failed',
  bootstrapReasonKey: undefined as string | undefined,
}))

vi.mock('@/features/imageEdit/v3/editor', () => ({
  ImageEditorV3: ({ profileId, resourceDescriptors, toolbarActions }: {
    profileId: string
    resourceDescriptors?: readonly unknown[]
    toolbarActions?: ReactNode
  }) => (
    <div
      data-testid="shared-v3-editor"
      data-profile={profileId}
      data-resource-descriptor-count={resourceDescriptors?.length ?? 0}
    >
      {toolbarActions}
    </div>
  ),
}))

vi.mock('./useViewerMarkEditorV3Host', () => ({
  useViewerMarkEditorV3Host: () => ({
    bootstrap: mocks.bootstrapState === 'failed' ? {
      kind: 'failed',
      readiness: {
        state: 'disabled',
        reasonKey: mocks.bootstrapReasonKey,
      },
    } : {
      kind: 'ready',
      sourceUrl: 'source.png',
      document: {
        version: 3,
        id: 'viewer-host-test',
        revision: 0,
        geometry: {
          width: 640,
          height: 480,
          orientation: { rotate: 0, mirrored: false },
          crop: null,
        },
        color: {
          workingSpace: 'srgb',
          bitDepth: 8,
          transferFunction: 'srgb',
          hdrMetadata: null,
          iccProfileResourceId: null,
        },
        layers: [],
      },
      history: null,
      resourceDescriptors: [{
        resourceRef: `sha256:${'a'.repeat(64)}`,
        byteLength: 128,
        mediaType: 'image/png',
      }],
    },
    persistenceStatus: null,
    materialization: null,
    busy: false,
    outputReadiness: {
      state: mocks.outputState,
      reason: mocks.outputReason,
      reasonKey: mocks.outputReasonKey,
    },
    retryBootstrap: vi.fn(),
    handleDocumentChange: vi.fn(),
    handlePersistenceChange: vi.fn(),
    materialize: mocks.materialize,
    cancelMaterialization: mocks.cancelMaterialization,
    finish: mocks.finish,
  }),
}))

describe('ViewerMarkEditorV3Host', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    mocks.outputState = 'ready'
    mocks.outputReason = undefined
    mocks.outputReasonKey = undefined
    mocks.bootstrapState = 'ready'
    mocks.bootstrapReasonKey = undefined
  })

  it('只挂载共享 V3 编辑器并由 quick profile 裁剪能力', () => {
    render(
      <ViewerMarkEditorV3Host
        imageUrl="source.png"
        onClose={() => undefined}
        onSave={() => undefined}
      />,
    )

    expect(screen.getByTestId('shared-v3-editor').getAttribute('data-profile')).toBe('quick')
    expect(screen.getByTestId('shared-v3-editor').getAttribute('data-resource-descriptor-count')).toBe('1')
    const replace = screen.getByRole('button', { name: '替换图片' }) as HTMLButtonElement
    expect(replace.disabled).toBe(false)
    expect(replace.title).toContain('替换到查看器')
    fireEvent.click(replace)
    expect(mocks.materialize).toHaveBeenCalledOnce()
  })

  it('完成动作只等待受管文档持久化，不伪造最终图片输出', () => {
    render(
      <ViewerMarkEditorV3Host
        imageUrl="source.png"
        onClose={() => undefined}
        onSave={() => undefined}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '完成' }))
    expect(mocks.finish).toHaveBeenCalledOnce()
  })

  it('共享逐瓦片渲染器拒绝当前文档时保留明确禁用原因', () => {
    mocks.outputState = 'disabled'
    mocks.outputReason = '当前文档还不能安全替换查看器图片：画笔瓦片读取桥接尚未完成'
    render(
      <ViewerMarkEditorV3Host
        imageUrl="source.png"
        onClose={() => undefined}
        onSave={() => undefined}
      />,
    )

    const replace = screen.getByRole('button', { name: '替换图片' }) as HTMLButtonElement
    expect(replace.disabled).toBe(true)
    expect(replace.title).toContain('画笔瓦片读取桥接尚未完成')
  })

  it('en-US 在展示层翻译 quick profile 的结构化 HDR 拒绝原因', async () => {
    await i18n.changeLanguage('en-US')
    mocks.bootstrapState = 'failed'
    mocks.bootstrapReasonKey = 'imageEditor.v3.readiness.reasons.quickHdr'
    render(
      <ViewerMarkEditorV3Host
        imageUrl="source.png"
        onClose={() => undefined}
        onSave={() => undefined}
      />,
    )

    expect(screen.getByRole('alert').textContent).toContain('Could not open Quick Edit')
    expect(screen.getByRole('alert').textContent).toContain(
      'Quick Edit does not accept HDR documents yet.',
    )
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
  })
})
