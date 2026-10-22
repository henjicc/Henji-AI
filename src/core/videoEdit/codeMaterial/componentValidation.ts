import ts from 'typescript'
import { CodeMaterialError } from './contract'

/** 发布时校验兼容组件，打开和扫描导入不加载完整语法解析器。 */
export function codeComponentExportNames(source: string): string[] {
  const file = ts.createSourceFile('组件.ts', source, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS)
  const names: string[] = []
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement)) continue
    if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const) || statement.modifiers?.some(modifier => modifier.kind !== ts.SyntaxKind.ExportKeyword)) throw new CodeMaterialError('SYNTAX', '项目组件只允许 import、const、export const 与纯箭头函数，不能默认导出或执行副作用。')
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) throw new CodeMaterialError('SYNTAX', '组件声明必须有名称与静态值或箭头函数。')
      if (statement.modifiers?.length) names.push(declaration.name.text)
    }
  }
  if (!names.length) throw new CodeMaterialError('SYNTAX', '项目组件至少需要一个具名导出。')
  return names
}
