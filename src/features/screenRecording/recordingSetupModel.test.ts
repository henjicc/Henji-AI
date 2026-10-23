import { describe, expect, it } from 'vitest'
import { DEFAULT_RECORDING_SETUP, loadRecordingSetup, saveRecordingSetup } from './recordingSetupModel'

function memory(): Storage {
  const values = new Map<string, string>()
  return { get length() { return values.size }, clear: () => values.clear(), key: index => [...values.keys()][index] ?? null, getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) }, removeItem: key => { values.delete(key) } }
}

describe('录制设置记忆', () => {
  it('旧版偏好升级备份但不改写原件，新参数使用默认', () => {
    const storage = memory(), { name: _name, ...setup } = DEFAULT_RECORDING_SETUP
    const raw = JSON.stringify({ version: 1, content: { range: 'screen', sourceId: '', region: { x: 0, y: 0, width: 1, height: 1 }, ...setup } })
    storage.setItem('henji-recording-setup', raw)
    expect(loadRecordingSetup(storage).setup).toEqual(DEFAULT_RECORDING_SETUP)
    expect(storage.getItem('henji-recording-setup')).toBe(raw)
    expect(storage.length).toBeGreaterThan(1)
  })
  it('首次默认 60 帧；保存后重启读回上次的范围、来源、画质与帧率，会话名不保留', () => {
    const storage = memory()
    expect(loadRecordingSetup(storage)).toMatchObject({ range: 'screen', sourceId: '', setup: { fps: 60, quality: '1080p' } })
    saveRecordingSetup({ range: 'window', sourceId: 'window:42:0', region: { x: 0, y: 0, width: 1, height: 1 }, setup: { ...DEFAULT_RECORDING_SETUP, name: '这次的名字', quality: '1440p', fps: 30, mode: 'quick', systemAudio: true } }, storage)
    expect(loadRecordingSetup(storage)).toEqual({ range: 'window', sourceId: 'window:42:0', region: { x: 0, y: 0, width: 1, height: 1 }, setup: { ...DEFAULT_RECORDING_SETUP, name: '', quality: '1440p', fps: 30, mode: 'quick', systemAudio: true } })
  })
  it('记录损坏时回到默认，不阻断录制', () => {
    const storage = memory(); storage.setItem('henji-recording-setup', '{坏')
    expect(loadRecordingSetup(storage).setup).toEqual(DEFAULT_RECORDING_SETUP)
  })
})
