import { createLogger } from '@/core/logging'
import { CodeMaterialError } from '@/core/videoEdit/codeMaterial/contract'
import { expandPinnedCodeComponents } from '@/core/videoEdit/codeMaterial/components'
import { documentCodeSourceResolver, type CodeComponentPin, type CodeMaterialFiles } from '@/core/videoEdit/codeMaterial/sources'
import { codeTypeCheckAppendix, type CodeTypeCheckReport } from '@/core/videoEdit/codeMaterial/typeDiagnostics'
import { checkVideoEditAuthorTypes } from '../engine/videoEditSharedCompiler'

const logger = createLogger('features.videoEdit.codeTypes')
const unavailable = (error: unknown): CodeTypeCheckReport => ({ status: 'unavailable', reason: error instanceof Error ? error.message : String(error) })
/** 超时只作“没有结论”，不把仍在进行的检查当作失败抛出。 */
function within(check: Promise<CodeTypeCheckReport>, waitMs: number): Promise<CodeTypeCheckReport> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<CodeTypeCheckReport>(resolve => { timer = setTimeout(() => resolve({ status: 'unavailable', reason: `等待超过 ${Math.round(waitMs / 1000)} 秒` }), waitMs) })
  return Promise.race([check, timeout]).finally(() => clearTimeout(timer))
}

/**
 * 与打包、试渲染并行检查作者源码的类型，不进入渲染关键路径；返回的 Promise 不会拒绝。
 * 钉住的项目组件只参与解析与推断，只报告本次提交的文件。
 */
export function startVideoEditCodeTypeCheck(contents: CodeMaterialFiles, imports: readonly CodeComponentPin[], signal: AbortSignal): Promise<CodeTypeCheckReport> {
  let files: CodeMaterialFiles
  // 组件缺失由打包当场报错；这里只放弃本次类型结论。
  try { files = expandPinnedCodeComponents(contents, imports, documentCodeSourceResolver()) } catch (error) { return Promise.resolve(unavailable(error)) }
  return checkVideoEditAuthorTypes(files, Object.keys(contents.files), signal).then(result => {
    logger.info('作者源码类型检查完成', { event: 'video_edit.code.type_check.completed', context: { checkedFiles: result.checkedFiles.length, total: result.total, elapsedMs: Math.round(result.elapsedMs) } })
    return { status: 'checked' as const, ...result }
  }, (error: unknown) => {
    if (!signal.aborted) logger.warn('作者源码类型检查未完成', { event: 'video_edit.code.type_check.failed', error })
    return unavailable(error)
  })
}

/** 已经提交之后再收结果：等不到就如实记为没有结论，不能让已提交的修改变成失败。 */
export function settleVideoEditCodeTypeChecks(checks: ReadonlyArray<Promise<CodeTypeCheckReport>>, waitMs = 8000): Promise<CodeTypeCheckReport[]> {
  return Promise.all(checks.map(check => within(check, waitMs)))
}

/**
 * 加载、检查或试渲染失败时把类型错误附在错误信息末尾，错误类型、代码与源码位置不变。
 * 取消、语法与体积错误原样抛出：前者不是源码问题，后两者打包器已经给出准确位置。
 */
export async function withVideoEditCodeTypeContext<T>(run: () => Promise<T>, checks: ReadonlyArray<Promise<CodeTypeCheckReport>>, signal: AbortSignal, waitMs = 5000): Promise<T> {
  try { return await run() } catch (error) {
    if (!checks.length || signal.aborted || !(error instanceof Error) || error.name === 'AbortError' || error instanceof CodeMaterialError && (error.code === 'SYNTAX' || error.code === 'SOURCE_LIMIT')) throw error
    const appendix = codeTypeCheckAppendix(await Promise.all(checks.map(check => within(check, waitMs))))
    if (!appendix || signal.aborted) throw error
    throw error instanceof CodeMaterialError ? new CodeMaterialError(error.code, error.message + appendix, error.sourceSpan) : new Error(error.message + appendix, { cause: error })
  }
}
