// @vitest-environment jsdom
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import type { ApplicationRef } from '@/core/application-control'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { loadRecordingSetup, saveRecordingSetup, recordingOutput } from '../recordingSetupModel'
import { RECORDING_SETUP_CHANGED_EVENT, mergeRecordingVideoSetup, type RecordingVideoSetup } from '../recordingSetupSync'

const ref: ApplicationRef = { kind: 'screen_recording.setup', id: 'singleton' }
const p = (suffix: string): string => `screen_recording.setup.${suffix}`
beforeAll(() => installHarnessNativeStorage())
afterAll(() => uninstallHarnessNativeStorage())
beforeEach(() => window.localStorage.clear())

it('录屏视频设置经通用读写动词读改：读到的是下次录制实际使用的值，写入落到录制页同一份设置并通知已打开的页面', async () => {
  const app = createApplicationHarness()
  try {
    const listed = await app.requireResult('list_application_entities', { entityType: 'screen_recording.setup' })
    expect(listed.refs).toEqual([expect.objectContaining(ref)])
    const before = await app.read(ref)
    expect(before.properties).toMatchObject({ [p('quality')]: '1080p', [p('fps')]: 60, [p('codec')]: 'h264', [p('encoder')]: 'auto', [p('rate_control')]: 'quality', [p('bitrate')]: 18_000_000, [p('keyframe_frames')]: null })
    const events: RecordingVideoSetup[] = []
    const listen = (event: Event): void => { events.push((event as CustomEvent<RecordingVideoSetup>).detail) }
    window.addEventListener(RECORDING_SETUP_CHANGED_EVENT, listen)
    const result = await app.change(ref, { [p('codec')]: 'hevc', [p('fps')]: 30, [p('bitrate')]: 8_000_000, [p('keyframe_frames')]: 60 })
    window.removeEventListener(RECORDING_SETUP_CHANGED_EVENT, listen)
    expect(result.ok, JSON.stringify(result)).toBe(true)
    const stored = loadRecordingSetup().setup
    expect(stored).toMatchObject({ codec: 'hevc', fps: 30, bitrate: 8_000_000, keyframeFrames: 60, mode: 'full', microphone: true })
    expect(recordingOutput(stored)).toMatchObject({ codec: 'hevc', fps: 30, bitrate: 8_000_000, keyframeFrames: 60 })
    expect(events).toEqual([{ quality: '1080p', fps: 30, codec: 'hevc', bitrate: 8_000_000, keyframeFrames: 60 }])
    // The open page takes the video fields and keeps the rest of what it holds.
    expect(mergeRecordingVideoSetup({ ...stored, name: '页面里的名字', codec: 'h264' }, events[0])).toMatchObject({ name: '页面里的名字', codec: 'hevc', fps: 30 })
    const after = await app.read(ref)
    expect(after.properties).toMatchObject({ [p('codec')]: 'hevc', [p('fps')]: 30, [p('bitrate')]: 8_000_000, [p('keyframe_frames')]: 60 })

    const undone = await app.requireResult('undo_application_changes', { undoRef: (result as { data: { undoRef: string } }).data.undoRef })
    expect(undone).toBeTruthy()
    expect(loadRecordingSetup().setup).toMatchObject({ fps: 60 })
    expect(loadRecordingSetup().setup.codec).toBeUndefined()
    expect(loadRecordingSetup().setup.keyframeFrames).toBeUndefined()
    expect((await app.read(ref)).properties).toMatchObject({ [p('codec')]: 'h264', [p('bitrate')]: 18_000_000, [p('keyframe_frames')]: null })
  } finally { app.dispose() }
})

it('非法值点名属性并整体不写；录制页改过后旧基线的写入被拒绝', async () => {
  const app = createApplicationHarness()
  try {
    const bad = await app.change(ref, { [p('fps')]: 45, [p('codec')]: 'hevc' })
    expect(bad.ok).toBe(false)
    expect(JSON.stringify(bad)).toContain('fps')
    expect(loadRecordingSetup().setup.codec).toBeUndefined()
    const baseline = await app.read(ref, [p('quality')])
    // The person changes the quality on the recording page meanwhile.
    const current = loadRecordingSetup()
    saveRecordingSetup({ ...current, setup: { ...current.setup, quality: '2160p' } })
    const stale = await app.call('change_application_entities', { summary: '过期写入', changes: [{ kind: 'set_properties', entityType: ref.kind, target: ref, properties: { [p('quality')]: '1440p' } }] }, baseline.revisions as Record<string, number>)
    expect(stale.ok).toBe(false)
    expect(loadRecordingSetup().setup.quality).toBe('2160p')
    expect((await app.read(ref)).properties[p('bitrate')]).toBe(40_000_000)
  } finally { app.dispose() }
})
