import type { RunHenjiScriptInput } from '../../../../../src/core/assistant/capabilities/henjiScriptApplicationCapabilities'
import {
  normalizeApplicationPropertyValue,
  type JsonValue,
} from '../../../../../src/core/application-control'
import type { AgentToolRegistry } from '../../agent-runtime/tools/registry'
import type { HenjiScriptApiLease } from '../../agent-runtime/context/script-api-lease'
import { compileHenjiScript } from './compiler'
import { HENJI_RECIPE_REGISTRY, type HenjiRecipeExpansion } from './recipes'
import {
  digest,
  evaluate,
  expressionObjectEntry,
  fullRef,
  isRecord,
  literalRefKind,
  literalString,
  nestedInstructions,
  propertyKeys,
} from './runtime-values'
import {
  HenjiScriptError,
  type HenjiCallInstruction,
  type HenjiInstruction,
  type HenjiScriptPlan,
  type HenjiValueExpression,
} from './types'

const FORBIDDEN_ACTIONS = new Set([
  'run_henji_script',
  'discover_application_capabilities', 'search_application_capabilities',
  'read_application_schemas', 'load_assistant_skill',
])

const ENTITY_TOOL = {
  'entities.list': 'list_application_entities',
  'entities.read': 'read_application_entity',
  'entities.create': 'change_application_entities',
  'entities.update': 'change_application_entities',
  'entities.remove': 'change_application_entities',
} as const

export class HenjiScriptPreflight {
  constructor(private readonly registry: AgentToolRegistry) {}

  private assertEmbeddableTool(toolName: string, location: HenjiCallInstruction['location'], stepId: string): void {
    const definition = this.registry.get(toolName)
    if (!definition || !definition.capability) {
      throw new HenjiScriptError('SCRIPT_API_NOT_DISCOVERED', 'preflight', `未发现应用能力 ${toolName}`, location, stepId)
    }
    if (definition.risk === 'R3' || definition.risk === 'R4' || definition.destructive || definition.openWorld) {
      throw new HenjiScriptError('SCRIPT_PLAN_REJECTED', 'preflight', `${toolName} 不能嵌入 Henji Script`, location, stepId)
    }
    if (definition.capability.dataClasses.some((item) => item === 'C2' || item === 'C3')) {
      throw new HenjiScriptError('SCRIPT_PLAN_REJECTED', 'preflight', `${toolName} 涉及敏感数据，必须独立审批`, location, stepId)
    }
  }

  compile(input: RunHenjiScriptInput): HenjiScriptPlan {
    const plan = compileHenjiScript(input)
    for (const instruction of nestedInstructions(plan.instructions)) {
      if (instruction.kind !== 'call') continue
      let toolName: string | null = null
      if (instruction.api === 'action') {
        toolName = literalString(instruction.args[0])
        if (!toolName) throw new HenjiScriptError('SCRIPT_PLAN_REJECTED', 'preflight', 'app.action 的能力 ID 必须是字符串字面量', instruction.location, instruction.stepId)
        if (FORBIDDEN_ACTIONS.has(toolName)) {
          throw new HenjiScriptError('SCRIPT_PLAN_REJECTED', 'preflight', `禁止嵌套编排能力 ${toolName}`, instruction.location, instruction.stepId)
        }
      } else if (instruction.api === 'recipe') {
        const recipeId = literalString(instruction.args[0])
        const recipe = recipeId ? HENJI_RECIPE_REGISTRY.get(recipeId) : undefined
        if (!recipe) throw new HenjiScriptError('SCRIPT_API_NOT_DISCOVERED', 'preflight', `未发现配方 ${recipeId ?? '(动态值)'}`, instruction.location, instruction.stepId)
        for (const actionId of recipe.actionIds) this.assertEmbeddableTool(actionId, instruction.location, instruction.stepId)
        continue
      } else toolName = ENTITY_TOOL[instruction.api]
      this.assertEmbeddableTool(toolName, instruction.location, instruction.stepId)
    }
    return plan
  }

  private assertLease(plan: HenjiScriptPlan, lease: HenjiScriptApiLease): void {
    const producedKinds = new Map<string, Set<string>>()
    for (const instruction of nestedInstructions(plan.instructions)) {
      if (instruction.kind !== 'call') continue
      if (instruction.api === 'action' || instruction.api === 'recipe') {
        const id = literalString(instruction.args[0])
        const allowed = instruction.api === 'action' ? lease.actions : lease.recipes
        if (!id || !allowed.has(id)) {
          throw new HenjiScriptError('SCRIPT_API_NOT_DISCOVERED', 'preflight',
            `${instruction.api === 'action' ? '能力' : '配方'} ${id ?? '(动态值)'} 未在本次 scriptApi 租约中披露`,
            instruction.location, instruction.stepId)
        }
        const kinds = instruction.api === 'action' ? this.registry.get(id)?.capability?.producesRefs ?? [] : []
        producedKinds.set(instruction.stepId, new Set(kinds))
        continue
      }
      const typeExpression = instruction.args[0]
      const explicitKind = instruction.api === 'entities.list' || instruction.api === 'entities.create'
        ? literalString(typeExpression) : literalRefKind(typeExpression)
      const possibleKinds = explicitKind ? new Set([explicitKind])
        : typeExpression?.kind === 'variable' ? producedKinds.get(typeExpression.name) ?? new Set<string>() : new Set<string>()
      for (const kind of possibleKinds) {
        if (!lease.entityTypes.has(kind)) throw new HenjiScriptError(
          'SCRIPT_API_NOT_DISCOVERED', 'preflight', `实体类型 ${kind} 未在本次 scriptApi 租约中披露`, instruction.location, instruction.stepId)
      }
      if (instruction.api === 'entities.create' && explicitKind) producedKinds.set(instruction.stepId, new Set([explicitKind]))
      const properties = instruction.api === 'entities.update' ? instruction.args[1]
        : instruction.api === 'entities.create' ? expressionObjectEntry(instruction.args[1], 'properties') : undefined
      for (const propertyId of propertyKeys(properties)) {
        if (!lease.propertyIds.has(propertyId)) throw new HenjiScriptError(
          'SCRIPT_API_NOT_DISCOVERED', 'preflight', `属性 ${propertyId} 未在本次 scriptApi 租约中披露`, instruction.location, instruction.stepId)
      }
      this.assertStaticPropertyValues(properties, lease, instruction)
    }
  }

  private staticCandidates(expression: HenjiValueExpression): JsonValue[] | null {
    if (expression.kind === 'conditional') {
      const whenTrue = this.staticCandidates(expression.whenTrue)
      const whenFalse = this.staticCandidates(expression.whenFalse)
      return whenTrue && whenFalse ? [...whenTrue, ...whenFalse] : null
    }
    try {
      return [evaluate(expression, new Map()) as JsonValue]
    } catch {
      return null
    }
  }

  private assertPropertyValue(
    propertyId: string,
    value: JsonValue,
    lease: HenjiScriptApiLease,
    instruction: HenjiCallInstruction,
  ): void {
    const descriptor = lease.propertyDefinitions.get(propertyId)
    if (!descriptor) return
    try {
      normalizeApplicationPropertyValue(descriptor, value)
    } catch (error) {
      throw new HenjiScriptError(
        'SCRIPT_PLAN_REJECTED',
        'preflight',
        error instanceof Error ? error.message : String(error),
        instruction.location,
        instruction.stepId,
      )
    }
  }

  private assertStaticPropertyValues(
    properties: HenjiValueExpression | undefined,
    lease: HenjiScriptApiLease,
    instruction: HenjiCallInstruction,
  ): void {
    if (properties?.kind !== 'object') return
    for (const entry of properties.entries) {
      const candidates = this.staticCandidates(entry.value)
      if (!candidates) continue
      for (const candidate of candidates) this.assertPropertyValue(entry.key, candidate, lease, instruction)
    }
  }

  assertRuntimeLease(instruction: HenjiCallInstruction, args: unknown[], lease: HenjiScriptApiLease): void {
    if (instruction.api === 'action' || instruction.api === 'recipe') return
    const entityType = instruction.api === 'entities.list' || instruction.api === 'entities.create'
      ? String(args[0]) : fullRef(args[0], instruction.location).kind
    if (!lease.entityTypes.has(entityType)) throw new HenjiScriptError(
      'SCRIPT_API_NOT_DISCOVERED', 'preflight', `实体类型 ${entityType} 未在本次 scriptApi 租约中披露`, instruction.location, instruction.stepId)
    const properties = instruction.api === 'entities.update' ? args[1]
      : instruction.api === 'entities.create' && isRecord(args[1]) ? args[1].properties : null
    if (!isRecord(properties)) return
    for (const propertyId of Object.keys(properties)) {
      if (!lease.propertyIds.has(propertyId)) throw new HenjiScriptError(
        'SCRIPT_API_NOT_DISCOVERED', 'preflight', `属性 ${propertyId} 未在本次 scriptApi 租约中披露`, instruction.location, instruction.stepId)
      this.assertPropertyValue(propertyId, properties[propertyId] as JsonValue, lease, instruction)
    }
  }

  private assertExecutionPrerequisites(instructions: readonly HenjiInstruction[], initial = new Set<string>()): Set<string> {
    const seen = new Set(initial)
    for (const instruction of instructions) {
      if (instruction.kind === 'branch') {
        const trueSeen = this.assertExecutionPrerequisites(instruction.whenTrue, seen)
        const falseSeen = this.assertExecutionPrerequisites(instruction.whenFalse, seen)
        for (const actionId of trueSeen) if (falseSeen.has(actionId)) seen.add(actionId)
        continue
      }
      if (instruction.kind !== 'call' || instruction.api !== 'action') continue
      const actionId = literalString(instruction.args[0])
      if (!actionId) continue
      const prerequisites = this.registry.get(actionId)?.capability?.executionPrerequisites ?? []
      const missing = prerequisites.filter((required) => !seen.has(required))
      if (missing.length > 0) throw new HenjiScriptError(
        'SCRIPT_PLAN_REJECTED', 'preflight',
        `${actionId} 缺少前序能力：${missing.join('、')}`, instruction.location, instruction.stepId,
      )
      seen.add(actionId)
    }
    return seen
  }

  prepare(raw: RunHenjiScriptInput, lease: HenjiScriptApiLease): { instructions: HenjiInstruction[]; planDigest: string } {
    const plan = this.compile(raw)
    this.assertLease(plan, lease)
    let expandedOperationCount = plan.operationUpperBound
    const expand = (instructions: readonly HenjiInstruction[]): HenjiInstruction[] => instructions.flatMap((instruction) => {
      if (instruction.kind === 'branch') return [{ ...instruction, whenTrue: expand(instruction.whenTrue), whenFalse: expand(instruction.whenFalse) }]
      if (instruction.kind !== 'call' || instruction.api !== 'recipe') return [instruction]
      const recipeId = literalString(instruction.args[0])
      const recipe = recipeId ? HENJI_RECIPE_REGISTRY.get(recipeId) : undefined
      if (!recipe) throw new HenjiScriptError('SCRIPT_API_NOT_DISCOVERED', 'preflight', `未发现配方 ${recipeId ?? '(动态值)'}`, instruction.location, instruction.stepId)
      let rawInput: unknown
      try { rawInput = evaluate(instruction.args[1] ?? { kind: 'object', entries: [] }, new Map()) } catch {
        throw new HenjiScriptError('SCRIPT_PLAN_REJECTED', 'preflight', '配方参数必须是可在首次写入前完整校验的字面量', instruction.location, instruction.stepId)
      }
      const parsed = recipe.inputSchema.safeParse(rawInput)
      if (!parsed.success) throw new HenjiScriptError('SCRIPT_PLAN_REJECTED', 'preflight', parsed.error.issues[0]?.message ?? '配方参数不合法', instruction.location, instruction.stepId)
      const expansion: HenjiRecipeExpansion = recipe.expand(parsed.data, instruction.stepId, instruction.location)
      expandedOperationCount += expansion.instructions.length
      if (expandedOperationCount > 128) throw new HenjiScriptError('SCRIPT_PLAN_REJECTED', 'preflight', '配方展开后超过 128 个应用操作', instruction.location, instruction.stepId)
      return [...expand(expansion.instructions), {
        kind: 'alias' as const, stepId: instruction.stepId, sourceStepId: expansion.resultStepId,
        recipeId: recipeId as string, location: instruction.location,
      }]
    })
    const instructions = expand(plan.instructions)
    this.assertForbiddenEffects(instructions, lease)
    this.assertExecutionPrerequisites(instructions)
    return { instructions, planDigest: digest(instructions) }
  }

  private assertForbiddenEffects(
    instructions: readonly HenjiInstruction[],
    lease: HenjiScriptApiLease,
  ): void {
    const forbidden = lease.forbiddenEffects ?? new Set()
    if (forbidden.size === 0) return
    const entityEffects: Partial<Record<HenjiCallInstruction['api'], string>> = {
      'entities.list': 'observe', 'entities.read': 'observe',
      'entities.create': 'create', 'entities.update': 'update', 'entities.remove': 'delete',
    }
    for (const instruction of nestedInstructions(instructions)) {
      if (instruction.kind !== 'call') continue
      const effects = instruction.api === 'action'
        ? (this.registry.get(literalString(instruction.args[0]) ?? '')?.capability?.control?.impacts ?? [])
          .map((impact) => impact.effect)
        : [entityEffects[instruction.api]].filter((effect): effect is string => Boolean(effect))
      const blocked = effects.find((effect) => forbidden.has(effect as never))
      if (blocked) throw new HenjiScriptError(
        'SCRIPT_PLAN_REJECTED', 'preflight',
        `脚本包含用户明确禁止的 ${blocked} Effect`, instruction.location, instruction.stepId,
      )
    }
  }
}
