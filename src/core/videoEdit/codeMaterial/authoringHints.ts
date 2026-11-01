import type { CodeAuthorProgram } from '../codeAuthorProgram'

export interface CodeAuthoringHint { code: 'NO_PARAMETERS' | 'MISSING_TEXT_STYLE' | 'UNBOUND_TEXT' | 'UNBOUND_VISUAL'; message: string; line?: number }

/** Declaration-only feedback. Never infer arbitrary JS reads or Canvas calls. */
export function codeMaterialAuthoringHints(program: CodeAuthorProgram): CodeAuthoringHint[] {
  const hints: CodeAuthoringHint[] = []
  if (!program.parameters.length) hints.push({ code: 'NO_PARAMETERS', message: '建议克制地声明用户大概率想调整的文案、颜色、节奏和强度参数，并按元素分组。' })
  for (const parameter of program.parameters) {
    if (parameter.type !== 'text') continue
    if (!parameter.layer) hints.push({ code: 'UNBOUND_TEXT', message: `文字参数 ${parameter.key} 未绑定图层；在 params 中声明 layer 以支持点选和双击改字。` })
    if (!program.parameters.some(style => style.type === 'textStyle' && style.layer === parameter.layer)) hints.push({ code: 'MISSING_TEXT_STYLE', message: `文字参数 ${parameter.key} 还需要绑定同一图层的 textStyle 参数，默认值跟随当前风格包。` })
  }
  // 点中元素时属性块只列绑定到它的参数；除文字外一个都没有，用户就改不了它的颜色、字号。调整层没有可调的视觉属性。
  const adjust = new Set(program.bundle.locations?.adjustLayerIds ?? [])
  for (const [id, span] of Object.entries(program.bundle.locations?.layers ?? {})) {
    if (adjust.has(id) || program.parameters.some(parameter => parameter.layer === id && parameter.type !== 'text')) continue
    hints.push({ code: 'UNBOUND_VISUAL', message: `元素 ${id} 除文字外没有绑定参数，点中它时改不了颜色、字号；把用户可能想改的视觉属性写成参数并用 layer 绑定到它。`, line: span.startLine })
  }
  return hints
}
