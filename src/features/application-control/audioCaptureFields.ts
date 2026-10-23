import { getPlatform } from '@/platform'
import { audioCaptureSettingsSchema, type AudioCaptureSettings, type AudioCaptureSettingsState, type AudioCaptureInventory } from '@/core/audioCapture/contracts'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/application-control/applicationCapabilities'
import type { ApplicationFieldDefinition, ApplicationPropertyDescriptor, JsonValue } from '@/core/application-control'
import { readAudioCaptureSession } from '@/features/audioCapture'
import { AUDIO_CAPTURE_CONTROL_EXCLUSION, AUDIO_CAPTURE_SETTINGS_TARGET } from '@/core/audioCapture/contracts'

export const AUDIO_CAPTURE_ENTITY = 'audio_capture.settings'
export const captureSchemaRef = (kind: 'entity' | 'property', id: string): ApplicationPropertyDescriptor['schemaRef'] => ({ kind, id, version: 1, catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION, digest: `sha256:${'ac'.repeat(32)}` })
export interface CaptureFieldSource { state: AudioCaptureSettingsState; inventory: AudioCaptureInventory }
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
for (const [key, title, read] of [
  ['devices', '系统音频设备与设备类型；物理设备由系统维护', (s: CaptureFieldSource): JsonValue => JSON.parse(JSON.stringify(s.inventory)) as JsonValue],
  ['effective', '当前可用参数与设备回退说明；不会覆盖保存的偏好', (s: CaptureFieldSource): JsonValue => ({ settings: s.state.effectiveSettings, notice: s.state.notice })],
  ['recording', '音频编辑录音页面及当前会话状态', (): JsonValue => readAudioCaptureSession()],
] as const) {
  const id = `${AUDIO_CAPTURE_ENTITY}.${key}`
  audioCaptureFields.push({ propertyId: id, storeActions: [], read, descriptor: { id, entityType: AUDIO_CAPTURE_ENTITY, version: 1, title, description: title,
    value: { kind: 'json', schemaRef: captureSchemaRef('property', `${id}.value`) }, nullable: false, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], requiredPermissions: { read: ['settings:read'], write: [] }, revisionScopes: ['audio_capture'], schemaRef: captureSchemaRef('property', id), readOnlyReason: key === 'recording' ? AUDIO_CAPTURE_CONTROL_EXCLUSION : '由原生音频设备枚举与设备回退解析维护，不能伪造系统设备。' } })
}
export async function readCaptureFields(): Promise<CaptureFieldSource> {
  const api = getPlatform().audioCapture
  const inventory = await api.enumerate()
  return { inventory, state: await api.getSettings() }
}
