import type { CodeMaterialFiles } from '@/core/videoEdit/codeMaterial/sources'
import type { AuthorBundle } from './videoEditAuthorBundle'
import { VideoEditCodeCompiler } from './videoEditCodeCompiler'

// The UI and render-session transport share compilation without importing
// document state or recursively entering GPU metadata inspection.
let compiler: VideoEditCodeCompiler | undefined
export function prepareVideoEditAuthorBundle(files: CodeMaterialFiles, signal?: AbortSignal): Promise<AuthorBundle> {
  compiler ??= new VideoEditCodeCompiler()
  return compiler.bundleQueued(files, signal)
}
export function releaseSharedVideoEditCompiler(): void {
  compiler?.dispose()
  compiler = undefined
}
