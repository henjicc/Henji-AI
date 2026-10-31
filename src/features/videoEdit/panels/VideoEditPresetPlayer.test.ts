// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ContentTrustRequiredError } from '@/core/contentTrust'
import { styleCodeFixture } from '@/core/videoEdit/styleCodeTestFixtures'
import { createVideoEditTestDocument } from '@/core/videoEdit/testFixtures'
import { videoEditComposition } from '@/core/videoEdit/document'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { ContentTrustSession, installContentTrustSession } from '../../../../electron/main/services/content-trust/runtime'
import { useAlertDialogStore } from '@/stores/alertDialogStore'
import * as preview from '../application/videoEditPresetPreview'
import { VideoEditPresetPlayer } from './VideoEditPresetPlayer'

vi.mock('../application/videoEditPresetPreview', async importOriginal => {
  const actual = await importOriginal<typeof preview>()
  return { ...actual, presetPreviewTimeline: vi.fn(), renderPresetPreviewFrame: vi.fn() }
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
it('拒绝外来代码后，在详情点击运行并确认会重建效果预览', async () => {
  installHarnessNativeStorage()
  const preset = styleCodeFixture(), foreign = { id: 'foreign-preview', sourceName: '代码风格', sourceType: 'style_package' as const }
  preset.codeSnapshots!.code.version.foreign = foreign
  const session = new ContentTrustSession(() => false, () => undefined)
  session.decide(session.check({ contents: [foreign] }).challenge!, 'deny')
  const restore = installContentTrustSession(session)
  const document = createVideoEditTestDocument('预览')
  vi.mocked(preview.presetPreviewTimeline).mockRejectedValueOnce(new ContentTrustRequiredError('denied', [foreign])).mockResolvedValue({ composition: videoEditComposition(document, document.sequences[0].id), frames: 1, poster: 0 })
  vi.mocked(preview.renderPresetPreviewFrame).mockResolvedValue({ width: 320, height: 180, close() {} } as ImageBitmap)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage() {} } as unknown as CanvasRenderingContext2D)
  try {
    const { container } = render(createElement(VideoEditPresetPlayer, { source: { category: 'effect', preset }, size: { width: 320, height: 180 }, playing: false, label: '风格件预览' }))
    fireEvent.click(await screen.findByRole('button', { name: '运行' }))
    await waitFor(() => expect(useAlertDialogStore.getState().queue).toHaveLength(1))
    useAlertDialogStore.getState().confirmCurrent()
    await waitFor(() => expect(container.querySelector('canvas')?.dataset.presetPreview).toBe('ready'))
    expect(preview.presetPreviewTimeline).toHaveBeenCalledTimes(2)
  } finally { restore() }
})
