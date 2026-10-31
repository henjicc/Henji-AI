import ts from 'typescript'
import { z } from 'zod'
import { VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS } from './builtinEffects'

export const codeEffectSuggestionSchema = z.object({
  file: z.string(), line: z.number().int().positive(), column: z.number().int().positive(), evidence: z.string(),
  factory: z.string(), confidence: z.enum(['static_assignment', 'structural_candidate']), message: z.string(),
}).strict()
export type CodeEffectSuggestion = z.infer<typeof codeEffectSuggestionSchema>

/** 只报告可定位的源码事实；不执行作者代码，也不把算法候选当像素结论。 */
export function reviewCodeEffectUsage(source: ts.SourceFile): CodeEffectSuggestion[] {
  const suggestions: CodeEffectSuggestion[] = []
  const factories = new Set(VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS.flatMap(value => value.author ? [value.author.factory] : []))
  const number = (node: ts.Expression): number | undefined => {
    if (ts.isParenthesizedExpression(node)) return number(node.expression)
    if (ts.isNumericLiteral(node)) return Number(node.text)
    if (ts.isPrefixUnaryExpression(node) && (node.operator === ts.SyntaxKind.MinusToken || node.operator === ts.SyntaxKind.PlusToken)) { const value = number(node.operand); return value === undefined ? undefined : node.operator === ts.SyntaxKind.MinusToken ? -value : value }
    return undefined
  }
  const text = (node: ts.Expression): { value: string; dynamic: boolean } => {
    if (ts.isParenthesizedExpression(node)) return text(node.expression)
    if (ts.isStringLiteralLike(node)) return { value: node.text, dynamic: false }
    if (ts.isTemplateExpression(node)) return { value: node.head.text + node.templateSpans.map(span => '${…}' + span.literal.text).join(''), dynamic: true }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) { const a = text(node.left), b = text(node.right); return { value: a.value + b.value, dynamic: a.dynamic || b.dynamic } }
    return { value: '${…}', dynamic: true }
  }
  const member = (node: ts.Expression, contexts: Set<string>): string => {
    const receiver = ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) ? node.expression : undefined
    return receiver && ts.isIdentifier(receiver) && contexts.has(receiver.text) ? ts.isPropertyAccessExpression(node) ? node.name.text : ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : '' : ''
  }
  const shadowOffsets = new Map<ts.Node, Set<string>>()
  const offsetShadow = (node: ts.Node, contexts: Set<string>): boolean => {
    let scope = node.parent
    while (scope.parent && !ts.isFunctionLike(scope)) scope = scope.parent
    let receivers = shadowOffsets.get(scope)
    if (!receivers) {
      receivers = new Set<string>()
      const scan = (part: ts.Node): void => {
        if (part !== scope && ts.isFunctionLike(part)) return
        if (ts.isBinaryExpression(part) && part.operatorToken.kind === ts.SyntaxKind.EqualsToken && number(part.right) !== 0) {
          const left = part.left
          const receiver = ts.isPropertyAccessExpression(left) || ts.isElementAccessExpression(left) ? left.expression : undefined
          if (receiver && ts.isIdentifier(receiver) && ['shadowOffsetX', 'shadowOffsetY'].includes(member(left, new Set([receiver.text])))) receivers!.add(receiver.text)
        }
        ts.forEachChild(part, scan)
      }
      scan(scope); shadowOffsets.set(scope, receivers)
    }
    return [...contexts].some(context => receivers.has(context))
  }
  const add = (node: ts.Node, factory: string, message: string, confidence: CodeEffectSuggestion['confidence'] = 'static_assignment'): void => {
    if (!factories.has(factory)) return
    const at = source.getLineAndCharacterOfPosition(node.getStart(source))
    suggestions.push({ file: source.fileName, line: at.line + 1, column: at.character + 1, evidence: node.getText(source), factory, confidence, message })
  }
  const visit = (node: ts.Node, contexts: Set<string>): void => {
    if (ts.isFunctionLike(node)) {
      contexts = new Set(contexts)
      const name = 'name' in node && node.name ? node.name.getText(source) : ts.isPropertyAssignment(node.parent) ? node.parent.name.getText(source) : ''
      for (const [index, parameter] of node.parameters.entries()) if (ts.isIdentifier(parameter.name) && (index === 0 && name === 'draw' || parameter.type?.getText(source).includes('CanvasRenderingContext2D'))) contexts.add(parameter.name.text)
    }
    if (ts.isFunctionLike(node) && 'body' in node && node.body) {
      let additive: ts.Node | undefined, repeated: ts.Node | undefined
      const scan = (part: ts.Node, loop = false): void => {
        if (part !== node && ts.isFunctionLike(part)) return
        if (ts.isBinaryExpression(part) && part.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(part.left)
          && ts.isIdentifier(part.left.expression) && contexts.has(part.left.expression.text) && part.left.name.text === 'globalCompositeOperation'
          && ts.isStringLiteralLike(part.right) && part.right.text === 'lighter') additive = part
        if (loop && ts.isCallExpression(part) && ts.isPropertyAccessExpression(part.expression) && ts.isIdentifier(part.expression.expression)
          && contexts.has(part.expression.expression.text) && part.expression.name.text === 'drawImage' && part.arguments.length >= 3
          && part.arguments.slice(1, 3).some(value => ts.isBinaryExpression(value))) repeated = part
        ts.forEachChild(part, child => scan(child, loop || ts.isForStatement(part) || ts.isForOfStatement(part) || ts.isWhileStatement(part)))
      }
      scan(node.body)
      if (additive && repeated) add(repeated, 'glow', '同一绘制入口含 lighter 混合与循环偏移 drawImage，是手写光晕候选；请看画面后核对 glow，不能据此证明算法等价。', 'structural_candidate')
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isIdentifier(node.initializer) && contexts.has(node.initializer.text)) contexts.add(node.name.text)
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const property = member(node.left, contexts)
      if (property) {
        if (property === 'shadowBlur') {
          const blur = number(node.right), offset = offsetShadow(node, contexts)
          const factory = factories.has('dropShadow') ? 'dropShadow' : offset ? undefined : factories.has('glow') ? 'glow' : undefined
          if (factory && (blur === undefined || blur > 0)) add(node, factory, `Canvas shadowBlur ${offset ? '含偏移投影' : '是虚化阴影候选'}；先查风格件，再看画面核对 ${factory}，不能据此证明算法等价。`, blur === undefined ? 'structural_candidate' : 'static_assignment')
        }
        if (property === 'filter') {
          const filter = text(node.right)
          if (/blur\s*\(/.test(filter.value)) add(node, 'blur', 'Canvas filter 使用 blur；先查风格件，再核对图层 blur 工厂，参数按完整画幅高度换算。', filter.dynamic ? 'structural_candidate' : 'static_assignment')
        }
      }
    }
    if (ts.isObjectLiteralExpression(node)) {
      const names = node.properties.flatMap(property => property.name ? [property.name.getText(source)] : [])
      if (names.includes('effects') && names.includes('draw') && !names.includes('bounds') && !node.properties.some(ts.isSpreadAssignment)) add(node, 'blur', '效果层未声明 bounds，将按完整作者画幅栅格；给出包含内容的 bounds 可减少中间纹理。', 'structural_candidate')
    }
    ts.forEachChild(node, child => visit(child, contexts))
  }
  visit(source, new Set())
  return suggestions
}
