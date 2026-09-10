import type { Viewport } from '@xyflow/react';
import { mapCanvasNodeMediaReferences, resolveCanvasNodeMediaSchema } from '@/features/canvas/application/canvasNodeMediaReferences';
import { resetTransientNodeRuntimeState } from '@/features/canvas/domain/nodeMigrations';
import type { CanvasNode, CanvasEdge, CanvasHistoryState, CanvasNodeData } from './canvasStore';
import type { ProjectRecord, ProjectSummaryRecord } from '@/commands/projectState';
import { parseCanvasProjectRecord, decodeCanvasProjectImageReference, PROJECT_IMAGE_REFERENCE_PREFIX } from '@/core/canvas/projectRecordCodec';

const IMAGE_REF_PREFIX = PROJECT_IMAGE_REFERENCE_PREFIX;
const MAX_PERSISTED_HISTORY_STEPS = 12;

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  nodeCount: number;
  /** 项目封面缩略图的本地路径；未生成过封面时为 null */
  coverPath: string | null;
}

export interface Project extends ProjectSummary {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport: Viewport;
  history: CanvasHistoryState;
  /** 保留缺失模型中无法识别的参数引用，原池索引不得重新编号。 */
  imagePool?: string[];
}

type PersistedProject = Project & {
  imagePool?: string[];
};

function encodeImageReference(
  imageUrl: string | null | undefined,
  imagePool: string[],
  imageIndexMap: Map<string, number>
): string | null | undefined {
  if (typeof imageUrl !== 'string' || imageUrl.length === 0) {
    return imageUrl;
  }

  const existingIndex = imageIndexMap.get(imageUrl);
  if (typeof existingIndex === 'number') {
    return `${IMAGE_REF_PREFIX}${existingIndex}`;
  }

  const nextIndex = imagePool.length;
  imagePool.push(imageUrl);
  imageIndexMap.set(imageUrl, nextIndex);
  return `${IMAGE_REF_PREFIX}${nextIndex}`;
}

function decodeImageReference(
  imageUrl: string | null | undefined,
  imagePool: string[] | undefined
): string | null | undefined {
  if (typeof imageUrl !== 'string' || !imagePool || !imageUrl.startsWith(IMAGE_REF_PREFIX)) {
    return imageUrl;
  }

  return decodeCanvasProjectImageReference(imageUrl, imagePool, 'nodesJson');
}

function mapNodeImageReferences(
  nodes: CanvasNode[],
  mapImageUrl: (imageUrl: string | null | undefined) => string | null | undefined
): CanvasNode[] {
  return nodes.map((node) => {
    const nextData = mapCanvasNodeMediaReferences(
      node.data as DynamicValueMap,
      (value) => mapImageUrl(value) ?? value,
    );

    return {
      ...node,
      data: nextData as CanvasNodeData,
    };
  });
}

function mapHistoryImageReferences(
  history: CanvasHistoryState,
  mapImageUrl: (imageUrl: string | null | undefined) => string | null | undefined
): CanvasHistoryState {
  return {
    past: history.past.map((snapshot) => ({
      ...snapshot,
      nodes: mapNodeImageReferences(snapshot.nodes, mapImageUrl),
    })),
    future: history.future.map((snapshot) => ({
      ...snapshot,
      nodes: mapNodeImageReferences(snapshot.nodes, mapImageUrl),
    })),
  };
}

function trimHistoryForPersistence(history: CanvasHistoryState): CanvasHistoryState {
  return {
    past: history.past.slice(-MAX_PERSISTED_HISTORY_STEPS),
    future: history.future.slice(-MAX_PERSISTED_HISTORY_STEPS),
  };
}

function encodeProject(project: Project): PersistedProject {
  const hasOpaqueParams = [project.nodes, ...project.history.past.map((snapshot) => snapshot.nodes),
    ...project.history.future.map((snapshot) => snapshot.nodes)].some((nodes) => nodes.some(({ data }) =>
      typeof data.modelId === 'string' && data.params !== undefined && !resolveCanvasNodeMediaSchema(data.modelId)));
  const imagePool: string[] = hasOpaqueParams ? [...(project.imagePool ?? [])] : [];
  const imageIndexMap = new Map(imagePool.map((value, index) => [value, index]));
  const encode = (imageUrl: string | null | undefined) =>
    encodeImageReference(imageUrl, imagePool, imageIndexMap);
  const resetRuntimeState = (nodes: CanvasNode[]): CanvasNode[] => nodes.map((node) => {
    const data = { ...(node.data as DynamicValueMap) };
    resetTransientNodeRuntimeState(node.type, data);
    return {
      ...node,
      data: data as CanvasNodeData,
    };
  });

  return {
    ...project,
    nodes: mapNodeImageReferences(resetRuntimeState(project.nodes), encode),
    history: mapHistoryImageReferences({
      past: project.history.past.map((snapshot) => ({
        ...snapshot,
        nodes: resetRuntimeState(snapshot.nodes),
      })),
      future: project.history.future.map((snapshot) => ({
        ...snapshot,
        nodes: resetRuntimeState(snapshot.nodes),
      })),
    }, encode),
    imagePool,
  };
}

function decodeProject(project: PersistedProject): Project {
  const decode = (imageUrl: string | null | undefined) =>
    decodeImageReference(imageUrl, project.imagePool);

  return {
    ...project,
    nodes: mapNodeImageReferences(project.nodes, decode),
    history: mapHistoryImageReferences(project.history, decode),
  };
}

export function toProjectSummary(record: ProjectSummaryRecord): ProjectSummary {
  return {
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    nodeCount: record.nodeCount,
    coverPath: record.coverPath ?? null,
  };
}

function assertNoPersistedBlobMedia(value: unknown, pathLabel = 'project'): void {
  if (typeof value === 'string') {
    if (value.startsWith('blob:')) {
      throw new Error(`Transient blob URL reached project persistence at ${pathLabel}`)
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoPersistedBlobMedia(item, `${pathLabel}[${index}]`))
    return
  }
  if (typeof value === 'object' && value !== null) {
    Object.entries(value).forEach(([key, item]) => assertNoPersistedBlobMedia(item, `${pathLabel}.${key}`))
  }
}

export function toProjectRecord(project: Project): ProjectRecord {
  const encodedProject = encodeProject(project);
  const persistedNodes = encodedProject.nodes;
  const persistedHistory = trimHistoryForPersistence(encodedProject.history);

  if (import.meta.env.DEV) {
    assertNoPersistedBlobMedia({
      nodes: persistedNodes,
      history: persistedHistory,
      imagePool: encodedProject.imagePool ?? [],
    });
  }

  const record: ProjectRecord = {
    id: encodedProject.id,
    name: encodedProject.name,
    createdAt: encodedProject.createdAt,
    updatedAt: encodedProject.updatedAt,
    nodeCount: encodedProject.nodeCount,
    nodesJson: JSON.stringify(persistedNodes),
    edgesJson: JSON.stringify(encodedProject.edges),
    viewportJson: JSON.stringify(encodedProject.viewport),
    historyJson: JSON.stringify({
      ...persistedHistory,
      imagePool: encodedProject.imagePool ?? [],
    }),
  };
  parseCanvasProjectRecord(record, resolveCanvasNodeMediaSchema);
  return record;
}

export function fromProjectRecord(record: ProjectRecord): Project {
  const parsed = parseCanvasProjectRecord(record, resolveCanvasNodeMediaSchema);
  return decodeProject({
    id: record.id, name: record.name, createdAt: record.createdAt, updatedAt: record.updatedAt,
    nodeCount: parsed.nodes.length,
    coverPath: (record as { coverPath?: string | null }).coverPath ?? null,
    nodes: parsed.nodes as CanvasNode[],
    edges: parsed.edges as CanvasEdge[],
    viewport: parsed.viewport,
    history: parsed.history as CanvasHistoryState,
    imagePool: parsed.imagePool,
  });
}

/** 解码项目记录为运行时 Project（供项目包导出等服务使用） */
export function decodeProjectRecord(record: ProjectRecord): Project {
  return fromProjectRecord(record);
}

/** 编码运行时 Project 为持久化记录（供项目包导入等服务使用） */
export function encodeProjectAsRecord(project: Project): ProjectRecord {
  return toProjectRecord(project);
}
