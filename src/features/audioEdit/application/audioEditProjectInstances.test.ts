// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, registerHarnessAudioEditProject, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import type { AudioEditProjectDocument } from '@/core/audioEdit/types'
import { attachAudioEditProject, editAudioEditProject, flushAudioEditProject, loadAudioEditProject, releaseAudioEditProject, undoAudioEditProject, withAudioEditProjectOperation } from './audioEditProjectInstances'

const fixture = (): AudioEditProjectDocument => ({ id: 'instance-test', name: '录音', source: { mediaType: 'audio', sourcePath: 'fixture.wav', audioPath: 'fixture.wav', sampleRate: 1000, channels: 1, durationFrames: 4000 }, transcript: [{ id: 'word', text: '你好', startFrame: 1000, endFrame: 2000, included: true, locked: true, granularity: 'word' }], referenceScript: '', suggestions: [], vstEnabled: false, revision: 1, createdAt: 1, updatedAt: 1 })
beforeEach(() => { installHarnessNativeStorage(); registerHarnessAudioEditProject(fixture()) })
afterEach(async () => { vi.restoreAllMocks(); await flushAudioEditProject('instance-test'); releaseAudioEditProject('instance-test'); uninstallHarnessNativeStorage() })

it('failed saves retain the edit and history; retry only persists and export waits for it', async () => {
  const instance = await loadAudioEditProject('instance-test')
  const save = vi.spyOn(getPlatform().audioEdit, 'saveProject').mockRejectedValueOnce(new Error('disk full'))
  editAudioEditProject(instance.document.id, (document) => ({ ...document, name: '已修改' }))
  await expect(flushAudioEditProject(instance.document.id)).rejects.toThrow('disk full')
  expect(instance.dirty).toBe(true)
  expect(instance.document.name).toBe('已修改')
  expect(instance.past).toHaveLength(1)
  await withAudioEditProjectOperation(instance.document.id, async () => {
    expect((await getPlatform().audioEdit.getProject(instance.document.id))?.name).toBe('已修改')
    expect(() => editAudioEditProject(instance.document.id, (value) => ({ ...value, name: '迟到修改' }))).toThrow('等待')
  })
  expect(save).toHaveBeenCalledTimes(2)
  expect(instance.past).toHaveLength(1)
  undoAudioEditProject(instance.document.id)
  expect(instance.document.name).toBe('录音')
})

it('one instance survives reloads and protects locked speech from text and interval writes', async () => {
  const instance = await loadAudioEditProject('instance-test')
  editAudioEditProject(instance.document.id, (document) => ({ ...document, referenceScript: '真实修改' }))
  expect(attachAudioEditProject(fixture())).toBe(instance)
  expect(instance.document.referenceScript).toBe('真实修改')
  expect(() => editAudioEditProject(instance.document.id, (document) => ({ ...document, transcript: [] }))).toThrow('锁定')
  expect(() => editAudioEditProject(instance.document.id, (document) => ({ ...document, cuts: [{ id: 'manual', startFrame: 500, endFrame: 1500, enabled: true, reason: 'manual' }] }))).toThrow('锁定')
  editAudioEditProject(instance.document.id, (document) => ({ ...document, cuts: [{ id: 'manual', startFrame: 2500, endFrame: 3500, enabled: true, reason: 'manual' }] }))
  undoAudioEditProject(instance.document.id)
  expect(instance.document.cuts).toBeUndefined()
  expect(instance.document.referenceScript).toBe('真实修改')
})
