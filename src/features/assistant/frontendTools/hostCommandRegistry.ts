import { z } from 'zod'

import {
  addCanvasNodeCommandSchema,
  createVisibleGenerationTaskCommandSchema,
  hostCommandSchema,
  openCanvasProjectCommandSchema,
  switchWorkspaceCommandSchema,
  type HostCommand,
  type HostCommandName,
  type HostCommandResult,
  type HostErrorCode,
  type HostScope,
} from '@/core/assistant/hostContracts'
import { canvasNodeDefinitions } from '@/features/canvas/domain/nodeRegistry'
import type { CanvasNodeData, CanvasNodeType } from '@/features/canvas/domain/canvasNodes'
import { switchWorkspace } from '@/stores/navigationStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore } from '@/stores/projectStore'
import { runVisibleGenerationTaskCommand } from '@/workspaces/GenerationWorkspace/application/visibleGenerationTaskCommand'

import { createHostContextSnapshot } from '../hostContext/hostContext'

class HostCommandError extends Error {
  constructor(
    readonly code: HostErrorCode,
    message: string,
    readonly recoverable: boolean,
    readonly details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'HostCommandError'
  }
}

interface HostCommandExecutionContext {
  signal: AbortSignal
}

interface HostCommandDefinition {
  name: HostCommandName
  requiredScopes: HostScope[]
  execute: (command: HostCommand, context: HostCommandExecutionContext) => Promise<Record<string, unknown>>
}

function defineHostCommand<TCommand extends HostCommand>(
  name: TCommand['name'],
  schema: z.ZodType<TCommand>,
  requiredScopes: HostScope[],
  handler: (command: TCommand, context: HostCommandExecutionContext) => Promise<Record<string, unknown>>
): HostCommandDefinition {
  return {
    name,
    requiredScopes,
    execute: (command, context) => handler(schema.parse(command), context),
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new HostCommandError('ABORTED', '宿主命令已取消', true)
}

async function openCanvasProject(projectId: string, signal: AbortSignal): Promise<void> {
  const projectStore = useProjectStore.getState()
  if (!projectStore.isHydrated) await projectStore.hydrate()
  throwIfAborted(signal)
  if (!useProjectStore.getState().projects.some((project) => project.id === projectId)) {
    throw new HostCommandError('PROJECT_NOT_FOUND', '画布项目不存在', true, { projectId })
  }
  if (useProjectStore.getState().currentProjectId === projectId) return

  await new Promise<void>((resolve, reject) => {
    let settled = false
    const settle = (callback: () => void): void => {
      if (settled) return
      settled = true
      unsubscribe()
      signal.removeEventListener('abort', onAbort)
      clearTimeout(timer)
      callback()
    }
    const onAbort = (): void => settle(() => reject(new HostCommandError('ABORTED', '打开画布项目已取消', true)))
    const unsubscribe = useProjectStore.subscribe((state) => {
      if (state.currentProjectId === projectId) settle(resolve)
      else if (!state.isOpeningProject) settle(() => reject(new HostCommandError('PROJECT_NOT_FOUND', '画布项目无法打开', true, { projectId })))
    })
    const timer = window.setTimeout(() => settle(() => reject(new HostCommandError('DEADLINE_EXCEEDED', '打开画布项目超时', true, { projectId }))), 10_000)
    signal.addEventListener('abort', onAbort, { once: true })
    useProjectStore.getState().openProject(projectId)
  })
}

const definitions: HostCommandDefinition[] = [
  defineHostCommand('switch_workspace', switchWorkspaceCommandSchema, ['navigation'], async (command, context) => {
    throwIfAborted(context.signal)
    switchWorkspace(command.input.workspace)
    return { workspace: command.input.workspace }
  }),
  defineHostCommand('open_canvas_project', openCanvasProjectCommandSchema, ['navigation', 'canvas'], async (command, context) => {
    await openCanvasProject(command.input.projectId, context.signal)
    switchWorkspace('nodes')
    return { projectId: command.input.projectId }
  }),
  defineHostCommand('add_canvas_node', addCanvasNodeCommandSchema, ['canvas'], async (command, context) => {
    throwIfAborted(context.signal)
    if (useProjectStore.getState().currentProjectId !== command.input.projectId) {
      throw new HostCommandError('STALE_CONTEXT', '当前画布项目与命令目标不一致', true, {
        expectedProjectId: command.input.projectId,
        currentProjectId: useProjectStore.getState().currentProjectId,
      })
    }
    if (!(command.input.nodeType in canvasNodeDefinitions)) {
      throw new HostCommandError('INVALID_INPUT', '未知画布节点类型', true, { nodeType: command.input.nodeType })
    }
    const nodeId = useCanvasStore.getState().addNode(
      command.input.nodeType as CanvasNodeType,
      command.input.position,
      (command.input.data ?? {}) as Partial<CanvasNodeData>
    )
    return { projectId: command.input.projectId, nodeId }
  }),
  defineHostCommand(
    'create_visible_generation_task',
    createVisibleGenerationTaskCommandSchema,
    ['generation'],
    async (command, context) => {
      throwIfAborted(context.signal)
      const taskId = await runVisibleGenerationTaskCommand({
        input: command.input.prompt,
        model: command.input.modelId,
        type: command.input.mediaType,
        options: command.input.options,
      })
      if (!taskId) throw new HostCommandError('COMMAND_REJECTED', '生成任务未创建，请检查输入和当前模式', true)
      return { taskId }
    }
  ),
]

const commandDefinitions = new Map(definitions.map((definition) => [definition.name, definition]))

function validateExpectedRevisions(command: HostCommand, definition: HostCommandDefinition): void {
  const expected = command.expectedRevisions
  if (!expected) return
  const current = createHostContextSnapshot().scopeRevisions
  for (const scope of definition.requiredScopes) {
    if (expected[scope] !== undefined && expected[scope] !== current[scope]) {
      throw new HostCommandError('STALE_CONTEXT', `宿主 ${scope} 上下文已变化`, true, {
        scope,
        expectedRevision: expected[scope],
        currentRevision: current[scope],
      })
    }
  }
}

export async function executeHostCommand(commandInput: unknown, signal: AbortSignal): Promise<HostCommandResult> {
  try {
    const command = hostCommandSchema.parse(commandInput)
    const definition = commandDefinitions.get(command.name)
    if (!definition) throw new HostCommandError('UNKNOWN_COMMAND', '未知宿主命令', false, { name: command.name })
    validateExpectedRevisions(command, definition)
    const data = await definition.execute(command, { signal })
    const snapshot = createHostContextSnapshot()
    return {
      ok: true,
      data,
      resultingRevision: snapshot.revision,
      resultingScopeRevisions: snapshot.scopeRevisions,
    }
  } catch (error) {
    if (error instanceof HostCommandError) {
      return { ok: false, error: { code: error.code, message: error.message, recoverable: error.recoverable, details: error.details } }
    }
    if (error instanceof z.ZodError) {
      return { ok: false, error: { code: 'INVALID_INPUT', message: '宿主命令参数无效', recoverable: true, details: { issues: error.issues } } }
    }
    return {
      ok: false,
      error: {
        code: 'COMMAND_REJECTED',
        message: error instanceof Error ? error.message : '宿主命令执行失败',
        recoverable: true,
      },
    }
  }
}

export function getAvailableHostCommands(): HostCommandName[] {
  return [...commandDefinitions.keys()]
}
