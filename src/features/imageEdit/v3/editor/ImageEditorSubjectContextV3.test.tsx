// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { ImageEditCommandBusV3 } from '../application/imageEditCommandBus'
import type { ImageEditSubjectSelectionResultV3 } from '../application/imageEditSubjectSelectionServiceV3'
import { selectImageEditRegionV3 } from '../application/imageEditSubjectSelectionServiceV3'
import { getImageEditorHostProfileV3 } from '../application/imageEditorHostProfiles'
import { useImageEditorSessionStoreV3 } from '../store'
import { ImageEditorSubjectProviderV3, useImageEditorSubjectV3 } from './ImageEditorSubjectContextV3'
import type { ImageEditorV3Controller } from './types'

vi.mock('../application/imageEditSubjectSelectionServiceV3', () => ({ selectImageEditRegionV3: vi.fn(), discardImageEditSubjectCandidatesV3: vi.fn() }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
it('切换图片取消旧主体作业并清除忙碌，旧候选不能污染新图片或结束新作业', async () => {
  const make = () => { const doc = createImageEditDocumentV3({ width: 32, height: 32 }); doc.layers = [createImageEditRasterLayerV3('r', '原图')]; return new ImageEditCommandBusV3(doc) }
  const old = make(), current = make(), profile = getImageEditorHostProfileV3('full'), sessionId = 'subject-context'
  useImageEditorSessionStoreV3.setState({ sessions: {} }); useImageEditorSessionStoreV3.getState().ensureSession(sessionId, ['select-subject'], 'r', 'select-subject')
  const holder: { current: ReturnType<typeof useImageEditorSubjectV3> } = { current: null }
  function Probe(): null { holder.current = useImageEditorSubjectV3(); return null }
  const ui = (bus: ImageEditCommandBusV3) => <ImageEditorSubjectProviderV3 bus={bus} controller={{ sessionId, profile, document: bus.getSnapshot().document } as ImageEditorV3Controller}><Probe /></ImageEditorSubjectProviderV3>
  let finishOld!: (value: ImageEditSubjectSelectionResultV3) => void, finishCurrent!: (value: ImageEditSubjectSelectionResultV3) => void
  vi.mocked(selectImageEditRegionV3).mockReturnValueOnce(new Promise(resolve => { finishOld = resolve })).mockReturnValueOnce(new Promise(resolve => { finishCurrent = resolve }))
  const rendered = render(ui(old)); let oldRun!: Promise<void>, newRun!: Promise<void>
  await act(async () => { oldRun = holder.current!.run({ kind: 'subject' }) }); expect(holder.current!.busy).toBe(true)
  const oldSignal = vi.mocked(selectImageEditRegionV3).mock.calls[0][2]!.signal!
  rendered.rerender(ui(current)); expect(oldSignal.aborted).toBe(true); expect(holder.current!.busy).toBe(false)
  await act(async () => { newRun = holder.current!.run({ kind: 'subject' }) })
  const candidate = { id: 'old-candidate', bounds: { x: 0, y: 0, width: 0.5, height: 0.5 }, area: 0.25, score: 0.9 }
  await act(async () => { finishOld({ status: 'candidates', candidates: [candidate, candidate], selection: null, durationMs: 1 }); await oldRun })
  expect(holder.current!.candidates).toEqual([]); expect(holder.current!.busy).toBe(true)
  await act(async () => { finishCurrent({ status: 'selected', candidates: [], selection: null, durationMs: 1 }); await newRun })
  expect(holder.current!.busy).toBe(false); old.dispose(); current.dispose()
})
