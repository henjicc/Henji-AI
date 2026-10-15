import ts from 'typescript'

export function codeSyntaxHint(node: ts.Node): string {
  if (ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node)) return '不支持 for 循环：用 repeat(n, i => …) 生成重复元素。'
  if (ts.isWhileStatement(node) || ts.isDoStatement(node)) return '不支持 while/do 循环：用有界 repeat(n, i => …)。'
  if (ts.isIfStatement(node)) return '不支持 if 语句：用三元表达式 condition ? yes : no 返回同类型的结果。'
  if (ts.isVariableStatement(node)) return '不支持 let/var：用 const 和三元表达式。'
  if (ts.isNewExpression(node) || ts.isClassDeclaration(node) || ts.isClassExpression(node)) return '不支持 new/class：用静态字段对象和纯箭头辅助函数。'
  if (ts.isSpreadElement(node) || ts.isSpreadAssignment(node)) return '不支持展开写法：显式列出数组元素或对象字段，重复元素用 repeat。'
  if (ts.isCallExpression(node)) return '不支持对象方法或动态调用：使用内置函数或 const 声明的纯箭头辅助函数。'
  if (ts.isPostfixUnaryExpression(node)) return '不支持 ++/--：用 const 计算新值，重复元素用 repeat。'
  if (ts.isAwaitExpression(node)) return '不支持 await：render 只能使用确定性的同步表达式。'
  return `不支持写法 ${node.getText().slice(0, 60)}：用 const、纯表达式、三元表达式或 repeat。`
}
export function nearestCodeFunctions(name: string, available: readonly string[]): string[] {
  const distance = (target: string): number => {
    let row = Array.from({ length: target.length + 1 }, (_, i) => i)
    for (let i = 1; i <= name.length; i++) {
      const next = [i]
      for (let j = 1; j <= target.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + Number(name[i - 1].toLowerCase() !== target[j - 1].toLowerCase()))
      row = next
    }
    return row[target.length]
  }
  return [...new Set(available)].map(value => ({ value, distance: distance(value) })).sort((a, b) => a.distance - b.distance || (a.value < b.value ? -1 : 1)).slice(0, 3).map(item => item.value)
}
