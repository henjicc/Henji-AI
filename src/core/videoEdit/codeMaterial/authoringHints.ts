import type { CodeAuthorProgram } from '../codeAuthorProgram'

export interface CodeAuthoringHint { code: 'NO_PARAMETERS' | 'MISSING_TEXT_STYLE' | 'UNBOUND_TEXT'; message: string; line?: number }

/** Declaration-only feedback. Never infer arbitrary JS reads or Canvas calls. */
export function codeMaterialAuthoringHints(program: CodeAuthorProgram): CodeAuthoringHint[] {
  const hints: CodeAuthoringHint[] = []
  if (!program.parameters.length) hints.push({ code: 'NO_PARAMETERS', message: '建议克制地声明用户大概率想调整的文案、颜色、节奏和强度参数，并按元素分组。' })
  for (const parameter of program.parameters) {
    if (parameter.type !== 'text') continue
    if (!parameter.layer) hints.push({ code: 'UNBOUND_TEXT', message: `文字参数 ${parameter.key} 未绑定图层；在 params 中声明 layer 以支持点选和双击改字。` })
    if (!program.parameters.some(style => style.type === 'textStyle' && style.layer === parameter.layer)) hints.push({ code: 'MISSING_TEXT_STYLE', message: `文字参数 ${parameter.key} 还需要绑定同一图层的 textStyle 参数，默认值跟随当前风格包。` })
  }
  return hints
}
