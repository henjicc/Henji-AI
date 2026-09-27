import { describe, expect, it } from 'vitest'
import { parseRealtimeMessage } from '../src/capabilities/speech-recognition/bailian/realtime/protocol'
import { bailianFunAsrRealtime, bailianQwenAudio31AsrFlashStreaming, bailianQwen3AsrFlashRealtime } from '../src/capabilities/speech-recognition/bailian/realtime/presets'
import qwen from './fixtures/bailian/asr-realtime-qwen.json'

const parseQwen = (event: unknown) => parseRealtimeMessage(bailianQwen3AsrFlashRealtime, JSON.stringify(event))

describe('百炼实时事件边界：官方字段表与 synthetic-negative', () => {
  it('Qwen 按 text + stash 拼接，保留单词边界及任一合法空字符串', () => {
    expect(parseQwen(qwen.events.partialBoundary)).toMatchObject({ kind: 'partial', text: 'Hello world' })
    expect(parseQwen({ ...qwen.events.partialBoundary, text: '' })).toMatchObject({ kind: 'partial', text: 'world' })
    expect(parseQwen({ ...qwen.events.partialBoundary, stash: '' })).toMatchObject({ kind: 'partial', text: 'Hello ' })
  })

  it.each([qwen.events.speechStarted, qwen.events.speechStopped, qwen.events.committed, qwen.events.itemCreated])(
    '官方 $type 是已知状态通知，不能变成文本或未知警告', event => {
      expect(parseQwen(event)).toEqual({ kind: 'ignored', eventType: event.type })
    },
  )

  it.each([undefined, null, 'false', 0])('Fun 有文字也必须有布尔 sentence_end：%j', sentenceEnd => {
    for (const preset of [bailianFunAsrRealtime, bailianQwenAudio31AsrFlashStreaming]) {
      expect(() => parseRealtimeMessage(preset, JSON.stringify({
        header: { event: 'result-generated' },
        payload: { output: { sentence: { text: 'fixture-private-transcript', sentence_end: sentenceEnd } } },
      }))).toThrowError(expect.objectContaining({
        code: 'invalid_response',
        details: expect.objectContaining({ modelId: preset.modelId, protocol: preset.protocol, stage: 'parse', eventType: 'result-generated' }),
      }))
    }
  })

  it.each([
    { ...qwen.events.speechStarted, audio_start_ms: undefined },
    { ...qwen.events.speechStopped, audio_end_ms: '400' },
    { ...qwen.events.committed, item_id: undefined },
    { ...qwen.events.itemCreated, item: {} },
  ])('已知通知的必要状态字段缺失不能被无条件忽略：$type', event => {
    expect(() => parseQwen(event)).toThrowError(expect.objectContaining({ code: 'invalid_response' }))
  })

  it.each([
    { text: 1, stash: 'word' }, { stash: 'word' }, { text: 'word' },
    { text: 'word', stash: null }, { text: '', stash: '' },
  ])('Qwen 部分结果不能用另一半文本掩盖字段缺失或错类型：%j', fields => {
    expect(() => parseQwen({ type: qwen.events.partial.type, ...fields }))
      .toThrowError(expect.objectContaining({ code: 'invalid_response' }))
  })

  it('最终结果不能以未知 text 字段掩盖缺失 transcript', () => {
    expect(() => parseQwen({ type: qwen.events.final.type, text: 'fallback' }))
      .toThrowError(expect.objectContaining({ code: 'invalid_response' }))
  })

  it('缺失类型立即失败；有名扩展事件保留 unknown，不制造完成状态', () => {
    expect(() => parseQwen({})).toThrowError(expect.objectContaining({ code: 'invalid_response' }))
    expect(parseQwen({ type: 'future.status' })).toEqual({ kind: 'unknown', eventType: 'future.status' })
  })

  it('解析失败只记录实际模型、协议和允许的事件状态，不含原文', () => {
    let caught: unknown
    try {
      parseRealtimeMessage(bailianQwenAudio31AsrFlashStreaming,
        '{"header":{"event":"result-generated"},"payload":{"output":{"sentence":{"text":"fixture-private-transcript"}}}}')
    } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toContain('qwen-audio-3.1-asr-flash-streaming')
    expect((caught as Error).message).not.toContain('Fun-ASR')
    expect(JSON.stringify(caught)).not.toContain('fixture-private-transcript')
  })
})
