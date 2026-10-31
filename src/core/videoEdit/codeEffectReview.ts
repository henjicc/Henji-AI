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
      const left = node.left
      const receiver = ts.isPropertyAccessExpression(left) || ts.isElementAccessExpression(left) ? left.expression : undefined
      const property = ts.isPropertyAccessExpression(left) ? left.name.text : ts.isElementAccessExpression(left) && ts.isStringLiteralLike(left.argumentExpression) ? left.argumentExpression.text : ''
      if (receiver && ts.isIdentifier(receiver) && contexts.has(receiver.text)) {
        if (property === 'shadowBlur' && ts.isNumericLiteral(node.right) && Number(node.right.text) > 0) add(node, 'glow', '存在非零 Canvas shadowBlur；核对虚化或发光是否可复用 henji-effects。投影不等同于高斯模糊，不自动替换。')
        if (property === 'filter' && (ts.isStringLiteralLike(node.right) || ts.isNoSubstitutionTemplateLiteral(node.right)) && /blur\s*\(/.test(node.right.text)) add(node, 'blur', '静态 Canvas filter 使用 blur；可核对图层 blur 工厂，参数按完整画幅高度换算。')
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
