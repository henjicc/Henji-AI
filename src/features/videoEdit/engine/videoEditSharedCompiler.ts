import type { CodeMaterialFiles } from '@/core/videoEdit/codeMaterial/sources'
import type { CodeTypeCheckResult } from '@/core/videoEdit/codeMaterial/typeDiagnostics'
import type { AuthorBundle } from './videoEditAuthorBundle'
import { VideoEditCodeCompiler } from './videoEditCodeCompiler'
import { VideoEditAuthorTypeChecker } from './videoEditAuthorTypeChecker'
import { ensureCodeContentTrust } from '@/services/contentTrust'
import { createLogger } from '@/core/logging'
const logger = createLogger('features.videoEdit.authorCompiler')

// The UI and render-session transport share compilation without importing
// document state or recursively entering GPU metadata inspection.
let compiler: VideoEditCodeCompiler | undefined
let typeChecker: VideoEditAuthorTypeChecker | undefined
export async function prepareVideoEditAuthorBundle(files: CodeMaterialFiles, signal?: AbortSignal): Promise<AuthorBundle> {
  const trustContext = await ensureCodeContentTrust(files, signal)
  compiler ??= new VideoEditCodeCompiler()
  const bundle = await compiler.bundleQueued(files, signal)
  for (const resource of bundle.textFonts ?? []) for (const diagnostic of resource.diagnostics) logger.warn(diagnostic.message, { event: 'video_edit.code.font_diagnostic', context: { file: resource.file, start: diagnostic.start, end: diagnostic.end } })
  return { ...bundle, trustContext }
}
/** 作者源码类型检查：与打包分开排队，结果只作诊断，不参与加载与渲染。 */
export function checkVideoEditAuthorTypes(files: CodeMaterialFiles, report: readonly string[], signal?: AbortSignal): Promise<CodeTypeCheckResult> {
  typeChecker ??= new VideoEditAuthorTypeChecker()
  return typeChecker.check(files, report, signal)
}
export function releaseSharedVideoEditCompiler(): void {
  compiler?.dispose()
  compiler = undefined
  typeChecker?.dispose()
  typeChecker = undefined
}
