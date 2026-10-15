import { codeBinaryCost, codeBuiltinCost, CodeMaterialError, finiteCodeNumber } from './contract'
import type { CodeExpression, CodeMaterialContext } from './contract'

interface NumericFrame { context: CodeMaterialContext; locals: Map<number, unknown> }
interface NumericPlan { cost: number; height: number; locals: number[]; frameDependent: boolean; run(frame: NumericFrame): number }
const plans = new WeakMap<CodeExpression, NumericPlan | null>()
const unaryMath: Readonly<Record<string, (value: number) => number>> = { sin: Math.sin, cos: Math.cos, abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round }

/** Specialize the existing closed scalar IR once, without eval/Function or source
 * emission. executionPlan binds the remaining nodes and owns bounded frame/index
 * caching. Costs are charged in one batch; arithmetic still checks finiteness.
 */
export function codeNumericPlan(expression: CodeExpression, depth = 0): NumericPlan | null {
  if (depth > 64) throw new CodeMaterialError('BUDGET', 'IR 深度超出 64。', expression.sourceSpan)
  if (plans.has(expression)) return plans.get(expression)!
  let plan: NumericPlan | null = null
  if (expression.type !== 'number') { plans.set(expression, null); return null }
  const dependencies = (...children: NumericPlan[]): Pick<NumericPlan, 'height' | 'locals' | 'frameDependent'> => ({ height: 1 + Math.max(0, ...children.map(child => child.height)), locals: [...new Set(children.flatMap(child => child.locals))], frameDependent: children.some(child => child.frameDependent) })
  if (expression.kind === 'literal' && typeof expression.value === 'number') { const value = expression.value; plan = { cost: 1, ...dependencies(), run: () => value } }
  else if (expression.kind === 'context' && expression.key !== 'u' && expression.key !== 'v') { const key = expression.key; plan = { cost: 1, ...dependencies(), frameDependent: true, run: frame => frame.context[key] } }
  else if (expression.kind === 'local') { const slot = expression.slot; plan = { cost: 1, ...dependencies(), locals: [slot], run: frame => finiteCodeNumber(frame.locals.get(slot), 'repeat/字符索引') } }
  else if (expression.kind === 'unary' && expression.op !== '!') {
    const child = codeNumericPlan(expression.value, depth + 1)
    if (child) plan = { cost: 1 + child.cost, ...dependencies(child), run: expression.op === '-' ? frame => -child.run(frame) : child.run }
  } else if (expression.kind === 'binary') {
    const left = codeNumericPlan(expression.left, depth + 1); const right = codeNumericPlan(expression.right, depth + 1)
    const operator = numericOperator(expression.op)
    if (left && right && operator) plan = { cost: codeBinaryCost(expression.op) + left.cost + right.cost, ...dependencies(left, right), run: frame => finiteCodeNumber(operator(left.run(frame), right.run(frame)), `${expression.op} 结果`) }
  } else if (expression.kind === 'call' && expression.op in unaryMath && expression.args.length === 1) {
    const child = codeNumericPlan(expression.args[0], depth + 1); const fn = unaryMath[expression.op]
    if (child) plan = { cost: 1 + codeBuiltinCost(expression.op, 'number').cpu + child.cost, ...dependencies(child), run: frame => finiteCodeNumber(fn(child.run(frame)), `${expression.op} 结果`) }
  }
  if (plan && expression.sourceSpan && expression.kind !== 'literal' && expression.kind !== 'context' && expression.kind !== 'local') {
    const run = plan.run; const sourceSpan = expression.sourceSpan
    plan = { ...plan, run: frame => {
      try { return run(frame) } catch (error) { if (error instanceof CodeMaterialError && !error.sourceSpan) throw new CodeMaterialError(error.code, error.message, sourceSpan); throw error }
    } }
  }
  if (plan && !plan.frameDependent && plan.locals.length === 0 && plan.height > 1) {
    const run = plan.run; let cached: number | undefined
    plan.run = frame => cached ?? (cached = run(frame))
  }
  plans.set(expression, plan); return plan
}
export function numericOperator(op: string): ((a: number, b: number) => number) | undefined {
  switch (op) {
    case '+': return (a, b) => a + b
    case '-': return (a, b) => a - b
    case '*': return (a, b) => a * b
    case '/': return (a, b) => a / b
    case '%': return (a, b) => a % b
    case '**': return (a, b) => a ** b
  }
}
