import { expect, it, vi } from 'vitest'
import { screenAttentionFixture } from '@/tests/screenAttentionFixture'
import { createVideoEditTestDocument } from '@/core/videoEdit/testFixtures'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { videoEditComposition } from '@/core/videoEdit/document'
import { screenAttentionSettingsSchema } from '@/core/videoEdit/screenAttention'
import { evaluateVideoEditKeyframes } from '@/core/videoEdit/keyframes'
import { analyzeVideoEditScreenAttention, type VideoEditScreenAttentionRequest } from './videoEditScreenAttentionAnalysis'
async function fixture(capability = false) {
  const log = await screenAttentionFixture({ capability }); const document = createVideoEditTestDocument('注意力测试')
  document.media.push({ id: 'screen', path: '/fixture/screen.mp4', name: '原片', kind: 'video', width: 1920, height: 1080, durationSeconds: 10, recordingCursor: log.source })
  document.items.push({ id: 'item', kind: 'video', name: '原片', mediaId: 'screen' })
  const sequence = document.sequences[0]
  const clip = makeVideoEditItemClip(document, 'item', sequence.id, { frame: 0, duration: 300 }); sequence.clips = [clip]
  const request: VideoEditScreenAttentionRequest = { composition: videoEditComposition(document, sequence.id), clipId: clip.id, target: { width: 1920, height: 1080 }, settings: screenAttentionSettingsSchema.parse({}) }
  const read = vi.fn(async (page: { path: string }) => log.bytes.get(page.path)!)
  return { request, read, log }
}
it('正式事件页经完整校验分块分析，光标烤入不影响注意力，段落力度按片段秒生效', async () => {
  const { request, read } = await fixture()
  const result = await analyzeVideoEditScreenAttention(request, undefined, read)
  expect(evaluateVideoEditKeyframes(result.clip.curves!.x, 60, 0)).toBeGreaterThan(0)
  expect(evaluateVideoEditKeyframes(result.clip.curves!.x, 150, 0)).toBeLessThan(0)
  expect(result.quietFrames).toBeGreaterThan(0); expect(read).toHaveBeenCalledTimes(2)
  request.composition.media[0].recordingCursor!.cursorBakedIn = true
  request.settings.sections = [{ startSeconds: 4, endSeconds: 6, strength: 'light' }]
  const changed = await analyzeVideoEditScreenAttention(request, undefined, read)
  expect(evaluateVideoEditKeyframes(changed.clip.curves!.scale, 150, 1)).toBeLessThan(evaluateVideoEditKeyframes(result.clip.curves!.scale, 150, 1))
})
it('高速跳帧仍报告正在使用的能力区域估计；捕获时区域可由接线方补充且结果读回准确', async () => {
  const { request, read, log } = await fixture(true)
  Object.assign(request.composition.clips[0], { duration: 3, speed: { numerator: 100, denominator: 1 } })
  const estimated = await analyzeVideoEditScreenAttention(request, undefined, read)
  expect(estimated.impreciseCapabilities).toBe(1)
  const page = JSON.parse(new TextDecoder().decode(log.bytes.values().next().value!)) as { entries: Array<{ kind: string; eventId: string }> }
  request.regions = [{ eventId: page.entries.find(e => e.kind === 'capability')!.eventId, box: { x: .6, y: .5, width: .1, height: .1 } }]
  const precise = await analyzeVideoEditScreenAttention(request, undefined, read)
  expect(precise.impreciseCapabilities).toBe(0)
  expect(evaluateVideoEditKeyframes(precise.clip.curves!.x, 1, 0)).toBeLessThan(0)
})
it('裁剪、移动、变速和倒放用正式有理源时钟；原片源起点对齐日志 recordingUs', async () => {
  const { request, read } = await fixture(); const clip = request.composition.clips[0]
  Object.assign(clip, { start: 600, duration: 90, sourceInUs: 4_000_000, speed: { numerator: 2, denominator: 1 } })
  const forward = await analyzeVideoEditScreenAttention(request, undefined, read)
  expect(evaluateVideoEditKeyframes(forward.clip.curves!.x, 15, 0)).toBeLessThan(0)
  Object.assign(clip, { duration: 90, sourceInUs: 6_000_000, reverse: true })
  const reverse = await analyzeVideoEditScreenAttention(request, undefined, read)
  expect(evaluateVideoEditKeyframes(reverse.clip.curves!.x, 15, 0)).toBeLessThan(0)
  expect(evaluateVideoEditKeyframes(reverse.clip.curves!.x, 70, 0)).toBeGreaterThan(0)
  Object.assign(clip, { duration: 90, sourceInUs: 0, reverse: false })
  request.composition.media[0].recordingCursor!.recordingStartUs = 4_000_000
  const offset = await analyzeVideoEditScreenAttention(request, undefined, read)
  expect(offset.clip.curves).toEqual(forward.clip.curves)
})
it('缺日志、损坏、取消、画幅不匹配和段落越界明确失败', async () => {
  const { request, read } = await fixture()
  const abort = new AbortController(); abort.abort(new Error('取消'))
  await expect(analyzeVideoEditScreenAttention(request, abort.signal, read)).rejects.toThrow('取消')
  await expect(analyzeVideoEditScreenAttention(request, undefined, async () => new Uint8Array())).rejects.toThrow('校验')
  request.settings.sections = [{ startSeconds: 0, endSeconds: 11, strength: 'strong' }]
  await expect(analyzeVideoEditScreenAttention(request, undefined, read)).rejects.toThrow('sections')
  request.settings.sections = []; request.composition.media[0].width = 1024
  await expect(analyzeVideoEditScreenAttention(request, undefined, read)).rejects.toThrow('画幅')
  delete request.composition.media[0].recordingCursor
  await expect(analyzeVideoEditScreenAttention(request, undefined, read)).rejects.toThrow('事件日志')
})
