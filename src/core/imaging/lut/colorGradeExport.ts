import { COLOR_GRADE_HSL_CORRECTION_KEYS, COLOR_GRADE_HUE_CURVES, COLOR_GRADE_MIXER_PARAMS } from '../adjustments/colorGrade'
import { planColorGrade } from '../adjustments/plan'
import { deltaE2000, linearSrgbToLab, linearSrgbToOklab, REC709_LUMA, srgbToLinear, type Vec3 } from '../adjustments/colorScience'
import { executeColorGradeCpuPlan, sampleCubeLut } from '../effects/cpu/colorGrade'
import { parseCubeLut, type CubeLut } from './cube'

/**
 * 全能调色导出为 3D LUT（Adobe .cube）与 ASC CDL（.cdl）。
 *
 * 工作域与渲染管线一致：调色的输入与输出都是 sRGB 原色（与 Rec.709 相同）、sRGB 编码值（剪辑与图片两端在调色前
 * 都把画面换算到这一域，见 imageEdit/v3/effects/colorGrade.ts 与 plan.ts）。所以 LUT 的输入是“调色前的编码值”，
 * 输出是“调色后的编码值”，0–1 定义域，超出部分按 0–1 裁切。真值是 CPU 调色执行器（与 WGSL 对照过的同一份实现），
 * 逐格点求值，不做任何近似拟合；CDL 只有每通道斜率/偏移/幂与整体饱和度，由同一真值最小二乘拟合得到。
 */
export const COLOR_GRADE_LUT_SIZES = [17, 33, 65] as const
export type ColorGradeLutSize = typeof COLOR_GRADE_LUT_SIZES[number]
/** 33 是 Resolve、Premiere、OBS 等通用的默认格点，文件约 1 MB；65 精度更高（约 7 MB），部分软件与相机不接受。 */
export const DEFAULT_COLOR_GRADE_LUT_SIZE: ColorGradeLutSize = 33
export type ColorGradeExportFormat = 'cube' | 'cdl'
/** CDL 拟合后平均色差超过此值就不提供 CDL（ΔE2000，2–3 为一眼可见的差异）。 */
export const CDL_MAX_MEAN_DELTA_E = 3

export interface AscCdl { slope: Vec3; offset: Vec3; power: Vec3; saturation: number }
export interface ColorGradeExportScope {
  /** 去掉空间类操作后的逐像素参数。 */
  params: Record<string, unknown>
  /** 无法写进逐色映射、已从导出中去掉的部分（锐化、晕影等依赖相邻像素或画面位置的操作）。 */
  omitted: string[]
  /** 按逐色近似写入的部分。 */
  approximated: string[]
}
export interface ColorGradeExportCheck { inputs: Float32Array; expected: Float32Array }
export interface ColorGradeExportBuild {
  format: ColorGradeExportFormat
  text: string
  lutSize?: ColorGradeLutSize
  omitted: string[]
  approximated: string[]
  /** CDL 无法表达、只能整体近似的调色部分。 */
  inexpressible: string[]
  cdl?: AscCdl
  /** 写出后读回核对用：一组测试色与它们经正式调色得到的结果。 */
  check: ColorGradeExportCheck
}
export interface ColorGradeExportAccuracy { meanDeltaE: number; maxDeltaE: number; samples: number }

/** 写文件之前的拒绝（参数、格式、CDL 表达不了、目标已存在）；调用方修正后可直接重试。 */
export class ColorGradeExportRejection extends Error { override name = 'ColorGradeExportRejection' }

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x))
const number = (params: Readonly<Record<string, unknown>>, key: string): number => { const value = params[key]; return typeof value === 'number' && Number.isFinite(value) ? value : 0 }
const curveSet = (value: unknown): boolean => Array.isArray(value) ? value.length > 0 : typeof value === 'string' && value.length > 0

/** 逐像素部分保留，空间类部分去掉；查看选区蒙版是观察开关，不属于调色结果。 */
export function colorGradeExportScope(params: Readonly<Record<string, unknown>>): ColorGradeExportScope {
  const next: Record<string, unknown> = { ...params, hsl_show_mask: false }
  const omitted: string[] = []; const approximated: string[] = []
  if (number(params, 'sharpen')) { omitted.push('锐化'); next.sharpen = 0 }
  if (number(params, 'hsl_sharpen')) { omitted.push('HSL 选区锐化'); next.hsl_sharpen = 0 }
  if (number(params, 'vignette_amount')) { omitted.push('晕影'); next.vignette_amount = 0 }
  const hslActive = COLOR_GRADE_HSL_CORRECTION_KEYS.some(key => number(next, key) !== 0)
  if (hslActive && (number(params, 'hsl_denoise') || number(params, 'hsl_blur'))) approximated.push('HSL 辅助的键控去噪与模糊（按未平滑的选区逐色计算，选区边缘会比画面里硬）')
  next.hsl_denoise = 0; next.hsl_blur = 0
  return { params: next, omitted, approximated }
}

/** 只能按颜色选择性处理、CDL 的每通道公式无法表达的部分。 */
export function colorGradeCdlInexpressible(params: Readonly<Record<string, unknown>>): string[] {
  const parts: string[] = []
  if (COLOR_GRADE_MIXER_PARAMS.some(param => number(params, param.key) !== 0)) parts.push('混色器')
  if (COLOR_GRADE_HUE_CURVES.some(curve => curveSet(params[`curve_${curve}_points`]))) parts.push('色相曲线')
  if (COLOR_GRADE_HSL_CORRECTION_KEYS.some(key => number(params, key) !== 0)) parts.push('HSL 辅助')
  if (params.input_lut && number(params, 'input_lut_strength')) parts.push('输入 LUT')
  if (params.look_lut && number(params, 'look_lut_strength')) parts.push('创意 Look')
  if (params.wheel_mode !== 'primary' && ['shadow', 'midtone', 'highlight'].some(region => number(params, `${region}_strength`) || number(params, `${region}_luminance`))) parts.push('分级色轮的明暗分区')
  return parts
}

/** 用正式 CPU 调色执行器求一批编码值颜色（rgb 三元组）的结果，输出裁切到 0–1。 */
export function gradeEncodedColors(params: Readonly<Record<string, unknown>>, colors: Float32Array, luts: ReadonlyMap<string, CubeLut> = new Map()): Float32Array {
  const count = colors.length / 3
  const width = Math.max(1, Math.min(count, 4096)); const height = Math.max(1, Math.ceil(count / width))
  const data = new Float32Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    if (i < count) data.set([colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2]], i * 4)
    data[i * 4 + 3] = 1
  }
  const output = executeColorGradeCpuPlan(planColorGrade(params, width, height), { width, height, data }, luts).data
  const result = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) for (let c = 0; c < 3; c++) result[i * 3 + c] = clamp01(output[i * 4 + c])
  return result
}

/** Adobe .cube 顺序：红变化最快，其次绿、蓝。 */
export function colorGradeLattice(size: number): Float32Array {
  const colors = new Float32Array(size ** 3 * 3)
  for (let b = 0, i = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++, i++) colors.set([r / (size - 1), g / (size - 1), b / (size - 1)], i * 3)
  return colors
}
/**
 * 核对用测试色：512 个低差异准随机色（Roberts R3 序列），均匀铺满 RGB 立方体且不落在任何格点上，
 * 这样量到的是插值误差本身（规则网格的格心在 17/33/65 格点上恰好是格点，会量出 0）。
 */
export function colorGradeCheckColors(count = 512): Float32Array {
  const phi = 1.2207440846057596; const step = [1 / phi, 1 / phi ** 2, 1 / phi ** 3]
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) for (let c = 0; c < 3; c++) { const x = .5 + step[c] * (i + 1); colors[i * 3 + c] = x - Math.floor(x) }
  return colors
}

const sanitizeTitle = (title: string): string => title.replace(/["\r\n#]/g, ' ').trim().slice(0, 120) || '痕迹AI 全能调色'
const fixed = (x: number): string => (Math.abs(x) < 5e-7 ? 0 : x).toFixed(6)

export function formatColorGradeCube(title: string, size: number, rgb: Float32Array, notes: readonly string[] = []): string {
  const lines = [
    '# 痕迹AI 全能调色导出',
    '# 色彩空间：输入与输出均为 sRGB 原色（同 Rec.709）的 sRGB 编码值，定义域 0–1，超出按 0–1 裁切',
    ...notes.map(note => `# ${note.replace(/[\r\n]/g, ' ')}`),
    `TITLE "${sanitizeTitle(title)}"`, `LUT_3D_SIZE ${size}`, 'DOMAIN_MIN 0.0 0.0 0.0', 'DOMAIN_MAX 1.0 1.0 1.0',
  ]
  for (let i = 0; i < rgb.length; i += 3) lines.push(`${fixed(rgb[i])} ${fixed(rgb[i + 1])} ${fixed(rgb[i + 2])}`)
  return `${lines.join('\n')}\n`
}

/** ASC CDL v1.2：SOP 后裁切到 0–1 再取幂，饱和度用 Rec.709 亮度权重，最后再裁切。 */
export function applyAscCdl(rgb: readonly number[], cdl: AscCdl): Vec3 {
  const sop = [0, 1, 2].map(c => clamp01(rgb[c] * cdl.slope[c] + cdl.offset[c]) ** cdl.power[c])
  const luma = sop[0] * REC709_LUMA[0] + sop[1] * REC709_LUMA[1] + sop[2] * REC709_LUMA[2]
  return sop.map(x => clamp01(luma + cdl.saturation * (x - luma))) as Vec3
}

const vec = (p: readonly number[], offset: number): Vec3 => [p[offset], p[offset + 1], p[offset + 2]]
const toCdl = (p: readonly number[]): AscCdl => ({ slope: vec(p, 0), offset: vec(p, 3), power: vec(p, 6), saturation: p[9] })
const constrain = (p: number[]): number[] => p.map((x, i) => i < 3 ? Math.max(0, Math.min(8, x)) : i < 6 ? Math.max(-1, Math.min(1, x)) : i < 9 ? Math.max(.1, Math.min(10, x)) : Math.max(0, Math.min(4, x)))
function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length; const m = a.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    let pivot = col; for (let row = col + 1; row < n; row++) if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row
    if (Math.abs(m[pivot][col]) < 1e-14) return null
    ;[m[col], m[pivot]] = [m[pivot], m[col]]
    for (let row = 0; row < n; row++) if (row !== col) { const f = m[row][col] / m[col][col]; for (let k = col; k <= n; k++) m[row][k] -= f * m[col][k] }
  }
  return m.map((row, i) => row[n] / row[i])
}

/** Levenberg–Marquardt 拟合 10 个 CDL 参数，残差取 OkLab（感知均匀），数值雅可比。 */
export function fitAscCdl(inputs: Float32Array, targets: Float32Array): AscCdl {
  const count = inputs.length / 3
  const target = Array.from({ length: count }, (_, i) => linearSrgbToOklab([0, 1, 2].map(c => srgbToLinear(targets[i * 3 + c]))))
  const residuals = (p: number[]): number[] => {
    const cdl = toCdl(p); const out: number[] = []
    for (let i = 0; i < count; i++) {
      const lab = linearSrgbToOklab(applyAscCdl([inputs[i * 3], inputs[i * 3 + 1], inputs[i * 3 + 2]], cdl).map(srgbToLinear))
      out.push(lab[0] - target[i][0], lab[1] - target[i][1], lab[2] - target[i][2])
    }
    return out
  }
  const cost = (r: number[]): number => r.reduce((sum, x) => sum + x * x, 0)
  let p = [1, 1, 1, 0, 0, 0, 1, 1, 1, 1]; let r = residuals(p); let current = cost(r); let lambda = 1e-3
  for (let iteration = 0; iteration < 80 && current > 1e-12; iteration++) {
    const jacobian = p.map((_, j) => { const h = 1e-4; const q = [...p]; q[j] += h; return residuals(constrain(q)).map((x, k) => (x - r[k]) / h) })
    const a = p.map((_, i) => p.map((__, j) => jacobian[i].reduce((sum, x, k) => sum + x * jacobian[j][k], 0)))
    const g = p.map((_, i) => jacobian[i].reduce((sum, x, k) => sum + x * r[k], 0))
    let improved = false
    while (lambda < 1e10) {
      const step = solve(a.map((row, i) => row.map((x, j) => i === j ? x + lambda * Math.max(x, 1e-9) : x)), g.map(x => -x))
      if (step) {
        const next = constrain(p.map((x, i) => x + step[i])); const nextR = residuals(next); const nextCost = cost(nextR)
        if (nextCost < current) { const gain = current - nextCost; p = next; r = nextR; current = nextCost; lambda = Math.max(1e-9, lambda / 3); improved = gain > current * 1e-7; break }
      }
      lambda *= 4
    }
    if (!improved) break
  }
  const round = (x: number): number => Math.round(x * 1e6) / 1e6
  const cdl = toCdl(p)
  return { slope: cdl.slope.map(round) as Vec3, offset: cdl.offset.map(round) as Vec3, power: cdl.power.map(round) as Vec3, saturation: round(cdl.saturation) }
}

const escapeXml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
export function formatAscCdl(id: string, cdl: AscCdl, descriptions: readonly string[] = []): string {
  const triple = (v: Vec3): string => v.map(fixed).join(' ')
  const safeId = id.replace(/[^\w.-]+/g, '_').replace(/^([^A-Za-z_])/, '_$1').slice(0, 64) || 'henji_grade'
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<ColorDecisionList xmlns="urn:ASC:CDL:v1.01">',
    '  <ColorDecision>',
    `    <ColorCorrection id="${escapeXml(safeId)}">`,
    ...descriptions.map(text => `      <Description>${escapeXml(text)}</Description>`),
    '      <SOPNode>',
    `        <Slope>${triple(cdl.slope)}</Slope>`,
    `        <Offset>${triple(cdl.offset)}</Offset>`,
    `        <Power>${triple(cdl.power)}</Power>`,
    '      </SOPNode>',
    '      <SatNode>',
    `        <Saturation>${fixed(cdl.saturation)}</Saturation>`,
    '      </SatNode>',
    '    </ColorCorrection>',
    '  </ColorDecision>',
    '</ColorDecisionList>',
    '',
  ].join('\n')
}
/** 读取 .cdl / .cc 中第一个 ColorCorrection 的 SOP 与饱和度（用于写出后读回核对）。 */
export function parseAscCdl(text: string): AscCdl {
  const read = (tag: string, count: number): number[] => {
    const match = text.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))
    const values = match ? match[1].trim().split(/\s+/).map(Number) : []
    if (values.length !== count || values.some(value => !Number.isFinite(value))) throw new Error(`CDL 缺少有效的 ${tag}`)
    return values
  }
  return { slope: read('Slope', 3) as Vec3, offset: read('Offset', 3) as Vec3, power: read('Power', 3) as Vec3, saturation: read('Saturation', 1)[0] }
}

/** 生成导出文本；CDL 拟合误差过大时抛 `ColorGradeExportRejection`（写文件之前）。 */
export function buildColorGradeExport(input: { params: Readonly<Record<string, unknown>>; format: ColorGradeExportFormat; title: string; lutSize?: ColorGradeLutSize; luts?: ReadonlyMap<string, CubeLut>; omitted?: readonly string[] }): ColorGradeExportBuild {
  const scope = colorGradeExportScope(input.params)
  const omitted = [...scope.omitted, ...input.omitted ?? []]
  const checkInputs = colorGradeCheckColors()
  const check = { inputs: checkInputs, expected: gradeEncodedColors(scope.params, checkInputs, input.luts) }
  const notes = [...omitted.length ? [`未包含：${omitted.join('、')}`] : [], ...scope.approximated.map(text => `近似：${text}`)]
  if (input.format === 'cube') {
    const size = input.lutSize ?? DEFAULT_COLOR_GRADE_LUT_SIZE
    if (!COLOR_GRADE_LUT_SIZES.includes(size)) throw new ColorGradeExportRejection(`LUT 格点只能是 ${COLOR_GRADE_LUT_SIZES.join(' / ')}。`)
    const rgb = gradeEncodedColors(scope.params, colorGradeLattice(size), input.luts)
    return { format: 'cube', text: formatColorGradeCube(input.title, size, rgb, notes), lutSize: size, omitted, approximated: scope.approximated, inexpressible: [], check }
  }
  const inexpressible = colorGradeCdlInexpressible(scope.params)
  const fitInputs = colorGradeLattice(9)
  const cdl = fitAscCdl(fitInputs, gradeEncodedColors(scope.params, fitInputs, input.luts))
  const accuracy = measureColors(check, rgb => applyAscCdl(rgb, cdl))
  if (accuracy.meanDeltaE > CDL_MAX_MEAN_DELTA_E) throw new ColorGradeExportRejection(`这组调色无法用 CDL 表达：CDL 只有每通道斜率、偏移、幂和整体饱和度，拟合后平均色差 ${accuracy.meanDeltaE.toFixed(1)}（上限 ${CDL_MAX_MEAN_DELTA_E}）${inexpressible.length ? `，主要来自${inexpressible.join('、')}` : ''}。请改为导出 .cube。`)
  const descriptions = ['痕迹AI 全能调色导出；作用于 sRGB 原色（同 Rec.709）的 sRGB 编码值',
    `近似拟合：平均色差 ΔE2000 ${accuracy.meanDeltaE.toFixed(2)}，最大 ${accuracy.maxDeltaE.toFixed(2)}`,
    ...inexpressible.length ? [`CDL 无法表达，已整体近似：${inexpressible.join('、')}`] : [], ...notes]
  return { format: 'cdl', text: formatAscCdl(input.title, cdl, descriptions), omitted, approximated: scope.approximated, inexpressible, cdl, check }
}

function measureColors(check: ColorGradeExportCheck, map: (rgb: Vec3) => readonly number[]): ColorGradeExportAccuracy {
  const count = check.inputs.length / 3; let sum = 0; let max = 0
  const lab = (rgb: readonly number[]): Vec3 => linearSrgbToLab(rgb.map(x => srgbToLinear(clamp01(x))))
  for (let i = 0; i < count; i++) {
    const actual = map([check.inputs[i * 3], check.inputs[i * 3 + 1], check.inputs[i * 3 + 2]])
    const delta = deltaE2000(lab(actual), lab([check.expected[i * 3], check.expected[i * 3 + 1], check.expected[i * 3 + 2]]))
    sum += delta; max = Math.max(max, delta)
  }
  return { meanDeltaE: Math.round(sum / count * 1000) / 1000, maxDeltaE: Math.round(max * 1000) / 1000, samples: count }
}
/** 用正式解析器读回导出文本，与正式调色比较测试色（ΔE2000）。 */
export function measureColorGradeExport(format: ColorGradeExportFormat, text: string, check: ColorGradeExportCheck): ColorGradeExportAccuracy {
  if (format === 'cube') {
    const lut = parseCubeLut(text)
    if (lut.kind !== '3d') throw new Error('导出的 LUT 不是 3D LUT')
    return measureColors(check, rgb => sampleCubeLut(lut, rgb))
  }
  const cdl = parseAscCdl(text)
  return measureColors(check, rgb => applyAscCdl(rgb, cdl))
}
