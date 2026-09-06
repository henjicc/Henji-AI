import type { Viewport } from '@xyflow/react';
import { createLogger } from '@/core/logging';
import { mapCanvasNodeMediaReferences } from '@/features/canvas/application/canvasNodeMediaReferences';
import { resetTransientNodeRuntimeState } from '@/features/canvas/domain/nodeMigrations';
import type { CanvasNode, CanvasEdge, CanvasHistoryState, CanvasNodeData } from './canvasStore';
import type { ProjectRecord, ProjectSummaryRecord } from '@/commands/projectState';
const logger = createLogger('stores.projectStore');
const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };
function createEmptyHistory(): CanvasHistoryState { return { past: [], future: [] }; }

const IMAGE_REF_PREFIX = '__img_ref__:';
const MAX_PERSISTED_HISTORY_STEPS = 12;
const MAX_HISTORY_RESTORE_JSON_CHARS = 1_500_000;

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

  const index = Number.parseInt(imageUrl.slice(IMAGE_REF_PREFIX.length), 10);
  if (!Number.isFinite(index) || index < 0) {
    return imageUrl;
  }

  return imagePool[index] ?? null;
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
  const imagePool: string[] = [];
  const imageIndexMap = new Map<string, number>();
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

function safeParseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function extractImagePoolFromHistoryJson(historyJson: string): string[] {
  const imagePoolKey = '"imagePool"';
  const keyIndex = historyJson.indexOf(imagePoolKey);
  if (keyIndex < 0) {
    return [];
  }

  const arrayStart = historyJson.indexOf('[', keyIndex + imagePoolKey.length);
  if (arrayStart < 0) {
    return [];
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  let arrayEnd = -1;

  for (let index = arrayStart; index < historyJson.length; index += 1) {
    const char = historyJson[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '[') {
      depth += 1;
      continue;
    }

    if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        arrayEnd = index;
        break;
      }
    }
  }

  if (arrayEnd < 0) {
    return [];
  }

  const rawArrayJson = historyJson.slice(arrayStart, arrayEnd + 1);
  const parsed = safeParseJson<DynamicValue>(rawArrayJson, []);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter((item): item is string => typeof item === 'string');
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

  return {
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
}

export function fromProjectRecord(record: ProjectRecord): Project {
  const parsedNodes = safeParseJson<CanvasNode[]>(record.nodesJson, []);
  const parsedEdges = safeParseJson<CanvasEdge[]>(record.edgesJson, []);
  const parsedViewport = safeParseJson<Viewport>(record.viewportJson, DEFAULT_VIEWPORT);
  const shouldRestoreHistory = record.historyJson.length <= MAX_HISTORY_RESTORE_JSON_CHARS;
  const extractedImagePool = extractImagePoolFromHistoryJson(record.historyJson);
  const parsedHistoryPayload = shouldRestoreHistory
    ? safeParseJson<{
        past?: CanvasHistoryState['past'];
        future?: CanvasHistoryState['future'];
        imagePool?: string[];
      }>(record.historyJson, {})
    : {};

  if (!shouldRestoreHistory) {
    logger.warn(
      `Skip restoring oversized history payload (${record.historyJson.length} chars) for project ${record.id}`
    );
  }

  const parsedHistory = {
    past: parsedHistoryPayload.past ?? [],
    future: parsedHistoryPayload.future ?? [],
  };

  const persistedProject: PersistedProject = {
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    nodeCount: record.nodeCount,
    coverPath: (record as { coverPath?: string | null }).coverPath ?? null,
    nodes: parsedNodes,
    edges: parsedEdges,
    viewport: parsedViewport ?? DEFAULT_VIEWPORT,
    history: parsedHistory,
    imagePool: parsedHistoryPayload.imagePool ?? extractedImagePool,
  };

  const decodedProject = decodeProject(persistedProject);
  return {
    ...decodedProject,
    nodeCount: parsedNodes.length,
    viewport: decodedProject.viewport ?? DEFAULT_VIEWPORT,
    history: decodedProject.history ?? createEmptyHistory(),
  };
}

/** 解码项目记录为运行时 Project（供项目包导出等服务使用） */
export function decodeProjectRecord(record: ProjectRecord): Project {
  return fromProjectRecord(record);
}

/** 编码运行时 Project 为持久化记录（供项目包导入等服务使用） */
export function encodeProjectAsRecord(project: Project): ProjectRecord {
  return toProjectRecord(project);
}
