import { compileCodeMaterial } from '@/core/videoEdit/codeMaterial/compiler'
import { CodeMaterialError } from '@/core/videoEdit/codeMaterial/contract'
import type { CodeMaterialProgram } from '@/core/videoEdit/codeMaterial/contract'
import type { CodeCompilerResponse } from './videoEditCodeCompiler'

const cache = new Map<string, { program: CodeMaterialProgram; bytes: number }>()
let bytes = 0
self.onmessage = (event: MessageEvent<{ id: number; source: string }>): void => {
  const { id, source } = event.data
  try {
    const cached = cache.get(source)
    if (cached) { cache.delete(source); cache.set(source, cached); self.postMessage({ id, program: cached.program, cacheHit: true } satisfies CodeCompilerResponse); return }
    const program = compileCodeMaterial(source)
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
    self.postMessage({ id, error: { code: failure.code, message: failure.message } } satisfies CodeCompilerResponse)
  }
}
