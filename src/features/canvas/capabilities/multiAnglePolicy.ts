import type { CanvasGenerationOutputBatchContractV1 } from '../domain/generationOutputs'

export const MULTI_ANGLE_CONTRACT_VERSION = 1 as const
export const MULTI_ANGLE_BATCH_VERSION = 1 as const
export const MULTI_ANGLE_CONCURRENCY = 2 as const
export const MULTI_ANGLE_DEFAULT_VIEW_COUNT = 4 as const
export const MULTI_ANGLE_MAX_VIEW_COUNT = 6 as const

export const MULTI_ANGLE_PROFILES = ['continuous-v1', 'discrete-v1'] as const
export type MultiAngleControlProfile = (typeof MULTI_ANGLE_PROFILES)[number]
export type MultiAngleControlPrecision = 'learned-native' | 'discrete-native'

export const MULTI_ANGLE_CONTINUOUS_MODEL_ID = 'fal-qwen-image-edit-2509-multiple-angles'
export const MULTI_ANGLE_CONTINUOUS_ENDPOINT_ID = 'fal-ai/qwen-image-edit-2509-lora-gallery/multiple-angles'
export const MULTI_ANGLE_DISCRETE_MODEL_ID = 'fal-perspective-change'
export const MULTI_ANGLE_DISCRETE_ENDPOINT_ID = 'fal-ai/image-apps-v2/perspective'

export const MULTI_ANGLE_DISCRETE_PRESETS = [
  'front', 'left_side', 'right_side', 'back', 'top_down', 'bottom_up',
  'birds_eye', 'three_quarter_left', 'three_quarter_right',
] as const
export type MultiAngleDiscretePreset = (typeof MULTI_ANGLE_DISCRETE_PRESETS)[number]

export interface MultiAngleContinuousViewV1 {
  viewId: string
  kind: 'continuous'
  label: string
  presetId: string
  yawControlDeg: number
  verticalControl: number
  proximity: number
  wideAngle: boolean
}

export interface MultiAngleDiscreteViewV1 {
  viewId: string
  kind: 'discrete'
  label: string
  preset: MultiAngleDiscretePreset
}

export type MultiAngleViewV1 = MultiAngleContinuousViewV1 | MultiAngleDiscreteViewV1

export interface MultiAngleConfigV1 {
  version: 1
  controlProfile: MultiAngleControlProfile
  views: MultiAngleViewV1[]
  concurrency: 2
}

export interface MultiAngleViewPreset<TView extends MultiAngleViewV1 = MultiAngleViewV1> {
  id: string
  label: string
  visual: { x: number; y: number }
  view: TView
}

export const MULTI_ANGLE_CONTINUOUS_PRESETS: readonly MultiAngleViewPreset<MultiAngleContinuousViewV1>[] = [
  continuousPreset('three-quarter-left', '左三分之四', 45, 0, 0, false, -0.62, 0),
  continuousPreset('three-quarter-right', '右三分之四', -45, 0, 0, false, 0.62, 0),
  continuousPreset('left-side', '左侧面', 90, 0, 0, false, -1, 0),
  continuousPreset('right-side', '右侧面', -90, 0, 0, false, 1, 0),
  continuousPreset('top-oblique', '高位斜俯', 0, -0.6, 0, false, 0, -0.72),
  continuousPreset('bottom-oblique', '低位斜仰', 0, 0.6, 0, false, 0, 0.72),
] as const

const DISCRETE_LABELS: Record<MultiAngleDiscretePreset, string> = {
  front: '正面',
  left_side: '左侧面',
  right_side: '右侧面',
  back: '背面',
  top_down: '顶视',
  bottom_up: '仰视',
  birds_eye: '鸟瞰',
  three_quarter_left: '左三分之四',
  three_quarter_right: '右三分之四',
}

const DISCRETE_VISUALS: Record<MultiAngleDiscretePreset, { x: number; y: number }> = {
  front: { x: 0, y: 0.72 },
  left_side: { x: -1, y: 0 },
  right_side: { x: 1, y: 0 },
  back: { x: 0, y: -0.72 },
  top_down: { x: 0, y: -1 },
  bottom_up: { x: 0, y: 1 },
  birds_eye: { x: -0.45, y: -0.78 },
  three_quarter_left: { x: -0.62, y: 0.48 },
  three_quarter_right: { x: 0.62, y: 0.48 },
}

export const MULTI_ANGLE_DISCRETE_VIEW_PRESETS: readonly MultiAngleViewPreset<MultiAngleDiscreteViewV1>[] = (
  MULTI_ANGLE_DISCRETE_PRESETS.map((preset) => ({
    id: preset,
    label: DISCRETE_LABELS[preset],
    visual: DISCRETE_VISUALS[preset],
    view: {
      viewId: `discrete-${preset}`,
      kind: 'discrete' as const,
      label: DISCRETE_LABELS[preset],
      preset,
    },
  }))
)

function continuousPreset(
  id: string,
  label: string,
  yawControlDeg: number,
  verticalControl: number,
  proximity: number,
  wideAngle: boolean,
  x: number,
  y: number,
): MultiAngleViewPreset<MultiAngleContinuousViewV1> {
  return {
    id,
    label,
    visual: { x, y },
    view: {
      viewId: `continuous-${id}`,
      kind: 'continuous',
      label,
      presetId: id,
      yawControlDeg,
      verticalControl,
      proximity,
      wideAngle,
    },
  }
}

function copyView<T extends MultiAngleViewV1>(view: T): T {
  return { ...view }
}

export function createDefaultMultiAngleConfig(
  profile: MultiAngleControlProfile = 'continuous-v1',
): MultiAngleConfigV1 {
  const presets = profile === 'continuous-v1'
    ? MULTI_ANGLE_CONTINUOUS_PRESETS
    : MULTI_ANGLE_DISCRETE_VIEW_PRESETS.filter((preset) => (
        ['front', 'right_side', 'back', 'left_side'].includes(preset.id)
      ))
  return {
    version: 1,
    controlProfile: profile,
    views: presets.slice(0, MULTI_ANGLE_DEFAULT_VIEW_COUNT).map((preset) => copyView(preset.view)),
    concurrency: MULTI_ANGLE_CONCURRENCY,
  }
}

function numberInRange(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function normalizeContinuousView(value: unknown, index: number): MultiAngleContinuousViewV1 {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const fallback = MULTI_ANGLE_CONTINUOUS_PRESETS[index % MULTI_ANGLE_CONTINUOUS_PRESETS.length].view
  const legacyShot = raw.shotSize === 'close-up' ? 7 : raw.shotSize === 'near' ? 3 : 0
  return {
    viewId: stringValue(raw.viewId ?? raw.id, fallback.viewId),
    kind: 'continuous',
    label: stringValue(raw.label, fallback.label),
    presetId: stringValue(raw.presetId ?? raw.viewPreset, fallback.presetId),
    yawControlDeg: numberInRange(raw.yawControlDeg ?? raw.azimuth, -90, 90, fallback.yawControlDeg),
    verticalControl: numberInRange(raw.verticalControl ?? raw.elevation, -1, 1, fallback.verticalControl),
    proximity: numberInRange(raw.proximity ?? legacyShot, 0, 10, fallback.proximity),
    wideAngle: raw.wideAngle === true,
  }
}

function normalizeDiscreteView(value: unknown, index: number): MultiAngleDiscreteViewV1 {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const fallback = MULTI_ANGLE_DISCRETE_VIEW_PRESETS[index % MULTI_ANGLE_DISCRETE_VIEW_PRESETS.length].view
  const preset = MULTI_ANGLE_DISCRETE_PRESETS.includes(raw.preset as MultiAngleDiscretePreset)
    ? raw.preset as MultiAngleDiscretePreset
    : fallback.preset
  return {
    viewId: stringValue(raw.viewId ?? raw.id, `discrete-${preset}`),
    kind: 'discrete',
    label: stringValue(raw.label, DISCRETE_LABELS[preset]),
    preset,
  }
}

/** 旧草案的 id/azimuth/elevation/shotSize 在这里单点迁移。 */
export function normalizeMultiAngleConfig(value: unknown): MultiAngleConfigV1 {
  if (!value || typeof value !== 'object') return createDefaultMultiAngleConfig()
  const raw = value as Record<string, unknown>
  if (raw.version !== undefined && raw.version !== 1) {
    throw new Error(`不支持的多角度契约版本：${String(raw.version)}`)
  }
  const profile: MultiAngleControlProfile = raw.controlProfile === 'discrete-v1'
    ? 'discrete-v1'
    : 'continuous-v1'
  const sourceViews = Array.isArray(raw.views) ? raw.views : createDefaultMultiAngleConfig(profile).views
  return {
    version: 1,
    controlProfile: profile,
    views: sourceViews.map((view, index) => (
      profile === 'continuous-v1'
        ? normalizeContinuousView(view, index)
        : normalizeDiscreteView(view, index)
    )),
    concurrency: MULTI_ANGLE_CONCURRENCY,
  }
}

export function validateMultiAngleConfig(value: unknown): MultiAngleConfigV1 {
  const config = normalizeMultiAngleConfig(value)
  if (config.views.length < 1 || config.views.length > MULTI_ANGLE_MAX_VIEW_COUNT) {
    throw new Error(`多角度视图数量必须在 1 到 ${MULTI_ANGLE_MAX_VIEW_COUNT} 之间`)
  }
  const ids = new Set<string>()
  const controls = new Set<string>()
  for (const view of config.views) {
    if (ids.has(view.viewId)) throw new Error(`多角度视图编号重复：${view.viewId}`)
    ids.add(view.viewId)
    if (config.controlProfile === 'continuous-v1' && view.kind !== 'continuous') {
      throw new Error('连续档结果组不能混入离散视图')
    }
    if (config.controlProfile === 'discrete-v1' && view.kind !== 'discrete') {
      throw new Error('离散档结果组不能混入连续视图')
    }
    const signature = view.kind === 'continuous'
      ? `${view.yawControlDeg}/${view.verticalControl}/${view.proximity}/${view.wideAngle}`
      : view.preset
    if (controls.has(signature)) throw new Error(`多角度视图控制重复：${view.label}`)
    controls.add(signature)
  }
  return config
}

export interface MultiAngleBatchPlanItem {
  viewId: string
  order: number
  label: string
  profile: MultiAngleControlProfile
  precision: MultiAngleControlPrecision
  modelId: string
  endpointId: string
  cameraControl: MultiAngleViewV1
  params: DynamicValueMap
}

export function createMultiAngleBatchPlan(
  value: unknown,
  sourceImage: string,
): MultiAngleBatchPlanItem[] {
  const source = sourceImage.trim()
  if (!source) throw new Error('多角度生成需要 1 张源图')
  const config = validateMultiAngleConfig(value)
  return config.views.map((view, order) => ({
    viewId: view.viewId,
    order,
    label: view.label,
    profile: config.controlProfile,
    precision: config.controlProfile === 'continuous-v1' ? 'learned-native' : 'discrete-native',
    modelId: config.controlProfile === 'continuous-v1'
      ? MULTI_ANGLE_CONTINUOUS_MODEL_ID
      : MULTI_ANGLE_DISCRETE_MODEL_ID,
    endpointId: config.controlProfile === 'continuous-v1'
      ? MULTI_ANGLE_CONTINUOUS_ENDPOINT_ID
      : MULTI_ANGLE_DISCRETE_ENDPOINT_ID,
    cameraControl: copyView(view),
    params: view.kind === 'continuous'
      ? {
          image: [source],
          rotateRightLeft: view.yawControlDeg,
          verticalAngle: view.verticalControl,
          moveForward: view.proximity,
          wideAngleLens: view.wideAngle,
        }
      : { image: [source], targetPerspective: view.preset },
  }))
}

export interface MultiAngleCompletedView {
  plan: MultiAngleBatchPlanItem
  mediaUrl: string
  providerRequestId: string
}

export function createMultiAngleCommitContract(
  completed: readonly MultiAngleCompletedView[],
): CanvasGenerationOutputBatchContractV1 {
  if (completed.length < 1) throw new Error('多角度批次没有完整输出')
  const ordered = [...completed].sort((left, right) => left.plan.order - right.plan.order)
  const profile = ordered[0].plan.profile
  if (ordered.some((item, index) => item.plan.order !== index || item.plan.profile !== profile)) {
    throw new Error('多角度输出顺序不连续或混用了控制档')
  }
  return {
    version: 1,
    strategy: ordered.length === 1 ? 'single' : 'assetGroup',
    resultKind: ordered.length === 1 ? 'image' : 'image-group',
    expectedOutputCount: ordered.length,
    outputs: ordered.map((item) => ({
      source: item.mediaUrl,
      descriptor: {
        version: 1,
        outputId: `multi-angle:${item.plan.viewId}`,
        order: item.plan.order,
        sourceOutputIndex: item.plan.order,
        mediaType: 'image',
        semantic: { kind: 'camera-view', resultKind: 'image', label: item.plan.label },
        profile: { id: item.plan.profile, precision: item.plan.precision },
        angle: { control: { ...item.plan.cameraControl } },
        metadata: {
          providerId: 'fal',
          endpointId: item.plan.endpointId,
          providerRequestId: item.providerRequestId,
          viewId: item.plan.viewId,
        },
      },
    })),
  }
}

export function summarizeMultiAngleConfig(value: unknown): string {
  const config = normalizeMultiAngleConfig(value)
  return `${config.controlProfile === 'continuous-v1' ? '连续控制' : '离散方位'} · ${config.views.length} 个视图`
}
