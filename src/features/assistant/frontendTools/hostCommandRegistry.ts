import { z } from 'zod'

import {
  addCanvasNodeCommandSchema,
  addAssetToCanvasCommandSchema,
  addAssetToLibraryCommandSchema,
  addCameraStageObjectCommandSchema,
  addCameraStageShotCommandSchema,
  cancelGenerationTaskCommandSchema,
  commitCanvasBatchCommandSchema,
  commitImageEditCommandSchema,
  closeCanvasProjectCommandSchema,
  connectCanvasNodesCommandSchema,
  createCameraStageProjectCommandSchema,
  createCanvasProjectCommandSchema,
  createImageEditPreviewCommandSchema,
  createVisibleGenerationTaskCommandSchema,
  deleteAssetCommandSchema,
  deleteCameraStageObjectCommandSchema,
  deleteCameraStageProjectCommandSchema,
  deleteCanvasNodesCommandSchema,
  deleteCanvasProjectCommandSchema,
  disconnectCanvasEdgeCommandSchema,
  duplicateCameraStageObjectCommandSchema,
  duplicateCanvasNodeCommandSchema,
  focusCanvasNodeCommandSchema,
  groupCanvasNodesCommandSchema,
  hostCommandSchema,
  openCameraStageProjectCommandSchema,
  openCanvasProjectCommandSchema,
  removeAssetFromLibraryCommandSchema,
  renameCameraStageProjectCommandSchema,
  renameCanvasProjectCommandSchema,
  selectAssetCommandSchema,
  selectCanvasNodeCommandSchema,
  selectToolboxToolCommandSchema,
  setAssetTagsCommandSchema,
  switchWorkspaceCommandSchema,
  undoCanvasChangeCommandSchema,
  updateCameraStageObjectCommandSchema,
  updateCameraStageShotCommandSchema,
  updateCanvasNodeCommandSchema,
  type HostCommand,
  type HostCommandName,
  type HostCommandResult,
  type HostErrorCode,
  type HostScope,
} from '@/core/assistant/hostContracts'
import {
  GenerationPreparationError,
  prepareGenerationTask,
} from '@/core/assistant/generationPreparation'
import {
  addCanvasNodeFromAgent,
  AgentCanvasActionError,
  connectCanvasNodesFromAgent,
  focusCanvasNodeFromAgent,
  undoCanvasChangeFromAgent,
} from '@/features/canvas/application/agentCanvasActions'
import { commitCanvasBatchFromAgent } from '@/features/canvas/application/agentCanvasBatch'
import {
  closeCanvasProjectFromAgent,
  createCanvasProjectFromAgent,
  deleteCanvasProjectFromAgent,
  openCanvasProjectWithSummaryFromAgent,
  renameCanvasProjectFromAgent,
} from '@/features/canvas/application/agentCanvasProjects'
import {
  deleteCanvasNodesFromAgent,
  disconnectCanvasEdgeFromAgent,
  duplicateCanvasNodeFromAgent,
  groupCanvasNodesFromAgent,
  selectCanvasNodeFromAgent,
  updateCanvasNodeFromAgent,
} from '@/features/canvas/application/agentCanvasMutations'
import { selectToolboxTool, switchWorkspace } from '@/stores/navigationStore'
import {
  addAssetToLibraryFromAgent,
  addAssetToCanvasFromAgent,
  addCameraStageObjectFromAgent,
  addCameraStageShotFromAgent,
  createCameraStageProjectFromAgent,
  createImageEditPreviewFromAgent,
  commitImageEditFromAgent,
  deleteAssetFromAgent,
  deleteCameraStageObjectFromAgent,
  deleteCameraStageProjectFromAgent,
  duplicateCameraStageObjectFromAgent,
  removeAssetFromLibraryFromAgent,
  openCameraStageProjectFromAgent,
  renameCameraStageProjectFromAgent,
  setAssetTagsFromAgent,
  updateCameraStageObjectFromAgent,
  updateCameraStageShotFromAgent,
} from '@/features/assistant/hostActions'
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
    const result = await openCanvasProjectWithSummaryFromAgent(command.input.projectId, context.signal)
    switchWorkspace('nodes')
    return result
  }),
  defineHostCommand('create_canvas_project', createCanvasProjectCommandSchema, ['canvas'], async (command, context) => {
    throwIfAborted(context.signal)
    const result = await createCanvasProjectFromAgent(command.input.name)
    switchWorkspace('nodes')
    return result
  }),
  defineHostCommand('close_canvas_project', closeCanvasProjectCommandSchema, ['canvas'], async (command, context) => {
    throwIfAborted(context.signal)
    return await closeCanvasProjectFromAgent(command.input.projectId)
  }),
  defineHostCommand('rename_canvas_project', renameCanvasProjectCommandSchema, ['canvas'], async (command, context) => {
    throwIfAborted(context.signal)
    return await renameCanvasProjectFromAgent(command.input.projectId, command.input.name)
  }),
  defineHostCommand('delete_canvas_project', deleteCanvasProjectCommandSchema, ['canvas'], async (command, context) => {
    throwIfAborted(context.signal)
    return await deleteCanvasProjectFromAgent(command.input.projectId)
  }),
  defineHostCommand('add_canvas_node', addCanvasNodeCommandSchema, ['canvas'], async (command, context) => {
    throwIfAborted(context.signal)
    return addCanvasNodeFromAgent(command.input)
  }),
  defineHostCommand('add_asset_to_canvas', addAssetToCanvasCommandSchema, ['canvas', 'assets'], async (command, context) => {
    throwIfAborted(context.signal)
    return await addAssetToCanvasFromAgent(command.input)
  }),
  defineHostCommand('duplicate_canvas_node', duplicateCanvasNodeCommandSchema, ['canvas'], async (command, context) => {
    throwIfAborted(context.signal)
    return duplicateCanvasNodeFromAgent(command.input)
  }),
  defineHostCommand('update_canvas_node', updateCanvasNodeCommandSchema, ['canvas'], async (command, context) => {
    throwIfAborted(context.signal)
    return updateCanvasNodeFromAgent(command.input)
  }),
  defineHostCommand('delete_canvas_nodes', deleteCanvasNodesCommandSchema, ['canvas'], async (command, context) => {
    throwIfAborted(context.signal)
    return deleteCanvasNodesFromAgent(command.input.projectId, command.input.nodeIds)
  }),
  defineHostCommand('select_canvas_node', selectCanvasNodeCommandSchema, ['canvas'], async (command, context) => {
    throwIfAborted(context.signal)
    return selectCanvasNodeFromAgent(command.input.projectId, command.input.nodeId)
  }),
  defineHostCommand('group_canvas_nodes', groupCanvasNodesCommandSchema, ['canvas'], async (command, context) => {
    throwIfAborted(context.signal)
    return groupCanvasNodesFromAgent(command.input.projectId, command.input.nodeIds)
  }),
  defineHostCommand('connect_canvas_nodes', connectCanvasNodesCommandSchema, ['canvas'], async (command, context) => {
    throwIfAborted(context.signal)
    return connectCanvasNodesFromAgent(command.input)
  }),
  defineHostCommand('disconnect_canvas_edge', disconnectCanvasEdgeCommandSchema, ['canvas'], async (command, context) => {
    throwIfAborted(context.signal)
    return disconnectCanvasEdgeFromAgent(command.input.projectId, command.input.edgeId)
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
  defineHostCommand('commit_canvas_batch', commitCanvasBatchCommandSchema, ['canvas'], async (command, context) => {
    throwIfAborted(context.signal)
    return await commitCanvasBatchFromAgent(command.input.planRef)
  }),
  defineHostCommand('select_toolbox_tool', selectToolboxToolCommandSchema, ['toolbox'], async (command, context) => {
    throwIfAborted(context.signal)
    selectToolboxTool(command.input.toolId)
    return { toolId: command.input.toolId }
  }),
  defineHostCommand('create_camera_stage_project', createCameraStageProjectCommandSchema, ['toolbox'], async (command, context) => {
    throwIfAborted(context.signal)
    return await createCameraStageProjectFromAgent(command.input.name, command.input.mode)
  }),
  defineHostCommand('open_camera_stage_project', openCameraStageProjectCommandSchema, ['toolbox'], async (command, context) => {
    throwIfAborted(context.signal)
    selectToolboxTool('cameraStage')
    return await openCameraStageProjectFromAgent(command.input.projectId)
  }),
  defineHostCommand('rename_camera_stage_project', renameCameraStageProjectCommandSchema, ['toolbox'], async (command, context) => {
    throwIfAborted(context.signal)
    return await renameCameraStageProjectFromAgent(command.input.projectId, command.input.name)
  }),
  defineHostCommand('delete_camera_stage_project', deleteCameraStageProjectCommandSchema, ['toolbox'], async (command, context) => {
    throwIfAborted(context.signal)
    return await deleteCameraStageProjectFromAgent(command.input.projectId)
  }),
  defineHostCommand('add_camera_stage_object', addCameraStageObjectCommandSchema, ['toolbox'], async (command, context) => {
    throwIfAborted(context.signal)
    return await addCameraStageObjectFromAgent(command.input)
  }),
  defineHostCommand('duplicate_camera_stage_object', duplicateCameraStageObjectCommandSchema, ['toolbox'], async (command, context) => {
    throwIfAborted(context.signal)
    return await duplicateCameraStageObjectFromAgent(command.input)
  }),
  defineHostCommand('delete_camera_stage_object', deleteCameraStageObjectCommandSchema, ['toolbox'], async (command, context) => {
    throwIfAborted(context.signal)
    return await deleteCameraStageObjectFromAgent(command.input)
  }),
  defineHostCommand('update_camera_stage_object', updateCameraStageObjectCommandSchema, ['toolbox'], async (command, context) => {
    throwIfAborted(context.signal)
    return await updateCameraStageObjectFromAgent(command.input)
  }),
  defineHostCommand('add_camera_stage_shot', addCameraStageShotCommandSchema, ['toolbox'], async (command, context) => {
    throwIfAborted(context.signal)
    return await addCameraStageShotFromAgent(command.input)
  }),
  defineHostCommand('update_camera_stage_shot', updateCameraStageShotCommandSchema, ['toolbox'], async (command, context) => {
    throwIfAborted(context.signal)
    return await updateCameraStageShotFromAgent(command.input)
  }),
  defineHostCommand('create_image_edit_preview', createImageEditPreviewCommandSchema, ['toolbox', 'assets'], async (command, context) => {
    throwIfAborted(context.signal)
    return await createImageEditPreviewFromAgent(command.input.assetId, command.input.operations)
  }),
  defineHostCommand('commit_image_edit', commitImageEditCommandSchema, ['toolbox', 'assets'], async (command, context) => {
    throwIfAborted(context.signal)
    return await commitImageEditFromAgent(command.input.previewRef, command.input.displayName)
  }),
  defineHostCommand('select_asset', selectAssetCommandSchema, ['assets'], async (command, context) => {
    throwIfAborted(context.signal)
    const result = await import('@/features/assistant/hostActions').then(({ selectAssetFromAgent }) => selectAssetFromAgent(command.input.assetId))
    return result
  }),
  defineHostCommand('set_asset_tags', setAssetTagsCommandSchema, ['assets'], async (command, context) => {
    throwIfAborted(context.signal)
    return await setAssetTagsFromAgent(command.input.assetId, command.input.tags)
  }),
  defineHostCommand('add_asset_to_library', addAssetToLibraryCommandSchema, ['assets'], async (command, context) => {
    throwIfAborted(context.signal)
    return await addAssetToLibraryFromAgent(command.input.libraryId, command.input.assetId)
  }),
  defineHostCommand('remove_asset_from_library', removeAssetFromLibraryCommandSchema, ['assets'], async (command, context) => {
    throwIfAborted(context.signal)
    return await removeAssetFromLibraryFromAgent(command.input.libraryId, command.input.assetId)
  }),
  defineHostCommand('delete_asset', deleteAssetCommandSchema, ['assets'], async (command, context) => {
    throwIfAborted(context.signal)
    return await deleteAssetFromAgent(command.input.assetId)
  }),
  defineHostCommand(
    'create_visible_generation_task',
    createVisibleGenerationTaskCommandSchema,
    ['generation'],
    async (command, context) => {
      throwIfAborted(context.signal)
      const preparation = prepareGenerationTask(command.input)
      const taskId = await runVisibleGenerationTaskCommand({
        input: command.input.prompt,
        model: command.input.modelId,
        type: command.input.mediaType,
        options: preparation.options as DynamicValue,
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
    if (error instanceof GenerationPreparationError) {
      return {
        ok: false,
        error: {
          code: error.code === 'MODEL_NOT_FOUND' ? 'NOT_FOUND' : 'INVALID_INPUT',
          message: error.message,
          recoverable: true,
          details: error.details,
        },
      }
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
