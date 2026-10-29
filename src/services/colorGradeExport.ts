import { getPlatform } from '@/platform/runtime'
import { createLogger } from '@/core/logging'
import { CDL_MAX_MEAN_DELTA_E, ColorGradeExportRejection, measureColorGradeExport, type AscCdl, type ColorGradeExportAccuracy, type ColorGradeExportBuild, type ColorGradeExportFormat, type ColorGradeLutSize } from '@/core/imaging/lut/colorGradeExport'
import type { CubeLut } from '@/core/imaging/lut/cube'
import type { ColorGradeExportWorkerRequest, ColorGradeExportWorkerResponse } from '@/core/imaging/lut/colorGradeExport.worker'
import { exists, readTextFile, saveDialog, writeTextFile } from '@/platform/desktopApi'

/**
 * 全能调色导出为 .cube / .cdl 的唯一入口：剪辑片段的调色效果与图片调整层共用，界面菜单与助手能力都调用这里。
 * 求值在 Worker；写出后用正式解析器读回，对 512 个测试色与正式调色比较，结果作为成功证据。
 */
const logger = createLogger('services.color_grade_export')

export interface ColorGradeExportRequest {
  params: Record<string, unknown>
  format: ColorGradeExportFormat
  path: string
  title: string
  lutSize?: ColorGradeLutSize
  luts?: ReadonlyMap<string, CubeLut>
  /** 宿主层面不在调色参数里、也不会写进文件的部分（效果强度、蒙版、图层不透明度等）。 */
  omitted?: string[]
  overwrite?: boolean
  signal?: AbortSignal
}
export interface ColorGradeExportFileResult {
  path: string
  format: ColorGradeExportFormat
  lutSize?: ColorGradeLutSize
  bytes: number
  omitted: string[]
  approximated: string[]
  inexpressible: string[]
  cdl?: AscCdl
  accuracy: ColorGradeExportAccuracy
}

export const COLOR_GRADE_EXPORT_EXTENSIONS: Record<ColorGradeExportFormat, string> = { cube: 'cube', cdl: 'cdl' }

function buildOffThread(request: ColorGradeExportWorkerRequest, signal?: AbortSignal): Promise<ColorGradeExportBuild> {
  signal?.throwIfAborted()
  const worker = new Worker(new URL('../core/imaging/lut/colorGradeExport.worker.ts', import.meta.url), { type: 'module' })
  return new Promise((resolve, reject) => {
    const finish = (): void => { worker.terminate(); signal?.removeEventListener('abort', abort) }
    const abort = (): void => { finish(); reject(signal?.reason ?? new Error('导出已取消。')) }
    worker.onmessage = (event: MessageEvent<ColorGradeExportWorkerResponse>) => {
      finish()
      if ('build' in event.data) resolve(event.data.build)
      else reject(event.data.rejected ? new ColorGradeExportRejection(event.data.error) : new Error(event.data.error))
    }
    worker.onerror = event => { finish(); reject(new Error(event.message || '调色导出计算失败。')) }
    signal?.addEventListener('abort', abort, { once: true })
    try { worker.postMessage(request) } catch (error) { finish(); reject(error) }
  })
}

/**
 * 写入前的失败（扩展名不对、CDL 表达不了、计算失败）一律抛 `ColorGradeExportRejection`，调用方可直接修正重试；
 * 写入之后的失败保持原错误。
 */
export async function exportColorGradeFile(request: ColorGradeExportRequest): Promise<ColorGradeExportFileResult> {
  const extension = COLOR_GRADE_EXPORT_EXTENSIONS[request.format]
  const context = { format: request.format, lutSize: request.lutSize, path: request.path }
  logger.info('调色导出开始', { event: 'color_grade.export.start', context })
  let written = false
  try {
    if (!request.path.toLowerCase().endsWith(`.${extension}`)) throw new ColorGradeExportRejection(`文件扩展名需要是 .${extension}。`)
    let build: ColorGradeExportBuild
    try {
      build = await buildOffThread({ params: request.params, format: request.format, title: request.title, lutSize: request.lutSize, luts: [...request.luts ?? []], omitted: request.omitted }, request.signal)
    } catch (error) {
      if (error instanceof ColorGradeExportRejection) throw error
      throw new ColorGradeExportRejection(`调色导出计算失败：${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
    request.signal?.throwIfAborted()
    if (await exists(request.path)) await getPlatform().settings.preserveFile(request.path)
    written = true
    await writeTextFile(request.path, build.text)
    const accuracy = measureColorGradeExport(request.format, await readTextFile(request.path), build.check)
    const result: ColorGradeExportFileResult = { path: request.path, format: request.format, ...(build.lutSize ? { lutSize: build.lutSize } : {}), bytes: new TextEncoder().encode(build.text).byteLength,
      omitted: build.omitted, approximated: build.approximated, inexpressible: build.inexpressible, ...(build.cdl ? { cdl: build.cdl } : {}), accuracy }
    logger.info('调色导出完成', { event: 'color_grade.export.completed', context: { ...context, bytes: result.bytes, meanDeltaE: accuracy.meanDeltaE, maxDeltaE: accuracy.maxDeltaE } })
    return result
  } catch (error) {
    logger.warn('调色导出失败', { event: 'color_grade.export.failed', error, context: { ...context, written } })
    throw error
  }
}

/** 给人看的一句话结果（界面通知与助手回执共用）。 */
export function describeColorGradeExport(result: ColorGradeExportFileResult): string {
  const name = result.path.split(/[\\/]/).at(-1) ?? result.path
  const head = result.format === 'cube'
    ? `已导出 ${result.lutSize}³ LUT“${name}”，读回核对平均色差 ${result.accuracy.meanDeltaE.toFixed(2)}`
    : `已导出 CDL“${name}”（近似），平均色差 ${result.accuracy.meanDeltaE.toFixed(2)}`
  const notes = [
    ...result.omitted.length ? [`未包含${result.omitted.join('、')}`] : [],
    ...result.inexpressible.length ? [`${result.inexpressible.join('、')}只能整体近似`] : [],
    ...result.approximated.length ? ['HSL 选区边缘按未平滑计算'] : [],
  ]
  return `${head}${notes.length ? `；${notes.join('；')}` : ''}。`
}

/** 界面导出入口的保存对话框；覆盖前的文件由通用回收机制保留。 */
export async function chooseColorGradeExportPath(format: ColorGradeExportFormat, baseName: string): Promise<string | null> {
  const extension = COLOR_GRADE_EXPORT_EXTENSIONS[format]
  const name = baseName.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || '调色'
  return saveDialog({ defaultPath: `${name}.${extension}`, filters: [{ name: format === 'cube' ? '3D LUT（.cube）' : 'ASC CDL（.cdl）', extensions: [extension] }] })
}

/**
 * 助手回执：文件字段 + 一句话 + 结构化核对。读回成功且色差在格式自身的上限内才算验证通过
 * （cube 平均 ≤1：逐格点精确求值，只剩插值误差；cdl ≤ 拒绝阈值）。
 */
export function colorGradeExportReceipt(result: ColorGradeExportFileResult): ColorGradeExportFileResult & { message: string; verification: { verified: boolean; condition: string } } {
  const file: ColorGradeExportFileResult = { path: result.path, format: result.format, ...(result.lutSize ? { lutSize: result.lutSize } : {}), bytes: result.bytes, omitted: result.omitted, approximated: result.approximated, inexpressible: result.inexpressible, ...(result.cdl ? { cdl: result.cdl } : {}), accuracy: result.accuracy }
  const limit = result.format === 'cube' ? 1 : CDL_MAX_MEAN_DELTA_E
  return { ...file, message: describeColorGradeExport(result), verification: { verified: result.accuracy.meanDeltaE <= limit,
    condition: `已读回 ${result.path}，${result.accuracy.samples} 个测试色与正式调色的平均色差 ${result.accuracy.meanDeltaE}、最大 ${result.accuracy.maxDeltaE}（上限 ${limit}）。` } }
}
