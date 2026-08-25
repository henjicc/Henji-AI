import { createLogger } from '@/core/logging'
import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { Viewport } from '@xyflow/react';
import { mapCanvasNodeMediaReferences } from '@/features/canvas/application/canvasNodeMediaReferences';
import { resetTransientNodeRuntimeState } from '@/features/canvas/domain/nodeMigrations';
import {
  useCanvasStore,
  type CanvasEdge,
  type CanvasHistoryState,
  type CanvasNode,
  type CanvasNodeData,
} from './canvasStore';
import {

  deleteProjectRecord,
  getProjectRecord,
  listProjectSummaries,
  renameProjectRecord,
  updateProjectViewportRecord,
  upsertProjectRecord,
  type ProjectRecord,
  type ProjectSummaryRecord,
} from '@/commands/projectState';
import { createProjectPersistenceQueue } from './projectPersistenceQueue';

const logger = createLogger('stores.projectStore')

const DEFAULT_VIEWPORT: Viewport = {
  x: 0,
  y: 0,
  zoom: 1,
};

function createEmptyHistory(): CanvasHistoryState {
  return {
    past: [],
    future: [],
  };
}

const IMAGE_REF_PREFIX = '__img_ref__:';
let openProjectRequestSeq = 0;
const VIEWPORT_EPSILON = 0.001;
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

function toProjectSummary(record: ProjectSummaryRecord): ProjectSummary {
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

function toProjectRecord(project: Project): ProjectRecord {
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

function fromProjectRecord(record: ProjectRecord): Project {
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

function hasViewportMeaningfulDelta(current: Viewport, next: Viewport): boolean {
  return (
    Math.abs(current.x - next.x) > VIEWPORT_EPSILON ||
    Math.abs(current.y - next.y) > VIEWPORT_EPSILON ||
    Math.abs(current.zoom - next.zoom) > VIEWPORT_EPSILON
  );
}

function normalizeViewport(viewport: Viewport): Viewport {
  return {
    x: Number(viewport.x.toFixed(2)),
    y: Number(viewport.y.toFixed(2)),
    zoom: Number(viewport.zoom.toFixed(4)),
  };
}

let reportBackgroundPersistenceError: (operation: 'save' | 'viewport', error: unknown) => void = (
  operation,
  error
) => {
  logger.error(`Failed to persist project ${operation}`, error)
}

const persistenceQueue = createProjectPersistenceQueue<Project>({
  getProjectId: (project) => project.id,
  upsertProject: async (project) => { await upsertProjectRecord(toProjectRecord(project)) },
  updateViewport: updateProjectViewportRecord,
  deleteProject: deleteProjectRecord,
  onBackgroundError: (operation, error) => reportBackgroundPersistenceError(operation, error),
})

function updateProjectSummary(
  summaries: ProjectSummary[],
  updated: ProjectSummary
): ProjectSummary[] {
  const next = summaries.map((summary) => (summary.id === updated.id ? updated : summary));
  next.sort((a, b) => b.updatedAt - a.updatedAt);
  return next;
}

interface ProjectState {
  projects: ProjectSummary[];
  currentProjectId: string | null;
  currentProject: Project | null;
  isHydrated: boolean;
  isOpeningProject: boolean;
  persistenceError: string | null;

  hydrate: () => Promise<void>;
  createProject: (name: string) => Promise<string>;
  deleteProject: (id: string) => Promise<void>;
  renameProject: (id: string, name: string) => Promise<void>;
  setProjectCover: (id: string, coverPath: string | null) => void;
  openProject: (id: string) => void;
  closeProject: () => Promise<void>;
  clearPersistenceError: () => void;
  getCurrentProject: () => Project | null;
  saveCurrentProject: (
    nodes: CanvasNode[],
    edges: CanvasEdge[],
    viewport?: Viewport,
    history?: CanvasHistoryState
  ) => void;
  saveCurrentProjectViewport: (viewport: Viewport) => void;
  cancelPendingViewportPersist: () => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  currentProjectId: null,
  currentProject: null,
  isHydrated: false,
  isOpeningProject: false,
  persistenceError: null,

  hydrate: async () => {
    if (get().isHydrated) {
      return;
    }

    try {
      const records = await listProjectSummaries();
      const projects = records.map(toProjectSummary).sort((a, b) => b.updatedAt - a.updatedAt);
      set({
        projects,
        currentProjectId: null,
        currentProject: null,
        isHydrated: true,
      });
    } catch (error) {
      logger.error('Failed to hydrate project summaries from SQLite', error);
      set({
        projects: [],
        currentProjectId: null,
        currentProject: null,
        isHydrated: true,
      });
    }
  },

  createProject: async (name) => {
    const id = uuidv4();
    const now = Date.now();
    const project: Project = {
      id,
      name,
      createdAt: now,
      updatedAt: now,
      nodeCount: 0,
      coverPath: null,
      nodes: [],
      edges: [],
      viewport: DEFAULT_VIEWPORT,
      history: createEmptyHistory(),
    };

    try {
      await persistenceQueue.flushProject(project)
    } catch (error) {
      logger.error('Failed to create project record', error)
      set({ persistenceError: 'project.persistenceFailed' })
      throw error
    }
    set((state) => ({
      projects: [{ ...project }, ...state.projects],
      currentProjectId: id,
      currentProject: project,
      isOpeningProject: false,
      persistenceError: null,
    }));
    return id;
  },

  deleteProject: async (id) => {
    try {
      await persistenceQueue.deleteProject(id)
    } catch (error) {
      logger.error('Failed to delete project record', error)
      set({ persistenceError: 'project.persistenceFailed' })
      throw error
    }
    set((state) => ({
      projects: state.projects.filter((project) => project.id !== id),
      currentProjectId: state.currentProjectId === id ? null : state.currentProjectId,
      currentProject: state.currentProject?.id === id ? null : state.currentProject,
      isOpeningProject: false,
      persistenceError: null,
    }));
  },

  renameProject: async (id, name) => {
    const now = Date.now();
    const currentProject = get().currentProject
    const previousSummary = get().projects.find((project) => project.id === id)
    const nextCurrentProject = currentProject?.id === id
      ? { ...currentProject, name, updatedAt: now }
      : null

    set((state) => ({
      projects: state.projects.map((summary) => summary.id === id
        ? { ...summary, name, updatedAt: now }
        : summary).sort((a, b) => b.updatedAt - a.updatedAt),
      currentProject: state.currentProject?.id === id
        ? { ...state.currentProject, name, updatedAt: now }
        : state.currentProject,
    }))

    try {
      if (nextCurrentProject) await persistenceQueue.flushProject(nextCurrentProject)
      else await renameProjectRecord(id, name, now)
    } catch (error) {
      logger.error('Failed to rename project record', error)
      set((state) => ({
        projects: previousSummary
          ? updateProjectSummary(state.projects, previousSummary)
          : state.projects,
        currentProject: state.currentProject?.id === id && currentProject
          ? { ...state.currentProject, name: currentProject.name, updatedAt: currentProject.updatedAt }
          : state.currentProject,
        persistenceError: 'project.persistenceFailed',
      }))
      throw error
    }
    set({ persistenceError: null })
  },

  setProjectCover: (id, coverPath) => {
    set((state) => ({
      projects: state.projects.map((summary) => (
        summary.id === id ? { ...summary, coverPath } : summary
      )),
      currentProject: state.currentProject?.id === id
        ? { ...state.currentProject, coverPath }
        : state.currentProject,
    }));
  },

  openProject: (id) => {
    const reqSeq = ++openProjectRequestSeq;
    set({ isOpeningProject: true });

    void (async () => {
      try {
        const record = await getProjectRecord(id);
        if (reqSeq !== openProjectRequestSeq) {
          return;
        }
        if (!record) {
          set({ isOpeningProject: false });
          return;
        }

        const project = fromProjectRecord(record);
        set((state) => ({
          currentProjectId: id,
          currentProject: project,
          isOpeningProject: false,
          projects: updateProjectSummary(state.projects, {
            id: project.id,
            name: project.name,
            createdAt: project.createdAt,
            updatedAt: project.updatedAt,
            nodeCount: project.nodeCount,
            coverPath: project.coverPath,
          }),
        }));
      } catch (error) {
        if (reqSeq !== openProjectRequestSeq) {
          return;
        }
        logger.error('Failed to open project', error);
        set({ isOpeningProject: false });
      }
    })();
  },

  closeProject: async () => {
    openProjectRequestSeq += 1;
    const { currentProjectId, currentProject } = get();
    let persistedSummary: ProjectSummary | null = null;

    if (currentProjectId && currentProject && currentProject.id === currentProjectId) {
      const canvasState = useCanvasStore.getState();
      const nextProject: Project = {
        ...currentProject,
        nodes: canvasState.nodes,
        edges: canvasState.edges,
        viewport: canvasState.currentViewport ?? currentProject.viewport ?? DEFAULT_VIEWPORT,
        history: canvasState.history ?? currentProject.history ?? createEmptyHistory(),
        nodeCount: canvasState.nodes.length,
        updatedAt: Date.now(),
      };

      persistedSummary = {
        id: nextProject.id,
        name: nextProject.name,
        createdAt: nextProject.createdAt,
        updatedAt: nextProject.updatedAt,
        nodeCount: nextProject.nodeCount,
        coverPath: nextProject.coverPath,
      };
      try {
        await persistenceQueue.flushProject(nextProject)
      } catch (error) {
        logger.error('Failed to persist project before closing', error)
        set({ persistenceError: 'project.persistenceFailed' })
        throw error
      }
    }

    set((state) => ({
      projects: persistedSummary
        ? updateProjectSummary(state.projects, persistedSummary)
        : state.projects,
      currentProjectId: null,
      currentProject: null,
      isOpeningProject: false,
      persistenceError: null,
    }));
  },

  clearPersistenceError: () => set({ persistenceError: null }),

  getCurrentProject: () => {
    const { currentProjectId, currentProject } = get();
    if (!currentProjectId || !currentProject) {
      return null;
    }
    if (currentProject.id !== currentProjectId) {
      return null;
    }
    return currentProject;
  },

  saveCurrentProject: (nodes, edges, viewport, history) => {
    const { currentProjectId, currentProject } = get();
    if (!currentProjectId || !currentProject || currentProject.id !== currentProjectId) {
      return;
    }

    const nextViewport = viewport ?? currentProject.viewport ?? DEFAULT_VIEWPORT;
    const nextHistory = history ?? currentProject.history ?? createEmptyHistory();
    const nextNodeCount = nodes.length;

    const hasViewportChanged =
      currentProject.viewport.x !== nextViewport.x ||
      currentProject.viewport.y !== nextViewport.y ||
      currentProject.viewport.zoom !== nextViewport.zoom;
    const hasChanged =
      currentProject.nodes !== nodes ||
      currentProject.edges !== edges ||
      currentProject.history !== nextHistory ||
      currentProject.nodeCount !== nextNodeCount ||
      hasViewportChanged;
    if (!hasChanged) {
      return;
    }

    const nextProject: Project = {
      ...currentProject,
      nodes,
      edges,
      viewport: nextViewport,
      history: nextHistory,
      nodeCount: nextNodeCount,
      updatedAt: Date.now(),
    };

    set((state) => ({
      currentProject: nextProject,
      projects: updateProjectSummary(state.projects, {
        id: nextProject.id,
        name: nextProject.name,
        createdAt: nextProject.createdAt,
        updatedAt: nextProject.updatedAt,
        nodeCount: nextProject.nodeCount,
        coverPath: nextProject.coverPath,
      }),
    }));
    persistenceQueue.clearViewport(nextProject.id)
    persistenceQueue.queueProject(nextProject);
  },

  saveCurrentProjectViewport: (viewport) => {
    const { currentProjectId, currentProject } = get();
    if (!currentProjectId || !currentProject || currentProject.id !== currentProjectId) {
      return;
    }

    const nextViewport = normalizeViewport(viewport);
    const hasChanged = hasViewportMeaningfulDelta(currentProject.viewport, nextViewport);
    if (!hasChanged) {
      return;
    }

    const nextProject: Project = {
      ...currentProject,
      viewport: nextViewport,
    };

    set({ currentProject: nextProject });
    persistenceQueue.queueViewport(currentProjectId, JSON.stringify(nextViewport));
  },

  cancelPendingViewportPersist: () => {
    const currentProjectId = get().currentProjectId;
    if (!currentProjectId) {
      return;
    }
    persistenceQueue.clearViewport(currentProjectId);
  },
}));

reportBackgroundPersistenceError = (operation, error) => {
  logger.error(`Failed to persist project ${operation}`, error)
  useProjectStore.setState({ persistenceError: 'project.persistenceFailed' })
}
