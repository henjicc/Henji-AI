import type { CaptureSource } from '@/core/screenRecording/contracts'
import { createLogger } from '@/core/logging'
import { recordingSetupSchema } from '@/core/persistence/preferenceSchemas'
import { localLibraryContract, readLocalPersistenceJson, serializeVersionedPersistenceJson } from '@/core/persistence/versionedJson'

export type RecordingRangeMode = 'screen' | 'window' | 'region'
export interface RecordingRegion { x: number; y: number; width: number; height: number }
export const FULL_REGION: RecordingRegion = { x: 0, y: 0, width: 1, height: 1 }
/** Screen sources numbered left-to-right, top-to-bottom, the way people point at their monitors. */
export function orderedScreens(sources: readonly CaptureSource[]): CaptureSource[] {
  return sources.filter(source => source.kind === 'screen').sort((a, b) => (a.display?.x ?? 0) - (b.display?.x ?? 0) || (a.display?.y ?? 0) - (b.display?.y ?? 0))
}

export type RecordingQuality = '1080p' | '1440p' | '2160p'
/** `full` keeps every track separate for AI editing; `quick` records the pointer in and saves one MP4. */
export type RecordingMode = 'full' | 'quick'
export interface RecordingSetup {
  mode: RecordingMode
  /** Quick mode output folder; empty means the app's export folder. */
  saveDirectory: string
  name: string
  microphone: boolean; microphoneId: string
  systemAudio: boolean
  camera: boolean; cameraId: string
  quality: RecordingQuality; fps: 30 | 60
  insert: boolean
}
export const DEFAULT_RECORDING_SETUP: RecordingSetup = { mode: 'full', saveDirectory: '', name: '', microphone: true, microphoneId: '', systemAudio: false, camera: false, cameraId: '', quality: '1080p', fps: 60, insert: true }

/** What the picker and setup panel offer next time, across restarts. */
export interface RememberedRecordingSetup { range: RecordingRangeMode; sourceId: string; region: RecordingRegion; setup: RecordingSetup }
const SETUP_KEY = 'henji-recording-setup'
const logger = createLogger('features.screenRecording.setup')
const setupContract = (): ReturnType<typeof localLibraryContract> => localLibraryContract(SETUP_KEY, recordingSetupSchema)

export function loadRecordingSetup(storage: Storage = window.localStorage): RememberedRecordingSetup {
  const fallback: RememberedRecordingSetup = { range: 'screen', sourceId: '', region: FULL_REGION, setup: DEFAULT_RECORDING_SETUP }
  try {
    const text = storage.getItem(SETUP_KEY)
    if (!text) return fallback
    const { range, sourceId, region, ...setup } = recordingSetupSchema.parse(readLocalPersistenceJson(text, SETUP_KEY, setupContract(), storage))
    return { range, sourceId, region, setup: { ...setup, name: '' } }
  } catch (error) {
    logger.warn('录制设置读取失败，使用默认设置', { event: 'recording.setup.load.failed', error: String(error) })
    return fallback
  }
}
export function saveRecordingSetup(value: RememberedRecordingSetup, storage: Storage = window.localStorage): void {
  const { name: _name, ...setup } = value.setup
  try { storage.setItem(SETUP_KEY, serializeVersionedPersistenceJson(setupContract(), { range: value.range, sourceId: value.sourceId, region: value.region, ...setup })) }
  catch (error) { logger.warn('录制设置保存失败', { event: 'recording.setup.save.failed', error: String(error) }) }
}
const OUTPUT: Record<RecordingQuality, { width: number; height: number; bitrate: number }> = {
  '1080p': { width: 1920, height: 1080, bitrate: 12_000_000 },
  '1440p': { width: 2560, height: 1440, bitrate: 20_000_000 },
  '2160p': { width: 3840, height: 2160, bitrate: 36_000_000 },
}
/** Output canvas and bitrate for the chosen quality; 60 fps gets half again the bitrate for the same detail. */
export function recordingOutput(setup: Pick<RecordingSetup, 'quality' | 'fps'>): { width: number; height: number; fps: 30 | 60; bitrate: number } {
  const output = OUTPUT[setup.quality]
  return { width: output.width, height: output.height, fps: setup.fps, bitrate: setup.fps === 60 ? Math.round(output.bitrate * 1.5) : output.bitrate }
}


export function formatRecordingTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${(whole % 60).toString().padStart(2, '0')}`
}
