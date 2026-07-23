import { z } from 'zod'

import {
  addCanvasNodeCommandSchema,
  cancelGenerationTaskCommandSchema,
  connectCanvasNodesCommandSchema,
  createVisibleGenerationTaskCommandSchema,
  focusCanvasNodeCommandSchema,
  hostCommandSchema,
  openCanvasProjectCommandSchema,
  switchWorkspaceCommandSchema,
  undoCanvasChangeCommandSchema,
  type HostCommand,
  type HostCommandName,
  type HostCommandResult,
  type HostErrorCode,
  type HostScope,
} from '@/core/assistant/hostContracts'
import {
  addCanvasNodeFromAgent,
  AgentCanvasActionError,
  connectCanvasNodesFromAgent,
  focusCanvasNodeFromAgent,
  openCanvasProjectFromAgent,
  undoCanvasChangeFromAgent,
} from '@/features/canvas/application/agentCanvasActions'
import { switchWorkspace } from '@/stores/navigationStore'
import {
  cancelVisibleGenerationTask,
  runVisibleGenerationTaskCommand,
} from '@/workspaces/GenerationWorkspace/application/visibleGenerationTaskCommand'

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

const definitions: HostCommandDefinition[] = [
  defineHostCommand('switch_workspace', switchWorkspaceCommandSchema, ['navigation'], async (command, context) => {
    throwIfAborted(context.signal)
    switchWorkspace(command.input.workspace)
    return { workspace: command.input.workspace }
  }),
  defineHostCommand('open_canvas_project', openCanvasProjectCommandSchema, ['navigation', 'canvas'], async (command, context) => {
    const result = await openCanvasProjectFromAgent(command.input.projectId, context.signal)
    switchWorkspace('nodes')
    return result
  }),
  defineHostCommand('add_canvas_node', addCanvasNodeCommandSchema, ['canvas'], async (command, context) => {
    throwIfAborted(context.signal)
    return addCanvasNodeFromAgent(command.input)
  }),
  defineHostCommand('connect_canvas_nodes', connectCanvasNodesCommandSchema, ['canvas'], async (command, context) => {
    throwIfAborted(context.signal)
    return connectCanvasNodesFromAgent(command.input)
  }),
  defineHostCommand('focus_canvas_node', focusCanvasNodeCommandSchema, ['navigation', 'canvas'], async (command, context) => {
    throwIfAborted(context.signal)
    switchWorkspace('nodes')
    return await focusCanvasNodeFromAgent(command.input.projectId, command.input.nodeId, context.signal)
  }),
  defineHostCommand('undo_canvas_change', undoCanvasChangeCommandSchema, ['canvas'], async (command, context) => {
    throwIfAborted(context.signal)
    return undoCanvasChangeFromAgent(command.input.projectId, command.input.undoRef)
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
      return { taskId, status: 'submitted' as const }
    }
  ),
  defineHostCommand('cancel_generation_task', cancelGenerationTaskCommandSchema, ['generation'], async (command, context) => {
    throwIfAborted(context.signal)
    return await cancelVisibleGenerationTask(command.input.taskId, command.input.reason)
  }),
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
    if (error instanceof AgentCanvasActionError) {
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
