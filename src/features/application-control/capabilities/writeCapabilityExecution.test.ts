// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '@/core/application-control/builtinApplicationCapabilityRegistry'
import { executeApplicationCapabilityResult } from './registry'

const documentRef = { kind: 'video_edit.document', id: 'missing-document' }
const sequenceRef = { kind: 'video_edit.sequence', id: 'missing-document:sequence' }
const audioRef = { kind: 'audio_edit.document', id: 'missing-audio' }

describe('专用写 handler 的事务前拒绝', () => {
  it.each<[string, Record<string, unknown>]>([
    ['prepare_video_edit_subtitle_audio', { documentRef, sequenceRef, scope: 'sequence' }],
    ['generate_video_edit_subtitles', { documentRef, sequenceRef, audioDocumentRef: audioRef }],
    ['translate_video_edit_subtitles', { documentRef, sequenceRef, targetLanguage: 'en' }],
    ['transcribe_audio_edit', { documentRef: audioRef }],
    ['quick_process_audio_edit', { documentRef: audioRef }],
    ['export_audio_edit', { documentRef: audioRef, destination: { mode: 'quick' } }],
    ['organize_image_edit_intent', { draftRef: { kind: 'image_edit.intent_draft', id: 'missing-draft' } }],
    ['retry_layer_stack_result', { canvasRef: { kind: 'canvas.document', id: 'missing-canvas' }, nodeRef: { kind: 'canvas.node', id: 'missing-canvas:node' } }],
    ['generate_image_edit_outpaint', { documentRef: { kind: 'image_edit.document', id: 'v3:missing-image' }, margins: { right: .25, bottom: 0 }, prompt: '延展背景' }],
    ['export_video_edit', { documentRef, format: 'mp4' }],
  ])('%s：输入合法但原宿主不存在，报告 not_executed', async (id, input) => {
    const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(id)!
    // 排除“只测 schema 拒绝”的假阳性，实际进入专用处理器的加载/准备路径。
    expect(definition.inputSchema.safeParse(input).success).toBe(true)
    const result = await executeApplicationCapabilityResult({ id, version: definition.version, input }, { signal: new AbortController().signal, requestId: 'preflight-fixture' })
    expect(result).toMatchObject({ ok: false, error: { details: { execution: { notExecuted: true } } } })
  })
})
