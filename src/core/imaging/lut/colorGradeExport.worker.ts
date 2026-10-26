import { buildColorGradeExport, ColorGradeExportRejection, type ColorGradeExportBuild, type ColorGradeExportFormat, type ColorGradeLutSize } from './colorGradeExport'
import type { CubeLut } from './cube'

export interface ColorGradeExportWorkerRequest { params: Record<string, unknown>; format: ColorGradeExportFormat; title: string; lutSize?: ColorGradeLutSize; luts: Array<[string, CubeLut]>; omitted?: string[] }
export type ColorGradeExportWorkerResponse = { build: ColorGradeExportBuild } | { error: string; rejected: boolean }

/** 65³ 格点逐点走正式 CPU 调色需要数秒，放在 Worker，界面与助手调用都不阻塞渲染线程。 */
const scope = globalThis as unknown as { onmessage: ((event: MessageEvent<ColorGradeExportWorkerRequest>) => void) | null; postMessage(message: ColorGradeExportWorkerResponse, transfer?: Transferable[]): void }
scope.onmessage = event => {
  const request = event.data
  try {
    const build = buildColorGradeExport({ params: request.params, format: request.format, title: request.title, lutSize: request.lutSize, luts: new Map(request.luts), omitted: request.omitted })
    scope.postMessage({ build }, [build.check.inputs.buffer, build.check.expected.buffer])
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : String(error), rejected: error instanceof ColorGradeExportRejection })
  }
}
