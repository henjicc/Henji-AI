import ts from 'typescript'

import { HenjiScriptError, type HenjiSourceLocation } from './types'

/**
 * 被拒绝的 TypeScript 写法必须给出 Henji Script 里真实可用的替代方案。
 * 这里只登记与具体语法形状有关的诊断；API 白名单仍由 compiler.ts 持有。
 */
const SYNTAX_ALTERNATIVES: Readonly<Record<string, string>> = {
  NewExpression: '不要 new 任何对象：脚本里只有字面量、读取结果和 app.* 调用；需要时间戳或随机值就交给宿主生成。',
  RegularExpressionLiteral: '正则只能作为字符串字面量传给 app.assert.matches，不能写成 /…/ 字面量参与运算。',
  ArrowFunction: '不允许自定义函数：有界遍历用 for...of，条件用三元表达式。',
  FunctionExpression: '不允许自定义函数：有界遍历用 for...of，条件用三元表达式。',
  AwaitExpression: 'await 只能直接写在 app.* 应用操作前，表达式 helper 不需要 await。',
  SpreadElement: '不支持展开运算符；把要写的字段逐条列出来。',
  ObjectBindingPattern: '不支持解构；用 const 取一次再点访问。',
  ArrayBindingPattern: '不支持解构；用 const 取一次再按下标访问。',
  ThisKeyword: '脚本里没有 this。',
  PrefixUnaryExpression: '一元运算只支持负号字面量；取反请改用三元表达式或 app.assert。',
  AsExpression: '不需要类型标注：去掉 as const / as 类型，直接写字符串或数字字面量。',
  SatisfiesExpression: '不需要类型标注：去掉 satisfies，直接写字面量。',
  TypeAssertionExpression: '不需要类型标注：去掉尖括号断言，直接写字面量。',
  NonNullExpression: '不需要非空断言：去掉结尾的 !，字段不存在时宿主会直接告诉你。',
  ReturnStatement: 'Henji Script 没有 return 返回值；删除 return 这一行。调用结果要在后续步骤使用就继续引用对应 const；完成后的 resultRefs、Effect 和 verification 由 run_henji_script 自动返回。',
}

const CALL_ALTERNATIVES: Readonly<Record<string, string>> = {
  'JSON.stringify': '不要序列化：断言直接比对字段值（app.assert.equal），需要整段内容就把读取结果原样传给下一步。',
  'JSON.parse': '读取结果已经是结构化对象，不需要解析。',
  'Math.random': '脚本必须确定性；随机值由宿主生成，不能在脚本里取。',
  'Date.now': '脚本必须确定性；时间戳由宿主生成，不能在脚本里取。',
  'Object.keys': '不支持反射遍历；直接写出要用的属性 ID。',
  'Object.entries': '不支持反射遍历；直接写出要用的属性 ID。',
  'Array.isArray': '不支持类型判断；结果字段的形状由 scriptApi 的 schema 给出。',
}

const ARRAY_METHOD_ALTERNATIVE: Readonly<Record<string, string>> = {
  find: "改用 app.find(数组, '字段名', 期望值)，返回第一个命中的元素，没有就是 null。",
  filter: "改用 app.filter(数组, '字段名', 期望值)，返回全部命中的元素。",
  some: "改用 app.find(数组, '字段名', 期望值) 再 app.assert.exists / app.assert.absent。",
  findIndex: "改用 app.find(数组, '字段名', 期望值) 直接拿到那个元素，不要绕道下标。",
  slice: '改用 app.take(数组, 数量) 取前 N 项；受限语言不支持任意数组方法。',
  map: '受限语言没有闭包。要取多项里的某个字段，先用 app.filter 选出来再逐项写明。',
  forEach: '受限语言没有闭包。要对多个已知实体逐个写入，写成多次 app.entities.* 调用。',
}

export const SCRIPT_RESULT_ALTERNATIVE = 'Henji Script 不使用裸表达式交出返回值；删除这一行。'
  + '调用结果要在后续步骤使用就继续引用对应 const；完成后的 resultRefs、Effect 和 verification '
  + '由 run_henji_script 自动返回，不需要手动交出结果。'

export function locationOf(sourceFile: ts.SourceFile, node: ts.Node): HenjiSourceLocation {
  const point = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  return { line: point.line + 1, column: point.character + 1 }
}

/** 出错那一行的原文，截短后放进错误信息——比 SyntaxKind 名字有用得多。 */
export function sourceSnippet(sourceFile: ts.SourceFile, node: ts.Node): string {
  const text = node.getText(sourceFile).replace(/\s+/g, ' ').trim()
  return text.length > 80 ? `${text.slice(0, 80)}…` : text
}

export function unsupported(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
  alternative?: string,
): never {
  throw new HenjiScriptError(
    'SCRIPT_UNSUPPORTED_SYNTAX',
    'compile',
    `${message}：\`${sourceSnippet(sourceFile, node)}\`${alternative ? `。${alternative}` : ''}`,
    locationOf(sourceFile, node),
  )
}

export function syntaxAlternative(kind: ts.SyntaxKind): string | undefined {
  return SYNTAX_ALTERNATIVES[ts.SyntaxKind[kind]]
}

function stringConversionValue(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
  pathName: string,
): string | null {
  if (pathName === 'String' && call.arguments.length === 1) {
    return sourceSnippet(sourceFile, call.arguments[0])
  }
  if (pathName.endsWith('.toString') && call.arguments.length === 0
    && ts.isPropertyAccessExpression(call.expression)) {
    return sourceSnippet(sourceFile, call.expression.expression)
  }
  return null
}

export function expressionCallAlternative(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
  pathName: string,
): string | undefined {
  const exact = CALL_ALTERNATIVES[pathName]
  if (exact) return exact
  const conversionValue = stringConversionValue(sourceFile, call, pathName)
  if (conversionValue) {
    return `转成字符串不需要调用方法或新增 helper；改用 \`\${${conversionValue}}\` 或 '' + ${conversionValue}。`
  }
  const segments = pathName.split('.')
  return ARRAY_METHOD_ALTERNATIVE[segments[segments.length - 1] ?? '']
}
