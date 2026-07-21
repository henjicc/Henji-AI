import {
  deleteStoryboardProject,
  getStoryboardProject,
  listStoryboardProjectSummaries,
  renameStoryboardProject,
  updateStoryboardProjectViewport,
  upsertStoryboardProject,
  type StoryboardProjectRecordDto,
  type StoryboardProjectSummaryDto,
} from '../services/storyboard-projects'
import { parseRecord, parseStringField, parseVoid, registerIpcHandler } from './registry'

interface ProjectIdPayload {
  projectId: string
}

interface ViewportPayload extends ProjectIdPayload {
  viewportJson: string
}

interface RenamePayload extends ProjectIdPayload {
  name: string
  updatedAt: number
}

function parseProjectRecord(input: unknown): StoryboardProjectRecordDto {
  const record = parseRecord(input)
  const id = record.id
  const name = record.name
  const createdAt = Number(record.createdAt)
  const updatedAt = Number(record.updatedAt)
  const nodeCount = Number(record.nodeCount)
  const nodesJson = record.nodesJson
  const edgesJson = record.edgesJson
  const viewportJson = record.viewportJson
  const historyJson = record.historyJson

  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('Expected non-empty storyboard project id')
  }
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('Expected non-empty storyboard project name')
  }
  if (typeof nodesJson !== 'string') {
    throw new Error('Expected storyboard project nodesJson string')
  }
  if (typeof edgesJson !== 'string') {
    throw new Error('Expected storyboard project edgesJson string')
  }
  if (typeof viewportJson !== 'string') {
    throw new Error('Expected storyboard project viewportJson string')
  }
  if (typeof historyJson !== 'string') {
    throw new Error('Expected storyboard project historyJson string')
  }

  return {
    id,
    name: name.trim(),
    createdAt,
    updatedAt,
    nodeCount,
    nodesJson,
    edgesJson,
    viewportJson,
    historyJson,
  }
}

function parseProjectIdPayload(input: unknown): ProjectIdPayload {
  return { projectId: parseStringField(input, 'projectId') }
}

function parseViewportPayload(input: unknown): ViewportPayload {
  const record = parseRecord(input)
  const projectId = record.projectId
  const viewportJson = record.viewportJson
  if (typeof projectId !== 'string' || projectId.length === 0) {
    throw new Error('Expected non-empty projectId')
  }
  if (typeof viewportJson !== 'string') {
    throw new Error('Expected viewportJson string')
  }
  return { projectId, viewportJson }
}

function parseRenamePayload(input: unknown): RenamePayload {
  const record = parseRecord(input)
  const projectId = record.projectId
  const name = record.name
  const updatedAt = Number(record.updatedAt)
  if (typeof projectId !== 'string' || projectId.length === 0) {
    throw new Error('Expected non-empty projectId')
  }
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('Expected non-empty project name')
  }
  return { projectId, name: name.trim(), updatedAt }
}

export function registerStoryboardProjectsIpc(): void {
  registerIpcHandler<void, StoryboardProjectSummaryDto[]>('storyboardProjects:list', parseVoid, () => listStoryboardProjectSummaries())
  registerIpcHandler<ProjectIdPayload, StoryboardProjectRecordDto | null>('storyboardProjects:get', parseProjectIdPayload, ({ projectId }) => {
    return getStoryboardProject(projectId)
  })
  registerIpcHandler<StoryboardProjectRecordDto, void>('storyboardProjects:upsert', parseProjectRecord, (record) => {
    upsertStoryboardProject(record)
  })
  registerIpcHandler<ViewportPayload, void>('storyboardProjects:updateViewport', parseViewportPayload, ({ projectId, viewportJson }) => {
    updateStoryboardProjectViewport(projectId, viewportJson)
  })
  registerIpcHandler<RenamePayload, void>('storyboardProjects:rename', parseRenamePayload, ({ projectId, name, updatedAt }) => {
    renameStoryboardProject(projectId, name, updatedAt)
  })
  registerIpcHandler<ProjectIdPayload, void>('storyboardProjects:delete', parseProjectIdPayload, ({ projectId }) => {
    deleteStoryboardProject(projectId)
  })
}
