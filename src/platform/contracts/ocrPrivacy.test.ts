import { expect, it } from 'vitest'
import { ocrPrivacyRequestSchema } from './ocrPrivacy'
import { detectRecordingPrivacyCapability } from '../../core/application-control/domains/screenRecording/privacyCapability'
import { detectVideoEditPrivacyCapability } from '../../core/application-control/domains/videoEdit/videoEditPrivacyCapability'

it('桥接、录屏与剪辑能力都只提供默认OCR，不暴露或接受旧档位参数', () => {
  const id = '00000000-0000-4000-8000-000000000001'
  const cases = [
    { schema: ocrPrivacyRequestSchema, input: { requestId: id, source: 'fixture', mediaId: 'media', startUs: 0, endUs: 1000000, originUs: 0 } },
    { schema: detectRecordingPrivacyCapability.inputSchema, input: { sessionRef: { kind: 'screen_recording.session', id } } },
    { schema: detectVideoEditPrivacyCapability.inputSchema, input: { documentRef: { kind: 'video_edit.document', id }, clipRef: { kind: 'video_edit.clip', id: `${id}:clip` } } },
  ]
  for (const { schema, input } of cases) {
    expect(schema.safeParse(input).success).toBe(true)
    for (const quality of ['fast', 'precise']) expect(schema.safeParse({ ...input, quality }).success).toBe(false)
  }
})
