import { expect, it, vi } from 'vitest'
vi.mock('../services/local-models/runtime', () => ({ ensureLocalModel: vi.fn() }))
vi.mock('../services/smart-regions/runtime', () => ({ getLocalInferenceHost: vi.fn() }))
vi.mock('./registry', () => ({ registerIpcHandler: vi.fn() }))
vi.mock('../services/logging', () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn() }) }))
import { parseImageEditorV3SubjectPayload } from './image-editor-v3-subject'
it('主体推理闭合IPC，不接受路径、错长度或图外框；512仅是模型工作图', () => {
  const request = { requestId: 'selection', width: 2, height: 2, rgba: new ArrayBuffer(16), region: { kind: 'subject' } }
  expect(parseImageEditorV3SubjectPayload(request).region.kind).toBe('subject')
  expect(() => parseImageEditorV3SubjectPayload({ ...request, rgba: new ArrayBuffer(4) })).toThrow('长度')
  expect(() => parseImageEditorV3SubjectPayload({ ...request, sourcePath: 'external' })).toThrow()
  expect(() => parseImageEditorV3SubjectPayload({ ...request, region: { kind: 'box', x: 0.9, y: 0.9, width: 0.5, height: 0.5 } })).toThrow('范围')
})
