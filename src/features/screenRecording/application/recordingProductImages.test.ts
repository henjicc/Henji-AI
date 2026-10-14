// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { parseImageEditDocumentV3 } from '@/core/imageEdit/v3/documentCodec'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import { BLACK_HEX } from '@/core/theme/colorTokens'
const state = vi.hoisted(() => ({ document: null as ImageEditDocumentV3 | null, created: vi.fn() }))
vi.mock('@/commands/imageEditorV3', () => ({
  ingestImageEditorV3Source: async () => ({ resource: { resourceRef: 'sha256:source' }, metadata: { width: 1920, height: 1080 } }),
  saveImageEditorV3Document: async (input: { document: ImageEditDocumentV3 }) => { state.document = parseImageEditDocumentV3(input.document) },
  loadImageEditorV3Document: async () => ({ document: state.document }),
}))
vi.mock('@/features/imageEdit', () => ({ prepareImageEditSourceLocatorV3: async () => ({ kind: 'local-file', path: '/step.png' }), createImageDocument: async (input: { documentId: string }) => { state.created(input); return { id: input.documentId } } }))
import { createRecordingStepImageDocument } from './recordingProductImages'
it('复用正式 V3 模型，截图、标题、完整说明为独立可编辑层，长文字扩高不截断', async () => {
  vi.stubGlobal('OffscreenCanvas', class { getContext(): { font: string; measureText: (text: string) => { width: number } } { return { font: '', measureText: text => ({ width: text.length * 24 }) } } })
  const description = '完整中文说明'.repeat(300)
  const id = await createRecordingStepImageDocument({ id: 'step', title: '步骤标题', description, startUs: 0, endUs: 1e6, representativeUs: 500000, image: 'step.png' }, '/step.png', new AbortController().signal)
  expect(state.created).toHaveBeenCalledWith({ documentId: id, emptyUntilRevision: null })
  expect(state.document!.layers.map(layer => layer.type)).toEqual(['shape', 'raster', 'text', 'text'])
  const layer = state.document!.layers[3]; expect(layer.type === 'text' && layer.content.paragraphs[0].runs[0].text).toBe(description)
  expect(layer.type === 'text' && layer.content.paragraphs[0].runs[0].style.fill).toEqual({ enabled: true, color: BLACK_HEX })
  expect(state.document!.geometry.height).toBeGreaterThan(1600)
})
