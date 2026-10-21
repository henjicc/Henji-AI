import { applyMat3, deltaE2000, invertMat3, linearSrgbToLab, linearToSrgb, luminance, srgbToLinear, whiteBalanceMatrix, type Vec3 } from './colorScience'
import { buildColorGradeTable, gradeStageA, gradeStageB } from './unifiedGrade'
import { colorGradeDefaults } from './schema'

/**
 * Automatic-correction evaluation set: synthetic scenes with known ground truth receive a known light cast and exposure
 * error; an algorithm's suggested parameters are rendered with the production CPU grade and compared with the original.
 * Metrics: mean CIEDE2000 over the reference patches, exposure error in EV on the middle grey, and grey-axis ΔE (white balance).
 */
const CHECKER_8BIT: readonly Vec3[] = [
  [115, 82, 68], [194, 150, 130], [98, 122, 157], [87, 108, 67], [133, 128, 177], [103, 189, 170],
  [214, 126, 44], [80, 91, 166], [193, 90, 99], [94, 60, 108], [157, 188, 64], [224, 163, 46],
  [56, 61, 150], [70, 148, 73], [175, 54, 60], [231, 199, 31], [187, 86, 149], [8, 133, 161],
  [243, 243, 242], [200, 200, 200], [160, 160, 160], [122, 122, 121], [85, 85, 85], [52, 52, 52],
]
/** ColorChecker classic in linear sRGB (D65); index 21 is the ~18% middle grey, 18–23 the neutral row. */
export const CHECKER_LINEAR: readonly Vec3[] = CHECKER_8BIT.map(rgb => rgb.map(x => srgbToLinear(x / 255)) as Vec3)
export const NEUTRAL_PATCHES = [18, 19, 20, 21, 22, 23] as const

export interface EvaluationScene { name: string; width: number; height: number; linear: Float32Array; patches: Array<{ index: number; x: number; y: number }> }
export interface EvaluationCast { kelvin: number; tint: number; ev: number }
export interface EvaluationCase { scene: EvaluationScene; cast: EvaluationCast }
export interface EvaluationResult { scene: string; cast: EvaluationCast; deltaE: number; evError: number; greyDeltaE: number; failed?: string }
export type AutoGradeAlgorithm = (pixels: Float32Array) => Record<string, unknown>

/** Scenes mix the chart with a dominant backdrop, so gray-world style estimators meet realistic bias. */
export function createEvaluationScenes(): EvaluationScene[] {
  const scene = (name: string, backdrop: (x: number, y: number) => Vec3, scale = 1): EvaluationScene => {
    const width = 96; const height = 64; const linear = new Float32Array(width * height * 4); const patches: EvaluationScene['patches'] = []
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) linear.set([...backdrop(x / (width - 1), y / (height - 1)).map(v => v * scale), 1], (y * width + x) * 4)
    // Chart occupies a 6×4 block of 6-px patches in the lower right third.
    for (let index = 0; index < 24; index++) {
      const px = 54 + (index % 6) * 7; const py = 34 + Math.floor(index / 6) * 7
      for (let y = py; y < py + 6; y++) for (let x = px; x < px + 6; x++) linear.set([...CHECKER_LINEAR[index].map(v => v * scale), 1], (y * width + x) * 4)
      patches.push({ index, x: px + 3, y: py + 3 })
    }
    return { name, width, height, linear, patches }
  }
  return [
    scene('中性室内', (x, y) => { const v = .08 + .25 * x * (1 - .5 * y); return [v, v * .98, v * .95] }),
    scene('天空草地', (_x, y) => y < .5 ? [.18 + .1 * y, .32 + .1 * y, .62] : [.06, .14 + .05 * y, .04]),
    scene('人像暖肤', (x, y) => { const d = Math.hypot(x - .3, y - .45); return d < .3 ? [.52, .33, .24] : [.12, .1, .09] }),
    scene('夜景低调', (x, y) => { const v = .004 + .02 * x * y; return [v, v, v * 1.3] }, .35),
    scene('雪景高调', (x) => { const v = .7 + .15 * x; return [v, v, v * 1.02] }),
  ]
}
export const EVALUATION_CASTS: readonly EvaluationCast[] = [
  { kelvin: 3200, tint: 0, ev: 0 }, { kelvin: 9000, tint: 0, ev: 0 }, { kelvin: 6500, tint: 25, ev: 0 },
  { kelvin: 6500, tint: 0, ev: -1.5 }, { kelvin: 6500, tint: 0, ev: 1 }, { kelvin: 4300, tint: -15, ev: -.7 },
]

/** Lit by `kelvin`/`tint` instead of the reference white (inverse of the white balance correction), exposure off by `ev`, clipped like a camera file. */
export function applyEvaluationCast(scene: EvaluationScene, cast: EvaluationCast): Float32Array {
  const lit = invertMat3(whiteBalanceMatrix(cast.kelvin, cast.tint)); const gain = 2 ** cast.ev
  const out = new Float32Array(scene.linear.length)
  for (let i = 0; i < out.length; i += 4) {
    const rgb = applyMat3(lit, Array.from(scene.linear.subarray(i, i + 3)))
    out.set([...rgb.map(x => Math.min(1, Math.max(0, linearToSrgb(x * gain)))), 1], i)
  }
  return out
}

function patch(image: Float32Array, scene: EvaluationScene, at: { x: number; y: number }): Vec3 {
  const i = (at.y * scene.width + at.x) * 4; return [image[i], image[i + 1], image[i + 2]]
}
export function evaluateAutoGrade(algorithm: AutoGradeAlgorithm, cases: readonly EvaluationCase[]): EvaluationResult[] {
  return cases.map(({ scene, cast }) => {
    const encoded = applyEvaluationCast(scene, cast)
    let params: Record<string, unknown>
    try { params = algorithm(encoded) } catch (error) { return { scene: scene.name, cast, deltaE: NaN, evError: NaN, greyDeltaE: NaN, failed: error instanceof Error ? error.message : String(error) } }
    const table = buildColorGradeTable({ ...colorGradeDefaults(), ...params }).data
    const graded = (rgb: Vec3): Vec3 => gradeStageB(gradeStageA(rgb, table), table).map(x => srgbToLinear(Math.min(1, Math.max(0, x)))) as Vec3
    const errors = scene.patches.map(({ index, x, y }) => ({ index, value: deltaE2000(linearSrgbToLab(graded(patch(encoded, scene, { x, y }))), linearSrgbToLab(patch(scene.linear, scene, { x, y }))) }))
    const grey = scene.patches[21]
    const evError = Math.log2(Math.max(1e-6, luminance(graded(patch(encoded, scene, grey)))) / Math.max(1e-6, luminance(patch(scene.linear, scene, grey))))
    return {
      scene: scene.name, cast,
      deltaE: errors.reduce((sum, item) => sum + item.value, 0) / errors.length,
      evError,
      greyDeltaE: errors.filter(item => (NEUTRAL_PATCHES as readonly number[]).includes(item.index)).reduce((sum, item) => sum + item.value, 0) / NEUTRAL_PATCHES.length,
    }
  })
}
export function evaluationCases(): EvaluationCase[] { return createEvaluationScenes().flatMap(scene => EVALUATION_CASTS.map(cast => ({ scene, cast }))) }
export function summarizeEvaluation(results: readonly EvaluationResult[]): { meanDeltaE: number; meanAbsEv: number; meanGreyDeltaE: number; failures: number } {
  const ok = results.filter(result => !result.failed)
  const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length)
  return { meanDeltaE: mean(ok.map(r => r.deltaE)), meanAbsEv: mean(ok.map(r => Math.abs(r.evError))), meanGreyDeltaE: mean(ok.map(r => r.greyDeltaE)), failures: results.length - ok.length }
}
