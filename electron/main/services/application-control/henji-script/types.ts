export interface HenjiSourceLocation {
  line: number
  column: number
}

export type HenjiValueExpression =
  | { kind: 'literal'; value: string | number | boolean | null }
  | { kind: 'array'; items: HenjiValueExpression[] }
  | { kind: 'object'; entries: Array<{ key: string; value: HenjiValueExpression }> }
  | { kind: 'variable'; name: string; path: Array<string | number> }
  | { kind: 'binary'; operator: string; left: HenjiValueExpression; right: HenjiValueExpression }
  | { kind: 'conditional'; condition: HenjiValueExpression; whenTrue: HenjiValueExpression; whenFalse: HenjiValueExpression }
  | { kind: 'template'; parts: Array<string | HenjiValueExpression> }
  | { kind: 'helper'; name: string; args: HenjiValueExpression[] }

export type HenjiCallKind =
  | 'action'
  | 'recipe'
  | 'entities.list'
  | 'entities.read'
  | 'entities.create'
  | 'entities.update'
  | 'entities.remove'

export interface HenjiCallInstruction {
  kind: 'call'
  stepId: string
  api: HenjiCallKind
  args: HenjiValueExpression[]
  location: HenjiSourceLocation
}

export interface HenjiAssertInstruction {
  kind: 'assert'
  stepId: string
  assertion: 'equal' | 'exists' | 'absent' | 'matches'
  args: HenjiValueExpression[]
  location: HenjiSourceLocation
}

export interface HenjiBranchInstruction {
  kind: 'branch'
  stepId: string
  condition: HenjiValueExpression
  whenTrue: HenjiInstruction[]
  whenFalse: HenjiInstruction[]
  location: HenjiSourceLocation
}

/** 仅由宿主在配方展开后生成，用来把配方最终结果绑定回脚本变量。 */
export interface HenjiAliasInstruction {
  kind: 'alias'
  stepId: string
  sourceStepId: string
  recipeId: string
  location: HenjiSourceLocation
}

export type HenjiInstruction = HenjiCallInstruction | HenjiAssertInstruction | HenjiBranchInstruction | HenjiAliasInstruction

export interface HenjiScriptPlan {
  schemaVersion: 'henji-script-ir/v1'
  summary: string
  instructions: HenjiInstruction[]
  operationUpperBound: number
}

export type HenjiScriptErrorCode =
  | 'SCRIPT_PARSE_FAILED'
  | 'SCRIPT_UNSUPPORTED_SYNTAX'
  | 'SCRIPT_API_NOT_DISCOVERED'
  | 'SCRIPT_PLAN_REJECTED'
  | 'SCRIPT_STEP_FAILED'
  | 'SCRIPT_VERIFICATION_FAILED'

export class HenjiScriptError extends Error {
  constructor(
    readonly code: HenjiScriptErrorCode,
    readonly phase: 'parse' | 'compile' | 'preflight' | 'execute' | 'verify',
    message: string,
    readonly location: HenjiSourceLocation | null = null,
    readonly stepId: string | null = null,
  ) {
    super(`[INVALID_INPUT] ${message}`)
    this.name = 'HenjiScriptError'
  }
}
