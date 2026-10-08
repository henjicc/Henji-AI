import { CodeMaterialError, type CodeSourceSpan } from '@/core/videoEdit/codeMaterial/contract'
import type { ShaderGraphSpec } from '@/core/videoEdit/shaderGraph/spec'
import { ShaderGraphError } from './shaderGraphSession'

/**
 * 代码素材里的着色器失败 → 作者能定位的源码错误：自写 WGSL 的报错换算成素材源码行号，
 * 其余（未知组件、属性）指向调用处。
 */
export function codeShaderFailure(error: unknown, graph: ShaderGraphSpec, span?: CodeSourceSpan): unknown {
  if (!(error instanceof ShaderGraphError)) return error
  const shader = error.shader ? graph.shaders?.find(value => value.name === error.shader) : undefined
  const line = shader?.sourceLine && error.line ? shader.sourceLine + error.line - 1 : undefined
  const location: CodeSourceSpan | undefined = line ? { file: shader?.sourceFile ?? span?.file ?? 'main.ts', start: 0, end: 0, startLine: line, endLine: line, startColumn: 1, endColumn: 1 } : span
  return new CodeMaterialError('TYPE', line ? `${error.message}（${location!.file} 素材源码第 ${line} 行）` : error.message, location)
}
