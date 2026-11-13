import { getPlatform } from '@/platform'
import { audioCaptureSettingsSchema, type AudioCaptureSettings, type AudioCaptureSettingsState, type AudioCaptureInventory } from '@/core/audioCapture/contracts'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/application-control/applicationCapabilities'
import type { ApplicationFieldDefinition, ApplicationPropertyDescriptor, JsonValue } from '@/core/application-control'
import { readAudioCaptureMain, readAudioCapturePendingFiles, readAudioCaptureRecording } from '@/features/audioCapture'
import { AUDIO_CAPTURE_SETTINGS_TARGET } from '@/core/audioCapture/contracts'

export const AUDIO_CAPTURE_ENTITY = 'audio_capture.settings'
/** 录音状态只读：由录音会话维护，开始、暂停、继续、停止、恢复走 *_audio_edit_recording 一组操作。 */
export const AUDIO_CAPTURE_RECORDING_REASON = '录音状态由录音会话维护；开始、暂停、继续、停止用 start/pause/resume/stop_audio_edit_recording，中断后用 recover_audio_edit_recording。'
export const captureSchemaRef = (kind: 'entity' | 'property', id: string): ApplicationPropertyDescriptor['schemaRef'] => ({ kind, id, version: 1, catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION, digest: `sha256:${'ac'.repeat(32)}` })
/** recording 与 pending_files 只在被读到时才去主进程取：改一个录音参数不必顺带扫一遍录音文件。 */
export interface CaptureFieldSource { state: AudioCaptureSettingsState; inventory: AudioCaptureInventory; recording?: JsonValue; pendingFiles?: JsonValue }
type Field = ApplicationFieldDefinition<CaptureFieldSource, { settings: AudioCaptureSettings }>
const enums = (values: readonly string[]): ApplicationPropertyDescriptor['value'] => ({ kind: 'enum', values: values.map(value => ({ value, label: value })) })
function setting(key: keyof AudioCaptureSettings, title: string, value: ApplicationPropertyDescriptor['value']): Field {
  const id = `${AUDIO_CAPTURE_ENTITY}.${key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)}`
  return { propertyId: id, storeActions: [], read: s => s.state.settings[key], writer: { write: (draft, mutation) => { draft.settings = audioCaptureSettingsSchema.parse({ ...draft.settings, [key]: mutation.value }) } },
    descriptor: { id, entityType: AUDIO_CAPTURE_ENTITY, version: 1, title, description: `${title}；界面位置：通用 › 录音（${AUDIO_CAPTURE_SETTINGS_TARGET.sectionId}）`, value, nullable: false, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], requiredPermissions: { read: ['settings:read'], write: ['settings:write'] }, revisionScopes: ['audio_capture'], schemaRef: captureSchemaRef('property', id) } }
}
export const audioCaptureFields: Field[] = [
  setting('hostApi', '录音设备类型；default 跟随系统，WASAPI 独占由 exclusive 控制', enums(audioCaptureSettingsSchema.shape.hostApi.options)),
  setting('deviceName', '录音设备名称；从 devices 读取，空字符串使用所选类型的默认输入', { kind: 'string', maxLength: 512 }),
  setting('deviceOrdinal', '同类型同名设备的序号，从零开始', { kind: 'integer', hardRange: { min: 0, max: 255 } }),
  setting('firstChannel', '起始输入通道，从零开始；输入 3/4 填 2 并选双声道', { kind: 'integer', hardRange: { min: 0, max: 255 } }),
  setting('channels', '声道数：1 单声道、2 双声道', { kind: 'integer', hardRange: { min: 1, max: 2 } }),
  setting('sampleRate', '采样率 Hz：8000/11025/16000/22050/32000/44100/48000/88200/96000/176400/192000；需要设备支持', { kind: 'integer', hardRange: { min: 8000, max: 192000 } }),
  setting('bitDepth', '文件采样格式：16/24 位整数或 32 位浮点；不代表设备物理 ADC 精度', { kind: 'integer', hardRange: { min: 16, max: 32 } }),
  setting('bufferFrames', '每次回调的采样帧数，0 由驱动决定；ASIO 硬件缓冲由驱动控制', { kind: 'integer', hardRange: { min: 0, max: 8192 } }),
  setting('suggestedLatency', '建议输入延迟，单位秒；0 使用设备默认低延迟', { kind: 'number', hardRange: { min: 0, max: 2 } }),
  setting('exclusive', 'WASAPI 独占录音；独占失败会报错，不会静默改共享', { kind: 'boolean' }),
]
for (const [key, title, read, detail] of [
  ['devices', '系统音频设备与设备类型；物理设备由系统维护', (s: CaptureFieldSource): JsonValue => JSON.parse(JSON.stringify(s.inventory)) as JsonValue, ''],
  ['effective', '当前可用参数与设备回退说明；不会覆盖保存的偏好', (s: CaptureFieldSource): JsonValue => ({ settings: s.state.effectiveSettings, notice: s.state.notice }), ''],
  ['recording', '音频编辑录音状态', (s: CaptureFieldSource): JsonValue => s.recording ?? null, '以主进程为准，界面重载后、还没接管前也准：phase 是否在录或暂停、中断；documentId 与 positionSeconds 是录进哪份口播的哪一秒（剪后作品时间，与 start_audio_edit_recording 的 positionSeconds 同一坐标；这一段的起点，录到 positionSeconds + durationSeconds）；durationSeconds 已录时长；health 是溢出、写盘跟不上丢的帧（已补静音）、写盘峰值；error 中断原因；attached 为 false 表示界面还没接管，停止照样可用；microphoneInUse 为 true 时讲解正占着麦克风，不能开始录音（录屏的麦克风不占，可同时录）；busy 为 true 时界面或后台正在处理上一个录音操作，等它完成；lastTake 是助手最近一次拼回的那一段（outputPath 标明哪一段）：state=saving 还在拼、saved 已拼回（undoRef 交给 undo_audio_edit）、failed 没拼回（error 是原因）'],
  ['pending_files', '待恢复的录音文件', (s: CaptureFieldSource): JsonValue => s.pendingFiles ?? [], '中断或崩溃后还没拼回作品的录音：文件、时长、原口播与位置（positionSeconds 为剪后作品时间）、中断原因；交给 recover_audio_edit_recording 拼回或移到回收区'],
] as const) {
  const id = `${AUDIO_CAPTURE_ENTITY}.${key}`
  audioCaptureFields.push({ propertyId: id, storeActions: [], read, descriptor: { id, entityType: AUDIO_CAPTURE_ENTITY, version: 1, title, description: detail || title,
    value: { kind: 'json', schemaRef: captureSchemaRef('property', `${id}.value`) }, nullable: false, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], requiredPermissions: { read: ['settings:read'], write: [] }, revisionScopes: ['audio_capture'], schemaRef: captureSchemaRef('property', id),
    readOnlyReason: key === 'recording' || key === 'pending_files' ? AUDIO_CAPTURE_RECORDING_REASON : '由原生音频设备枚举与设备回退解析维护，不能伪造系统设备。' } })
}
/** 只读录音状态与待恢复文件的属性：读它们时不去枚举设备、解析设置（那两步在主进程排在录音操作后面）。 */
export const AUDIO_CAPTURE_LIFECYCLE_PROPERTIES = new Set([`${AUDIO_CAPTURE_ENTITY}.recording`, `${AUDIO_CAPTURE_ENTITY}.pending_files`])
export async function readCaptureLifecycle(propertyIds: readonly string[]): Promise<{ revision: number; values: Record<string, JsonValue> }> {
  const main = await readAudioCaptureMain()
  const values: Record<string, JsonValue> = {}
  if (propertyIds.includes(`${AUDIO_CAPTURE_ENTITY}.recording`)) values[`${AUDIO_CAPTURE_ENTITY}.recording`] = JSON.parse(JSON.stringify(await readAudioCaptureRecording(main))) as JsonValue
  if (propertyIds.includes(`${AUDIO_CAPTURE_ENTITY}.pending_files`)) values[`${AUDIO_CAPTURE_ENTITY}.pending_files`] = JSON.parse(JSON.stringify(await readAudioCapturePendingFiles(main))) as JsonValue
  return { revision: main.settingsRevision, values }
}
export async function readCaptureFields(propertyIds?: readonly string[]): Promise<CaptureFieldSource> {
  const api = getPlatform().audioCapture
  const wants = (key: string): boolean => !propertyIds || propertyIds.includes(`${AUDIO_CAPTURE_ENTITY}.${key}`)
  const [inventory, state, lifecycle] = await Promise.all([api.enumerate(), api.getSettings(), wants('recording') || wants('pending_files') ? readCaptureLifecycle([...AUDIO_CAPTURE_LIFECYCLE_PROPERTIES]) : undefined])
  return { inventory, state, ...(lifecycle ? { recording: lifecycle.values[`${AUDIO_CAPTURE_ENTITY}.recording`], pendingFiles: lifecycle.values[`${AUDIO_CAPTURE_ENTITY}.pending_files`] } : {}) }
}
