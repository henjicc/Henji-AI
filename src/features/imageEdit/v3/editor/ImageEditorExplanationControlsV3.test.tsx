// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { recordingFixtureSession } from '@/core/creativeIntent/fixtures/recordingFixtures'
import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditCommandBusV3 } from '../application/imageEditCommandBus'
import type { ImageEditorV3Controller } from './types'
import { ImageEditorExplanationControlsV3 } from './ImageEditorExplanationControlsV3'

const adapter = vi.hoisted(() => ({
  subscribe: () => () => {}, snapshot: vi.fn(), preflightTranscription: vi.fn(),
  transcribe: vi.fn(), transcript: vi.fn(async () => []), cancelPick: vi.fn(),
}))
vi.mock('../application/imageEditExplanation', () => ({ imageEditExplanation: () => adapter }))
beforeEach(() => {
  vi.resetAllMocks()
  adapter.transcript.mockResolvedValue([])
  adapter.snapshot.mockReturnValue({ session: { ...recordingFixtureSession(), state: 'reviewing', pages: [] }, elapsedUs: 0, busy: false })
})
afterEach(cleanup)

it.each(['preflight', 'transcribe'] as const)('%s 失败使用对应标题并重试失败步骤', async stage => {
  const failure = stage === 'preflight' ? adapter.preflightTranscription : adapter.transcribe
  failure.mockRejectedValueOnce(new Error('provider unavailable')).mockResolvedValue(undefined)
  const controller = { document: createImageEditDocumentV3({ documentId: 'explanation-retry', width: 64, height: 64 }) } as ImageEditorV3Controller
  render(<ImageEditorExplanationControlsV3 bus={{} as ImageEditCommandBusV3} controller={controller} />)
  fireEvent.click(screen.getByRole('button', { name: '录制讲解' }))
  fireEvent.click(await screen.findByRole('button', { name: '转写并审阅' }))
  const title = stage === 'preflight' ? '转写预检失败' : '转写失败'
  await screen.findByText(title)
  expect(adapter.transcribe).toHaveBeenCalledTimes(stage === 'preflight' ? 0 : 1)
  fireEvent.click(screen.getByRole('button', { name: '重试' }))
  await waitFor(() => expect(failure).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(adapter.transcribe).toHaveBeenCalledTimes(stage === 'preflight' ? 1 : 2))
  expect(screen.queryByText(title)).toBeNull()
})
