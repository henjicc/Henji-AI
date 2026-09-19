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

afterEach(() => uninstallHarnessNativeStorage())

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
