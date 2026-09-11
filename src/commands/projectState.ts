import {
  deleteStoryboardProjectRecord,
  getStoryboardProjectRecord,
  listStoryboardProjectSummaries,
  renameStoryboardProjectRecord,
  updateStoryboardProjectViewportRecord,
  upsertStoryboardProjectRecord,
} from '@/commands/storyboardProjects';

import type { ApplicationPersistenceCorrelation } from '@/core/application-control/persistenceCorrelation';

export interface ProjectSummaryRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  nodeCount: number;
  coverPath: string | null;
}

export interface ProjectRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  nodeCount: number;
  nodesJson: string;
  edgesJson: string;
  viewportJson: string;
  historyJson: string;
}

function normalizeTimestamp(value: number | string | null | undefined): number {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }
  return Date.now();
}

export async function listProjectSummaries(): Promise<ProjectSummaryRecord[]> {
  return await listStoryboardProjectSummaries();
}

export async function getProjectRecord(projectId: string): Promise<ProjectRecord | null> {
  return await getStoryboardProjectRecord(projectId);
}

export async function upsertProjectRecord(record: ProjectRecord, operationCorrelation?: ApplicationPersistenceCorrelation): Promise<void> {
  await upsertStoryboardProjectRecord({
    ...record,
    ...(operationCorrelation ? { operationCorrelation } : {}),
    createdAt: normalizeTimestamp(record.createdAt),
    updatedAt: normalizeTimestamp(record.updatedAt),
    nodeCount: Math.max(0, Number(record.nodeCount || 0)),
  });
}

export async function updateProjectViewportRecord(
  projectId: string,
  viewportJson: string
): Promise<void> {
  await updateStoryboardProjectViewportRecord(projectId, viewportJson);
}

export async function renameProjectRecord(
  projectId: string,
  name: string,
  updatedAt: number,
  operationCorrelation?: ApplicationPersistenceCorrelation,
): Promise<void> {
  await renameStoryboardProjectRecord(projectId, name, normalizeTimestamp(updatedAt), operationCorrelation);
}

export async function deleteProjectRecord(projectId: string, operationCorrelation?: ApplicationPersistenceCorrelation): Promise<void> {
  await deleteStoryboardProjectRecord(projectId, operationCorrelation);
}
