import type { CodeHeavyStructure } from './performance'
import { CODE_V3_LIMITS, CodeMaterialError } from './contract'
import type { CodeDrawCommand, CodeExpression, CodeMaterialContext, CodeMaterialProgram, CodeTextMeasurer } from './contract'
import { validateCodeMaterialParameters } from './parameters'
import { codeExecutionCompiler, codeTextRequest } from './executionPlan'
import { codeExecutionCache, type CodeExecutionFrame } from './executionCache'
export { codeTextRequest } from './executionPlan'
const array = (value: unknown): unknown[] => { if (!Array.isArray(value)) throw new CodeMaterialError('TYPE', '需要数组。'); return value }
export interface CodeEvaluationOptions { cullInvisible?: boolean; onEvaluation?: (value: { structures: CodeHeavyStructure[]; culledGroups: number; operations: number }) => void; onProfile?: (heaviest: CodeHeavyStructure | undefined) => void; measureText?: CodeTextMeasurer; onDiagnostic?: (diagnostic: { code: 'MISSING_FONT'; fontFamily: string; elementId?: string }) => void }
function evaluateV3(program: CodeMaterialProgram, context: CodeMaterialContext, values: Readonly<Record<string, unknown>>, options: CodeEvaluationOptions = {}, root?: CodeExpression): unknown {
  const profile = new Map<string, CodeHeavyStructure>()
  const parameters = validateCodeMaterialParameters(program, values); const bindings: unknown[] = []; const locals = new Map<number, unknown>()
  const indices: number[] = []
  const charge = (cost = 1): void => { if (frame.prepaid) return; frame.operations += cost; if (frame.operations > CODE_V3_LIMITS.cpuOperations) throw new CodeMaterialError('BUDGET', `CPU 工作量 ${frame.operations} / ${CODE_V3_LIMITS.cpuOperations}，超出 ${frame.operations - CODE_V3_LIMITS.cpuOperations}；当前结构见源码位置。`) }
  const measure = (fields: Record<string, unknown>): ReturnType<CodeTextMeasurer> => {
    if (!options.measureText) throw new CodeMaterialError('CONTEXT', 'v3 文字需要宿主提供与渲染共享的字体度量。')
    const request = codeTextRequest(fields); charge(request.text.length * (request.maxLines ? 32 : 2))
    const result = options.measureText(request)
    if (result.missingFont) options.onDiagnostic?.({ code: 'MISSING_FONT', fontFamily: result.missingFont })
    return result
  }
  const compile = codeExecutionCompiler(program)
  const cache = codeExecutionCache(program, parameters, context)
  const frame: CodeExecutionFrame = { context, parameters, bindings, locals, indices, draws: 0, characters: 0, operations: 0, prepaid: false, charge, measure, profile: options.onProfile ? profile : undefined, bindingsReady: false, cache, epoch: cache.epoch }
  const evaluate = (expression: CodeExpression): unknown => compile(expression).run(frame, 0)
  frame.cullInvisible = options.cullInvisible; frame.culledGroups = 0
  if (options.onEvaluation) { frame.profile = profile; frame.profileCached = !options.onProfile }
  const report = (): void => {
    const structures = [...profile.values()].sort((a, b) => b.cpuMs - a.cpuMs)
    options.onProfile?.(structures[0])
    options.onEvaluation?.({ structures, culledGroups: frame.culledGroups ?? 0, operations: frame.operations })
  }
  if (root) { const result = evaluate(root); report(); return result }
  frame.lazyDrawBindings = frame.cullInvisible && program.bindings.some(binding => ['draw', 'draws'].includes(binding.expression.type))
  program.bindings.forEach((binding, index) => {
    if (frame.lazyDrawBindings && ['draw', 'draws'].includes(binding.expression.type)) return
    if (!(index in bindings)) bindings[index] = evaluate(binding.expression)
  })
  frame.bindingsReady = true
  const output = array(evaluate(program.result)) as CodeDrawCommand[]
  let actual = 0; let textCharacters = 0; let shaderLayers = 0
  const assign = (commands: CodeDrawCommand[], path: string[]): void => commands.forEach((command, index) => {
    actual += command.kind === 'text' && command.perChar ? Math.max(1, command.layout!.glyphs.length) : 1
    if (actual > CODE_V3_LIMITS.draws) throw new CodeMaterialError('BUDGET', '本帧图形超过 4096。', command.sourceSpan)
    if (command.kind === 'shader' && ++shaderLayers > CODE_V3_LIMITS.shaderLayers) throw new CodeMaterialError('BUDGET', '本帧着色器层超出预算。', command.sourceSpan)
    command.elementPath = [...path, `${command.elementId}/${index}`]
    if (command.kind === 'text') textCharacters += command.text.length
    if (textCharacters > CODE_V3_LIMITS.textCharacters) throw new CodeMaterialError('BUDGET', '本帧文本字符总数超过 8192。', command.sourceSpan)
    if (command.kind === 'group') { assign(command.children, command.elementPath); if (command.mask?.shape) assign([command.mask.shape], [...command.elementPath, 'mask']) }
  })
  // Fresh frame commands already belong to this evaluation. Only aliases need a
  // copy before path assignment; no shared occurrence may mutate another's path.
  const seen = new WeakSet<CodeDrawCommand>()
  const clone = (commands: CodeDrawCommand[]): CodeDrawCommand[] => commands.filter(Boolean).map(command => {
    const next = seen.has(command) ? { ...command } : command; seen.add(command); seen.add(next)
    if (next.kind === 'group') { next.children = clone(next.children); if (next.mask) next.mask = { ...next.mask, shape: next.mask.shape ? clone([next.mask.shape])[0] : null } }
    return next
  })
  const commands = clone(output); assign(commands, [])
  report(); return commands
}

export function evaluateCodeMaterialV3(program: CodeMaterialProgram, context: CodeMaterialContext, values: Readonly<Record<string, unknown>>, options: CodeEvaluationOptions = {}): CodeDrawCommand[] {
  return evaluateV3(program, context, values, options) as CodeDrawCommand[]
}
/** Used only for compiler-checked, pixel-independent uniforms of trusted filter passes. */
export function evaluateCodeFrameExpression(program: CodeMaterialProgram, expression: CodeExpression, context: CodeMaterialContext, values: Readonly<Record<string, unknown>>): unknown {
  return evaluateV3(program, context, values, {}, expression)
}

/** One frame budget and binding cache shared by all lifted expressions. */
export function evaluateCodeFrameExpressions(program: CodeMaterialProgram, expressions: readonly CodeExpression[], context: CodeMaterialContext, values: Readonly<Record<string, unknown>>, options: CodeEvaluationOptions = {}): unknown[] {
  return evaluateV3(program, context, values, options, { kind: 'array', type: 'array', values: [...expressions] }) as unknown[]
}
