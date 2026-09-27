import { editAudioEditProject, loadAudioEditProject, undoAudioEditProject, flushAudioEditProject, releaseAudioEditProject } from './audioEditProjectInstances'
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest'

import { editedDurationFrames, buildAudioEditTimeline } from '@/core/audioEdit/timeline'
import type { AudioEditProjectDocument } from '@/core/audioEdit/types'
import { createApplicationHarness } from '@/tests/applicationHarness'
import {
  installHarnessNativeStorage,
  registerHarnessAudioEditProject,
  uninstallHarnessNativeStorage,
} from '@/tests/harnessNativeStorage'

function fixture(): AudioEditProjectDocument {
  return {
    id: 'audio-result', name: '原工程', referenceScript: '', suggestions: [], vstEnabled: false,
    source: { mediaType: 'audio', sourcePath: 'fixture.wav', audioPath: 'fixture.wav', durationFrames: 96_000, sampleRate: 48_000, channels: 1 },
    transcript: [
      { id: 'first', text: '第一句', startFrame: 0, endFrame: 48_000, included: true, locked: false, granularity: 'word' },
      { id: 'second', text: '第二句', startFrame: 48_000, endFrame: 96_000, included: true, locked: false, granularity: 'word' },
    ],
    createdAt: 1, updatedAt: 1, revision: 1,
  }
}

beforeEach(() => {
  installHarnessNativeStorage()
  registerHarnessAudioEditProject(fixture())
})

afterEach(() => { releaseAudioEditProject('audio-result'); uninstallHarnessNativeStorage() })

it('通过通用 change 修改工程名并从正式口播工程状态读回', async () => {
  const app = createApplicationHarness()
  try {
    const ref = { kind: 'audio_edit.project', id: 'audio-result' }
    expect((await app.change(ref, { 'audio_edit.project.name': '新工程名' })).ok).toBe(true)
    expect((await app.read(ref, ['audio_edit.project.name'])).properties).toMatchObject({ 'audio_edit.project.name': '新工程名' })
  } finally {
    app.dispose()
  }
})

it('通过通用 change 删除词块并让成片映射同步缩短', async () => {
  const app = createApplicationHarness()
  try {
    const blockRef = { kind: 'audio_edit.transcript_block', id: 'audio-result:first' }
    expect((await app.change(blockRef, { 'audio_edit.transcript_block.included': false })).ok).toBe(true)
    const project = await window.henjiNative.audio.getEditProject('audio-result')
    expect(project?.transcript[0].included).toBe(false)
    expect(editedDurationFrames(buildAudioEditTimeline(project!.source.durationFrames, project!.transcript))).toBe(48_000)
  } finally {
    app.dispose()
  }
})

it('助手修改与手工历史共存，撤销助手操作不会抹去之前的手工编辑', async () => {
  const app = createApplicationHarness()
  try {
    const instance = await loadAudioEditProject('audio-result')
    editAudioEditProject('audio-result', (document) => ({ ...document, referenceScript: '手工参考稿' }))
    await flushAudioEditProject('audio-result')
    expect((await app.change({ kind: 'audio_edit.project', id: 'audio-result' }, { 'audio_edit.project.name': '助手改名', 'audio_edit.project.cuts': [{ id: 'manual', startFrame: 1000, endFrame: 3000, reason: 'manual', enabled: true }] })).ok).toBe(true)
    expect(instance.past).toHaveLength(2)
    undoAudioEditProject('audio-result')
    expect(instance.document.name).toBe('原工程')
    expect(instance.document.cuts).toBeUndefined()
    expect(instance.document.referenceScript).toBe('手工参考稿')
    await flushAudioEditProject('audio-result')
  } finally { app.dispose() }
})
