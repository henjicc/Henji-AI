// @vitest-environment jsdom
import { editAudioEditProject, loadAudioEditProject, undoAudioEditProject, flushAudioEditProject, resetAudioEditProjectInstancesForTests } from './audioEditProjectInstances'
import { afterEach, beforeEach, expect, it } from 'vitest'

import { editedDurationFrames, buildAudioEditTimeline, buildProjectAudioEditTimeline } from '@/core/audioEdit/timeline'
import type { AudioEditProjectDocument } from '@/core/audioEdit/types'
import { createApplicationHarness } from '@/tests/applicationHarness'
import {
  harnessDocumentStore,
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

afterEach(async () => { await resetAudioEditProjectInstancesForTests(); uninstallHarnessNativeStorage() })

it('口播名就是文件名：内容实体的名称只读，读到的是文档名（改名走 documents.document.name）', async () => {
  const app = createApplicationHarness()
  try {
    const ref = { kind: 'audio_edit.project', id: 'audio-result' }
    expect((await app.read(ref, ['audio_edit.project.name'])).properties).toMatchObject({ 'audio_edit.project.name': '原工程' })
    const result = await app.change(ref, { 'audio_edit.project.name': '新工程名' })
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).toContain('documents.document.name')
    expect(harnessDocumentStore().stored('audio-result')?.meta.name).toBe('原工程')
  } finally {
    app.dispose()
  }
})

it('通用属性静音与界面设置保存可回读，静音不缩短成片且可以撤销', async () => {
  const app = createApplicationHarness()
  try {
    const ref = { kind: 'audio_edit.project', id: 'audio-result' }
    const view = { textSize: 28, sidePadding: 80, timelineCaptions: false }
    expect((await app.change(ref, {
      'audio_edit.project.cuts': [{ id: 'mute', startFrame: 12000, endFrame: 36000, reason: 'manual', enabled: true, mode: 'mute' }],
      'audio_edit.project.view_settings': view,
    })).ok).toBe(true)
    expect((await app.read(ref, ['audio_edit.project.view_settings'])).properties).toMatchObject({ 'audio_edit.project.view_settings': view })
    const instance = await loadAudioEditProject('audio-result')
    const spans = buildProjectAudioEditTimeline(instance.document)
    expect(editedDurationFrames(spans)).toBe(96000)
    expect(spans.some((span) => span.muted)).toBe(true)
    expect((await app.change(ref, { 'audio_edit.project.view_settings': { ...view, textSize: 32 } })).ok).toBe(true)
    expect(instance.past).toHaveLength(1)
    undoAudioEditProject('audio-result')
    expect(instance.document.cuts).toBeUndefined()
    expect(instance.document.viewSettings?.textSize).toBe(32)
    await flushAudioEditProject('audio-result')
  } finally { app.dispose() }
})

it('通过通用 change 删除词块并让成片映射同步缩短', async () => {
  const app = createApplicationHarness()
  try {
    const blockRef = { kind: 'audio_edit.transcript_block', id: 'audio-result:first' }
    expect((await app.change(blockRef, { 'audio_edit.transcript_block.included': false })).ok).toBe(true)
    // 从文档文件回读（3.3：口播是 .henji-audio 文档）
    const project = harnessDocumentStore().stored('audio-result')?.content as AudioEditProjectDocument
    expect(project.transcript[0].included).toBe(false)
    expect(editedDurationFrames(buildAudioEditTimeline(project.source.durationFrames, project.transcript))).toBe(48_000)
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
    expect((await app.change({ kind: 'audio_edit.project', id: 'audio-result' }, { 'audio_edit.project.reference_script': '助手参考稿', 'audio_edit.project.cuts': [{ id: 'manual', startFrame: 1000, endFrame: 3000, reason: 'manual', enabled: true }] })).ok).toBe(true)
    expect(instance.past).toHaveLength(2)
    undoAudioEditProject('audio-result')
    expect(instance.document.cuts).toBeUndefined()
    expect(instance.document.referenceScript).toBe('手工参考稿')
    await flushAudioEditProject('audio-result')
  } finally { app.dispose() }
})
