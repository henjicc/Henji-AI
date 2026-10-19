import { codeMaterialFilesKey, type CodeMaterialFiles } from '@/core/videoEdit/codeMaterial/sources'
import { compileCodeMaterial } from '@/core/videoEdit/codeMaterial/compiler'
import { CodeMaterialError } from '@/core/videoEdit/codeMaterial/contract'
import type { CodeMaterialProgram } from '@/core/videoEdit/codeMaterial/contract'
import type { CodeCompilerResponse } from './videoEditCodeCompiler'
import { bundleVideoEditAuthorModule } from './videoEditAuthorBundler'
import type { AuthorBundle } from './videoEditAuthorBundle'

const cache = new Map<string, { program: CodeMaterialProgram; bytes: number }>()
let bytes = 0
const bundles = new Map<string, { bundle: AuthorBundle; bytes: number }>()
let bundleBytes = 0
self.onmessage = async (event: MessageEvent<{ id: number; files: CodeMaterialFiles; kind?: 'author.bundle' }>): Promise<void> => {
  const { id, files } = event.data
  const source = codeMaterialFilesKey(files)
  try {
    if (event.data.kind === 'author.bundle') {
      const cached = bundles.get(source)
      if (cached) { bundles.delete(source); bundles.set(source, cached); self.postMessage({ id, bundle: cached.bundle, cacheHit: true } satisfies CodeCompilerResponse); return }
      const bundle = await bundleVideoEditAuthorModule(files)
      const size = new TextEncoder().encode(source + bundle.code + bundle.map).byteLength
      while (bundles.size >= 32 || bundleBytes + size > 64 * 1024 ** 2) {
        const oldest = bundles.entries().next().value
        if (!oldest) break
        bundles.delete(oldest[0]); bundleBytes -= oldest[1].bytes
      }
      // Concurrent requests can finish the same source while another build awaits.
      const replaced = bundles.get(source)
      if (replaced) { bundles.delete(source); bundleBytes -= replaced.bytes }
      if (size <= 64 * 1024 ** 2) { bundles.set(source, { bundle, bytes: size }); bundleBytes += size }
      self.postMessage({ id, bundle } satisfies CodeCompilerResponse)
      return
    }
    const cached = cache.get(source)
    if (cached) { cache.delete(source); cache.set(source, cached); self.postMessage({ id, program: cached.program, cacheHit: true } satisfies CodeCompilerResponse); return }
    const program = compileCodeMaterial(files)
    const size = new TextEncoder().encode(source).byteLength + new TextEncoder().encode(JSON.stringify(program)).byteLength
    while (cache.size >= 32 || bytes + size > 16 * 1024 ** 2) {
      const oldest = cache.entries().next().value as [string, { program: CodeMaterialProgram; bytes: number }] | undefined
      if (!oldest) break
      cache.delete(oldest[0]); bytes -= oldest[1].bytes
    }
    if (size <= 16 * 1024 ** 2) { cache.set(source, { program, bytes: size }); bytes += size }
    self.postMessage({ id, program, cacheHit: false } satisfies CodeCompilerResponse)
  } catch (error) {
    const failure = error instanceof CodeMaterialError ? error : new CodeMaterialError('SYNTAX', error instanceof Error ? error.message : String(error))
    self.postMessage({ id, error: { code: failure.code, message: failure.message, ...(failure.sourceSpan ? { sourceSpan: failure.sourceSpan } : {}) } } satisfies CodeCompilerResponse)
  }
}
