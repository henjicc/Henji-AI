import { expect, it } from 'vitest'
import path from 'node:path'
import { createRecordingDocument, recordingDocumentSchema } from './document'
import { collectMediaReferences } from '../media/mediaReferences'
import { documentKindRegistry } from '../documents/kinds'
import { buildDocumentEnvelope, parseDocumentText, serializeDocumentEnvelope } from '../documents/envelope'

it('正式文档序列化后原片与事件页仍进入唯一媒体引用扫描，不受理解结果或成片是否存在影响', () => {
  const media = path.resolve(path.sep, 'recording', 'screen.mp4'), events = path.resolve(path.sep, 'recording', 'events.capture.json')
  const content = createRecordingDocument()
  content.sessionId = '00000000-0000-4000-8000-000000000001'; content.status = 'stopped'
  content.media = [{ id: 'screen', kind: 'screen', path: media, monoUs: 3000000, durationUs: 10000000 }]
  content.eventPages = [{ path: events, firstSequence: 0, lastSequence: 1 }]
  const envelope = buildDocumentEnvelope({ kind: 'screen_recording', kindVersion: documentKindRegistry.require('screen_recording').version, id: content.sessionId, name: '课堂', draft: false, revision: 0, createdAt: '2026-10-14T00:00:00.000Z', updatedAt: '2026-10-14T00:00:00.000Z', content })
  const decoded = parseDocumentText(serializeDocumentEnvelope(envelope))
  expect(recordingDocumentSchema.parse(decoded.content)).toEqual(content)
  expect(collectMediaReferences(decoded.content).sort()).toEqual([media, events].sort())
  expect(documentKindRegistry.require('screen_recording').extension).toBe('.henji-recording')
})
