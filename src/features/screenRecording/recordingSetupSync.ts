import { loadRecordingSetup, saveRecordingSetup, type RecordingSetup } from './recordingSetupModel'

/** The open recording page listens for this and takes over the changed fields, so a later page save cannot undo them. */
export const RECORDING_SETUP_CHANGED_EVENT = 'henji:recording-setup-changed'
export const RECORDING_VIDEO_KEYS = ['quality', 'fps', 'codec', 'encoder', 'rateControl', 'bitrate', 'keyframeFrames'] as const
export type RecordingVideoKey = typeof RECORDING_VIDEO_KEYS[number]
export type RecordingVideoSetup = Pick<RecordingSetup, RecordingVideoKey>

export function readRecordingVideoSetup(): RecordingVideoSetup {
  const { setup } = loadRecordingSetup()
  return Object.fromEntries(RECORDING_VIDEO_KEYS.flatMap(key => setup[key] === undefined ? [] : [[key, setup[key]]])) as RecordingVideoSetup
}
/** Content-derived revision: a change made on the page also moves it, so a stale write from elsewhere is refused. */
export function recordingVideoSetupRevision(value: RecordingVideoSetup = readRecordingVideoSetup()): number {
  let hash = 0x811c9dc5
  for (const char of JSON.stringify(RECORDING_VIDEO_KEYS.map(key => value[key] ?? null))) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0
  return hash
}
/** Writes the video settings outside the recording page (assistant, undo). Absent keys go back to automatic. */
export function writeRecordingVideoSetup(value: RecordingVideoSetup): RecordingVideoSetup {
  const current = loadRecordingSetup()
  const setup = { ...current.setup }
  for (const key of RECORDING_VIDEO_KEYS) delete setup[key]
  saveRecordingSetup({ ...current, setup: { ...setup, ...value } as RecordingSetup })
  const saved = readRecordingVideoSetup()
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<RecordingVideoSetup>(RECORDING_SETUP_CHANGED_EVENT, { detail: saved }))
  return saved
}
/** For the page: replace its video fields with what was written elsewhere, keep everything else it holds. */
export function mergeRecordingVideoSetup<T extends RecordingSetup>(page: T, written: RecordingVideoSetup): T {
  const next = { ...page }
  for (const key of RECORDING_VIDEO_KEYS) delete next[key]
  return { ...next, ...written }
}
