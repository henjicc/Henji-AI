import type { LocalModelRunner, LocalTensorInput, LocalTensorOutput } from '../analysis'

/*
 * EfficientTAM-Ti 512 视频分割的跟踪循环（任务 4.10，形状跟踪）：四个 ONNX 部件 + 遮罩缩小部件，
 * 按导出方参考实现 `henji-model-export/scripts/track_onnx.py`（复现官方 add_new_points_or_box / add_new_mask +
 * propagate_in_video）逐步对照写成；张量名、形状与记忆库约定见模型目录 SOURCE.md。
 *
 * - 条件帧（用户给提示的帧）：图像编码 → 解码器（vision_feat_nomem + 点 / 框）→ 记忆编码（二值化）；
 *   点了一个点且选了候选掩码时，按“给遮罩开始跟踪”处理选中的候选（官方 add_new_mask）。
 * - 跟踪帧：图像编码 → 记忆注意力（全部条件帧 + 方向上最近 6 帧的记忆，条件帧 + 最近 15 帧的目标指针）
 *   → 解码器（占位点，多掩码）→ 记忆编码（不二值化）。
 * - 正向、反向一视同仁：“之前的帧”按跟踪方向取（官方 track_in_reverse）。
 * 推理会话、帧数据由调用方注入（单测用替身逐帧核对装配）。
 */

export const ETAM_IMAGE_SIZE = 512
export const ETAM_LOW_RES = 128
const FEATURE_SIZE = 256 * 32 * 32
const NUM_MASKMEM = 7
const MAX_OBJ_PTRS = 16
/** 记忆库里最多带几个条件帧（官方默认全部；提示很多时只取时间上最近的几个，控制记忆注意力的开销）。 */
export const ETAM_MAX_COND_IN_ATTENTION = 4

export interface EtamParts {
  imageEncoder: LocalModelRunner
  maskDecoder: LocalModelRunner
  memoryEncoder: LocalModelRunner
  memoryAttention: LocalModelRunner
  maskDownsample: LocalModelRunner
}

export interface EtamFeatures { feat: Float32Array; nomem: Float32Array }
export interface EtamFrameResult {
  /** 128×128 掩码 logit（> 0 为前景；物体不在画面时整张为 -1024）。 */
  logits: Float32Array
  /** 物体在画面中的分数（> 0 在）。 */
  score: number
  pointer: Float32Array
}
/** 记忆库里一帧：记忆特征与目标指针。 */
export interface EtamMemory { memory: Float32Array; pointer: Float32Array }

/** 模型坐标系的提示：点（像素，0–512）与标签（1 正、0 负、2 框左上、3 框右下）。 */
export interface EtamPrompt { coords: Array<[number, number]>; labels: number[]; candidate?: number }

const f32 = (data: Float32Array, dims: readonly number[]): LocalTensorInput => ({ type: 'float32', data, dims })
function output(outputs: Record<string, LocalTensorOutput>, name: string): Float32Array {
  const value = outputs[name]?.data
  if (!(value instanceof Float32Array)) throw new Error(`EfficientTAM 输出 ${name} 不是单精度张量。`)
  return value
}

/** RGB24（512×512，已拉伸）→ [1,3,512,512] 0–1（归一化在图内）。 */
export function etamImageTensor(rgb: Uint8Array, target = new Float32Array(3 * ETAM_IMAGE_SIZE * ETAM_IMAGE_SIZE)): Float32Array {
  const plane = ETAM_IMAGE_SIZE * ETAM_IMAGE_SIZE
  for (let index = 0; index < plane; index++) {
    target[index] = rgb[index * 3] / 255; target[plane + index] = rgb[index * 3 + 1] / 255; target[plane * 2 + index] = rgb[index * 3 + 2] / 255
  }
  return target
}

/** 归一化提示（片段画面 0–1）→ 模型坐标：画面拉伸到 512×512，坐标 × 512；框放在最前面（官方要求）。 */
export function etamPromptFromNormalized(prompt: { points?: ReadonlyArray<readonly [number, number, number]>; box?: readonly [number, number, number, number]; candidate?: number }): EtamPrompt {
  const coords: Array<[number, number]> = []; const labels: number[] = []
  if (prompt.box) {
    const [x, y, width, height] = prompt.box
    coords.push([x * ETAM_IMAGE_SIZE, y * ETAM_IMAGE_SIZE], [(x + width) * ETAM_IMAGE_SIZE, (y + height) * ETAM_IMAGE_SIZE]); labels.push(2, 3)
  }
  for (const [x, y, label] of prompt.points ?? []) { coords.push([x * ETAM_IMAGE_SIZE, y * ETAM_IMAGE_SIZE]); labels.push(label) }
  return { coords, labels, ...(prompt.candidate ? { candidate: prompt.candidate } : {}) }
}

/** 512×512 的 0/1 遮罩做“面积平均”缩到 128×128 的 logit（×20 − 10，官方用带抗锯齿的双线性；4×4 面积平均与之等价到 1e-6 量级）。 */
export function etamMaskLogits(mask: Float32Array): Float32Array {
  const factor = ETAM_IMAGE_SIZE / ETAM_LOW_RES
  const output = new Float32Array(ETAM_LOW_RES * ETAM_LOW_RES)
  for (let y = 0; y < ETAM_LOW_RES; y++) for (let x = 0; x < ETAM_LOW_RES; x++) {
    let sum = 0
    for (let dy = 0; dy < factor; dy++) for (let dx = 0; dx < factor; dx++) sum += mask[(y * factor + dy) * ETAM_IMAGE_SIZE + x * factor + dx]
    output[y * ETAM_LOW_RES + x] = sum / (factor * factor) * 20 - 10
  }
  return output
}

/** 128×128 logit 双线性放大到 512×512（align_corners = false）后 > 0 的 0/1 遮罩（候选掩码转“遮罩提示”用）。 */
export function etamUpsampleBinary(logits: Float32Array): Float32Array {
  const output = new Float32Array(ETAM_IMAGE_SIZE * ETAM_IMAGE_SIZE)
  const scale = ETAM_LOW_RES / ETAM_IMAGE_SIZE
  for (let y = 0; y < ETAM_IMAGE_SIZE; y++) {
    const fy = Math.max(0, Math.min(ETAM_LOW_RES - 1, (y + 0.5) * scale - 0.5)); const y0 = Math.floor(fy); const y1 = Math.min(ETAM_LOW_RES - 1, y0 + 1); const ty = fy - y0
    for (let x = 0; x < ETAM_IMAGE_SIZE; x++) {
      const fx = Math.max(0, Math.min(ETAM_LOW_RES - 1, (x + 0.5) * scale - 0.5)); const x0 = Math.floor(fx); const x1 = Math.min(ETAM_LOW_RES - 1, x0 + 1); const tx = fx - x0
      const value = (logits[y0 * ETAM_LOW_RES + x0] * (1 - tx) + logits[y0 * ETAM_LOW_RES + x1] * tx) * (1 - ty) + (logits[y1 * ETAM_LOW_RES + x0] * (1 - tx) + logits[y1 * ETAM_LOW_RES + x1] * tx) * ty
      output[y * ETAM_IMAGE_SIZE + x] = value > 0 ? 1 : 0
    }
  }
  return output
}

/**
 * 记忆库装配（与参考实现逐项一致）：第 f 帧、方向 direction（+1 正向、-1 反向）要用的记忆与目标指针。
 * - 记忆：条件帧（最多 ETAM_MAX_COND_IN_ATTENTION 个，时间最近优先）时间编号 6；方向上之前第 k 帧（k = 6…1，存在且不是条件帧）编号 k − 1；
 * - 指针：方向上不晚于 f 的条件帧，加之前第 1…15 帧（不超过 min(总帧数, 16) − 1，越出跟踪范围即停）。
 * 返回帧号列表（调用方按帧号取记忆），顺序同参考实现：条件帧在前，记忆由远到近，指针由近到远。
 */
export function etamMemoryPlan(frame: number, direction: 1 | -1, condFrames: readonly number[], hasNonCond: (frame: number) => boolean, range: { first: number; last: number }): { memory: Array<{ frame: number; tpos: number }>; pointers: number[] } {
  const cond = [...condFrames].sort((a, b) => Math.abs(a - frame) - Math.abs(b - frame) || a - b).slice(0, ETAM_MAX_COND_IN_ATTENTION).sort((a, b) => a - b)
  const memory = cond.map(entry => ({ frame: entry, tpos: NUM_MASKMEM - 1 }))
  for (let tpos = 1; tpos < NUM_MASKMEM; tpos++) {
    const relative = NUM_MASKMEM - tpos
    const previous = frame - direction * relative
    if (hasNonCond(previous)) memory.push({ frame: previous, tpos: relative - 1 })
  }
  const total = range.last - range.first + 1
  const maxPointers = Math.min(total, MAX_OBJ_PTRS)
  const pointers = condFrames.filter(entry => direction === 1 ? entry <= frame : entry >= frame)
  for (let distance = 1; distance < maxPointers; distance++) {
    const previous = frame - direction * distance
    if (previous < range.first || previous > range.last) break
    if (hasNonCond(previous)) pointers.push(previous)
  }
  return { memory, pointers }
}

export class EfficientTamSession {
  private readonly image = new Float32Array(3 * ETAM_IMAGE_SIZE * ETAM_IMAGE_SIZE)
  constructor(private readonly parts: EtamParts) {}

  async encode(rgb: Uint8Array): Promise<EtamFeatures> {
    const outputs = await this.parts.imageEncoder.run({ image: f32(etamImageTensor(rgb, this.image), [1, 3, ETAM_IMAGE_SIZE, ETAM_IMAGE_SIZE]) })
    return { feat: output(outputs, 'vision_feat').slice(), nomem: output(outputs, 'vision_feat_nomem').slice() }
  }

  private async decode(pixFeat: Float32Array, prompt: EtamPrompt, multimask: boolean, maskInput?: Float32Array): Promise<EtamFrameResult & { candidates?: Float32Array; iou: Float32Array }> {
    const count = prompt.coords.length
    const outputs = await this.parts.maskDecoder.run({
      pix_feat: f32(pixFeat, [1, 256, 32, 32]),
      point_coords: f32(Float32Array.from(prompt.coords.flat()), [1, count, 2]),
      point_labels: f32(Float32Array.from(prompt.labels), [1, count]),
      mask_input: f32(maskInput ?? new Float32Array(ETAM_LOW_RES * ETAM_LOW_RES), [1, 1, ETAM_LOW_RES, ETAM_LOW_RES]),
      has_mask_input: f32(Float32Array.of(maskInput ? 1 : 0), [1]),
      multimask_output: f32(Float32Array.of(multimask ? 1 : 0), [1]),
    })
    const candidates = outputs[ETAM_CANDIDATES_OUTPUT]?.data
    return {
      logits: output(outputs, 'mask_logits').slice(), score: output(outputs, 'object_score_logits')[0], pointer: output(outputs, 'obj_ptr').slice(),
      iou: output(outputs, 'iou_scores').slice(), ...(candidates instanceof Float32Array ? { candidates: candidates.slice() } : {}),
    }
  }

  /** 遮罩提示（官方 add_new_mask）：掩码就是遮罩本身，目标指针由解码器从遮罩提示得出，物体分数取 10。 */
  async maskPrompt(features: EtamFeatures, mask: Float32Array): Promise<EtamFrameResult> {
    if (!mask.some(value => value > 0)) throw new Error('遮罩提示是空的。')
    const dense = output(await this.parts.maskDownsample.run({ mask: f32(mask, [1, 1, ETAM_IMAGE_SIZE, ETAM_IMAGE_SIZE]) }), 'mask_prompt')
    const decoded = await this.decode(features.feat, { coords: [[0, 0]], labels: [-1] }, false, dense)
    return { logits: etamMaskLogits(mask), score: 10, pointer: decoded.pointer }
  }

  /**
   * 条件帧：点 / 框提示（官方规则：真实点数 ≤ 1 时多掩码，框算 2 个点）。指定候选时把那个候选当遮罩提示重新起始。
   * 返回结果与 3 个候选（多掩码输出 1–3 的 logit，界面让用户挑）。
   */
  async prompt(features: EtamFeatures, prompt: EtamPrompt): Promise<EtamFrameResult & { candidates?: Float32Array[]; candidateScores?: number[] }> {
    const decoded = await this.decode(features.nomem, prompt, prompt.coords.length <= 1)
    const candidates = decoded.candidates ? [1, 2, 3].map(index => decoded.candidates!.subarray(index * ETAM_LOW_RES * ETAM_LOW_RES, (index + 1) * ETAM_LOW_RES * ETAM_LOW_RES).slice()) : undefined
    const extra = candidates ? { candidates, candidateScores: [decoded.iou[1], decoded.iou[2], decoded.iou[3]] } : {}
    if (prompt.candidate && candidates) {
      const chosen = await this.maskPrompt(features, etamUpsampleBinary(candidates[prompt.candidate - 1]))
      return { ...chosen, ...extra }
    }
    return { logits: decoded.logits, score: decoded.score, pointer: decoded.pointer, ...extra }
  }

  async encodeMemory(features: EtamFeatures, result: Pick<EtamFrameResult, 'logits' | 'score'>, binarize: boolean): Promise<Float32Array> {
    return output(await this.parts.memoryEncoder.run({
      vision_feat: f32(features.feat, [1, 256, 32, 32]), mask_logits: f32(result.logits, [1, 1, ETAM_LOW_RES, ETAM_LOW_RES]),
      object_score_logits: f32(Float32Array.of(result.score), [1, 1]), binarize: f32(Float32Array.of(binarize ? 1 : 0), [1]),
    }), 'maskmem_feat').slice()
  }

  /** 跟踪一帧：记忆注意力 → 解码器（占位点、多掩码）。记忆与指针按 etamMemoryPlan 的顺序给。 */
  async track(features: EtamFeatures, memory: ReadonlyArray<{ memory: Float32Array; tpos: number }>, pointers: readonly Float32Array[]): Promise<EtamFrameResult> {
    const memoryData = new Float32Array(memory.length * 64 * 32 * 32)
    memory.forEach((entry, index) => memoryData.set(entry.memory, index * 64 * 32 * 32))
    const pointerData = new Float32Array(pointers.length * 256)
    pointers.forEach((entry, index) => pointerData.set(entry, index * 256))
    const pix = output(await this.parts.memoryAttention.run({
      vision_feat: f32(features.feat, [1, 256, 32, 32]),
      memory: f32(memoryData, [memory.length, 64, 32, 32]),
      memory_tpos_index: { type: 'int64', data: BigInt64Array.from(memory.map(entry => BigInt(entry.tpos))), dims: [memory.length] },
      obj_ptrs: f32(pointerData, [pointers.length, 256]),
      // EfficientTAM 不用指针时间编码，传全 0（SOURCE.md）。
      obj_ptr_tpos: f32(new Float32Array(pointers.length), [pointers.length]),
    }), 'pix_feat')
    const decoded = await this.decode(pix, { coords: [[0, 0]], labels: [-1] }, true)
    return { logits: decoded.logits, score: decoded.score, pointer: decoded.pointer }
  }
}

/** 解码器内部 4 个掩码（单掩码 + 3 个多掩码候选）的张量名：载入时补成图输出（不改模型文件），用来给用户挑候选。 */
export const ETAM_CANDIDATES_OUTPUT = '/Reshape_7_output_0'

export { FEATURE_SIZE as ETAM_FEATURE_SIZE }
