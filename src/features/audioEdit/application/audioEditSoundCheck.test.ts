// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { AudioEditSoundCheck } from '@/core/audioEdit/soundCheck'
import type { AudioEditProjectDocument } from '@/core/audioEdit/types'
import { getPlatform } from '@/platform/runtime'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { harnessDocumentStore, installHarnessNativeStorage, registerHarnessAudioEditProject, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { editAudioEditProject, flushAudioEditProject, loadAudioEditProject, resetAudioEditProjectInstancesForTests } from './audioEditProjectInstances'
import { resetAudioEditStepsForTests } from './audioEditStepUndo'

const RATE = 48_000
function fixture(): AudioEditProjectDocument {
  return {
    id: 'sound', name: '口播', referenceScript: '',
    source: { mediaType: 'audio', sourcePath: 'D:\\录音\\原素材.wav', audioPath: 'D:\\录音\\原素材.wav', durationFrames: 60 * RATE, sampleRate: RATE, channels: 1 },
    transcript: [], suggestions: [], cuts: [{ id: 'cut', startFrame: 10 * RATE, endFrame: 20 * RATE, reason: 'manual', enabled: true }],
    createdAt: 1, updatedAt: 1, revision: 1,
  }
}
const documentRef = { kind: 'audio_edit.document', id: 'sound' } as const
const check = (integratedLufs: number, durationSeconds: number): AudioEditSoundCheck => ({
  startSeconds: 0, endSeconds: durationSeconds, durationSeconds,
  loudness: { integratedLufs, loudnessRangeLu: 5, truePeakDbtp: -1.2, samplePeakDbfs: -1.5 },
  clipping: { count: 0, samples: 0, ranges: [] },
  silence: { thresholdDbfs: -40, totalSeconds: 2, leadingSeconds: 0, trailingSeconds: 0, longPauseSeconds: 0.8, longPauseCount: 0, longestPauseSeconds: 0.5, longPauses: [] },
  noise: { floorDbfs: -64, rating: 'clean', hum: { status: 'none' } },
  windowSeconds: 10, keyWindows: [], issues: [],
})

beforeEach(() => { installHarnessNativeStorage(); registerHarnessAudioEditProject(fixture()) })
afterEach(async () => { vi.restoreAllMocks(); resetAudioEditStepsForTests(); await resetAudioEditProjectInstancesForTests(); uninstallHarnessNativeStorage() })

it('读回按剪后作品时间测范围；口播改过后同一范围再测给出差值，没改过不给', async () => {
  const app = createApplicationHarness()
  try {
    const measured = vi.spyOn(getPlatform().audioEdit, 'checkSound').mockResolvedValueOnce(check(-22, 50)).mockResolvedValueOnce(check(-22, 50)).mockResolvedValueOnce(check(-16, 45))
    const first = await app.requireResult('check_audio_edit_sound', { documentRef, startSeconds: 5, endSeconds: 40, includeWindows: true })
    expect(measured).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: 'sound', startSeconds: 5, endSeconds: 40, includeWindows: true }))
    expect(first).toMatchObject({ resultRef: documentRef, verified: true, check: { loudness: { integratedLufs: -22 } } })
    expect(first.sinceLastCheck).toBeUndefined()
    expect(first.message).toContain('-22 LUFS')
    const unchanged = await app.requireResult('check_audio_edit_sound', { documentRef, startSeconds: 5, endSeconds: 40 })
    expect(unchanged.sinceLastCheck).toBeUndefined()
    editAudioEditProject('sound', document => ({ ...document, output: { volumeDb: 6 } }))
    const after = await app.requireResult('check_audio_edit_sound', { documentRef, startSeconds: 5, endSeconds: 40 })
    expect(after.sinceLastCheck).toMatchObject({ integratedLufs: 6, durationSeconds: -5 })
    expect(after.message).toContain('响度 +6 LU')
    // 主进程按已保存的口播渲染：读回前先落盘
    expect((harnessDocumentStore().stored('sound')!.content as AudioEditProjectDocument).output).toEqual({ volumeDb: 6 })
  } finally { app.dispose() }
})

it('匹配响度的回执带补偿后实测的整体响度、真峰值与剪后时长，不必再读回', async () => {
  const app = createApplicationHarness()
  try {
    vi.spyOn(getPlatform().audioEdit, 'matchLoudness').mockResolvedValue({ integratedLufs: -21.4, gainDb: 5.4 })
    vi.spyOn(getPlatform().audioEdit, 'checkSound').mockResolvedValue({ ...check(-16.1, 50), loudness: { integratedLufs: -16.1, loudnessRangeLu: 5, truePeakDbtp: -1.1, samplePeakDbfs: -1.3 } })
    const result = await app.requireResult('match_audio_edit_loudness', { documentRef, targetLufs: -16 })
    // 60 秒素材剪掉 10 秒
    expect(result).toMatchObject({ sound: { integratedLufs: -16.1, truePeakDbtp: -1.1, beforeLufs: -21.4 }, editedSeconds: 50 })
    expect(result.message).toContain('补偿后实测 -16.1 LUFS')
  } finally { app.dispose() }
})

it('先读回、再匹配响度、再读回：回执里顺带的测量不顶替处理前那次，第三步给出差值', async () => {
  const app = createApplicationHarness()
  try {
    vi.spyOn(getPlatform().audioEdit, 'matchLoudness').mockResolvedValue({ integratedLufs: -22, gainDb: 6 })
    vi.spyOn(getPlatform().audioEdit, 'checkSound').mockResolvedValueOnce(check(-22, 50)).mockResolvedValueOnce(check(-16, 50)).mockResolvedValueOnce(check(-16, 50))
    await app.requireResult('check_audio_edit_sound', { documentRef })
    await app.requireResult('match_audio_edit_loudness', { documentRef, targetLufs: -16 })
    const after = await app.requireResult('check_audio_edit_sound', { documentRef })
    expect(after.sinceLastCheck).toMatchObject({ integratedLufs: 6 })
  } finally { app.dispose() }
})

it('匹配响度时取消：一并取消回执那次测量，已取消就不再测', async () => {
  const app = createApplicationHarness()
  try {
    const controller = new AbortController()
    vi.spyOn(getPlatform().audioEdit, 'matchLoudness').mockImplementation(async () => { controller.abort(); return { integratedLufs: -22, gainDb: 6 } })
    const measured = vi.spyOn(getPlatform().audioEdit, 'checkSound').mockResolvedValue(check(-16, 50))
    const cancelled = vi.spyOn(getPlatform().audioEdit, 'cancelTask').mockResolvedValue(undefined)
    const definition = (await import('@/features/application-control/applicationCapabilityService')).listApplicationCapabilities().find(item => item.id === 'match_audio_edit_loudness')!
    await app.session.execute({ id: definition.id, version: definition.version, input: { documentRef, targetLufs: -16 } }, { requestId: 'match-1', signal: controller.signal })
    expect(cancelled).toHaveBeenCalledWith('match-1:check')
    expect(measured).not.toHaveBeenCalled()
  } finally { app.dispose() }
})

it('原素材找不到时读得出原因；写 source_path 走界面同一个重新定位核对并保存，读回新路径', async () => {
  const app = createApplicationHarness()
  try {
    await loadAudioEditProject('sound')
    vi.spyOn(getPlatform().audioEdit, 'verifySource').mockRejectedValue(new Error('找不到原素材，请重新定位文件。'))
    const missing = await app.read(documentRef, ['audio_edit.document.source_problem', 'audio_edit.document.source_path'])
    expect(missing.properties).toMatchObject({ 'audio_edit.document.source_problem': '找不到原素材，请重新定位文件。', 'audio_edit.document.source_path': 'D:\\录音\\原素材.wav' })
    const relinked = { ...fixture().source, sourcePath: 'E:\\备份\\原素材.wav', audioPath: 'E:\\备份\\原素材.wav' }
    const relink = vi.spyOn(getPlatform().audioEdit, 'relinkSource').mockResolvedValue(relinked)
    // 写法不同（正斜杠）也能核对通过：以执行结果为准
    const changed = await app.change(documentRef, { 'audio_edit.document.source_path': 'E:/备份/原素材.wav' })
    expect(changed.ok).toBe(true)
    expect(relink).toHaveBeenCalledWith('sound', 'E:/备份/原素材.wav')
    await flushAudioEditProject('sound')
    expect((harnessDocumentStore().stored('sound')!.content as AudioEditProjectDocument).source.sourcePath).toBe('E:\\备份\\原素材.wav')
    // 内容不同的文件被主进程拒绝时不改口播，错误原样给助手
    relink.mockRejectedValueOnce(new Error('所选文件不是原素材。请将不同内容作为新口播导入。'))
    const rejected = await app.change(documentRef, { 'audio_edit.document.source_path': 'E:\\别的.wav' })
    expect(rejected.ok).toBe(false)
    expect(JSON.stringify(rejected)).toContain('不是原素材')
    expect((await loadAudioEditProject('sound')).document.source.sourcePath).toBe('E:\\备份\\原素材.wav')
  } finally { app.dispose() }
})
