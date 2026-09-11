import { createLogger } from '@/core/logging'
import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { Viewport } from '@xyflow/react';
import {
  useCanvasStore,
  type CanvasEdge,
  type CanvasHistoryState,
  type CanvasNode,
} from './canvasStore';
import {

  deleteProjectRecord,
  getProjectRecord,
  listProjectSummaries,
  renameProjectRecord,
  updateProjectViewportRecord,
  upsertProjectRecord,
} from '@/commands/projectState';
import { createProjectPersistenceQueue } from './projectPersistenceQueue';
import type { ApplicationPersistenceCorrelation } from '@/core/application-control/persistenceCorrelation';

import { fromProjectRecord, toProjectRecord, toProjectSummary, type Project, type ProjectSummary } from './projectStoreSerialization';
export { decodeProjectRecord, encodeProjectAsRecord } from './projectStoreSerialization';
export type { Project, ProjectSummary } from './projectStoreSerialization';

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

let openProjectRequestSeq = 0;
/** 让打开状态先完成一帧呈现，再开始解码和挂载；后台窗口不依赖可能暂停的 RAF。 */
function yieldForProjectLoadingPaint(): Promise<void> {
  if (typeof document === 'undefined' || document.visibilityState !== 'visible'
    || typeof requestAnimationFrame === 'undefined') return Promise.resolve();
  return new Promise((resolve) => {
    let afterFrame: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      clearTimeout(fallback);
      clearTimeout(afterFrame);
      cancelAnimationFrame(frame);
      resolve();
    };
    const fallback = setTimeout(finish, 100);
    const frame = requestAnimationFrame(() => { afterFrame = setTimeout(finish, 0); });
  });
}

const VIEWPORT_EPSILON = 0.001;

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

let reportBackgroundPersistenceError: (operation: 'save' | 'viewport', error: unknown, projectId: string) => void = (
  operation,
  error
) => {
  logger.error(`Failed to persist project ${operation}`, error)
}

const persistenceQueue = createProjectPersistenceQueue<Project, ApplicationPersistenceCorrelation>({
  getProjectId: (project) => project.id,
  upsertProject: async (project, correlation) => {
    await upsertProjectRecord(toProjectRecord(project), correlation)
    setProjectPersistenceError(project.id, null)
  },
  updateViewport: updateProjectViewportRecord,
  deleteProject: deleteProjectRecord,
  onBackgroundError: (operation, error, projectId) => reportBackgroundPersistenceError(operation, error, projectId),
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
  openError: string | null;
  persistenceError: string | null;
  persistenceErrors: Record<string, string>;

  hydrate: () => Promise<void>;
  createProject: (name: string, context?: { operationId?: string }) => Promise<string>;
  deleteProject: (id: string, context?: { operationId?: string }) => Promise<void>;
  renameProject: (id: string, name: string, context?: { operationId?: string }) => Promise<void>;
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
  openError: null,
  persistenceError: null,
  persistenceErrors: {},

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

  createProject: async (name, context) => {
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
      await persistenceQueue.flushProject(project, context?.operationId ? { operationId: context.operationId,
        boundaryId: uuidv4(), targets: [{ kind: 'canvas.project', id }] } : undefined)
    } catch (error) {
      logger.error('Failed to create project record', error)
      setProjectPersistenceError(id, 'project.persistenceFailed')
      throw error
    }
    set((state) => ({
      projects: [{ ...project }, ...state.projects],
      currentProjectId: id,
      currentProject: project,
      isOpeningProject: false,
      persistenceError: null,
      openError: null,
    }));
    return id;
  },

  deleteProject: async (id, context) => {
    try {
      await persistenceQueue.deleteProject(id, context?.operationId ? { operationId: context.operationId,
        boundaryId: uuidv4(), targets: [{ kind: 'canvas.project', id }] } : undefined)
    } catch (error) {
      logger.error('Failed to delete project record', error)
      setProjectPersistenceError(id, 'project.persistenceFailed')
      throw error
    }
    setProjectPersistenceError(id, null)
    set((state) => ({
      projects: state.projects.filter((project) => project.id !== id),
      currentProjectId: state.currentProjectId === id ? null : state.currentProjectId,
      currentProject: state.currentProject?.id === id ? null : state.currentProject,
      isOpeningProject: false,
      persistenceError: state.currentProjectId === id ? null : state.persistenceError,
    }));
  },

  renameProject: async (id, name, context) => {
    const now = Date.now();
    const currentProject = get().currentProject
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
      const correlation = context?.operationId ? { operationId: context.operationId,
        boundaryId: uuidv4(), targets: [{ kind: 'canvas.project', id }] } : undefined
      if (nextCurrentProject) await persistenceQueue.flushProject(nextCurrentProject, correlation)
      else await renameProjectRecord(id, name, now, correlation)
    } catch (error) {
      logger.error('Failed to rename project record', error)
      setProjectPersistenceError(id, 'project.persistenceFailed')
      throw error
    }
    setProjectPersistenceError(id, null)
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
    set({ isOpeningProject: true, openError: null });
    logger.debug('开始打开工程', { event: 'project.open.start', context: { projectId: id } });

    void (async () => {
      try {
        await yieldForProjectLoadingPaint();
        if (reqSeq !== openProjectRequestSeq) return;
        const unsaved = persistenceQueue.getUnsavedProject(id);
        const record = unsaved ? null : await getProjectRecord(id);
        if (reqSeq !== openProjectRequestSeq) {
          return;
        }
        if (!record && !unsaved) {
          logger.warn('工程记录不存在', { event: 'project.open.failed', context: { projectId: id } });
          set({ isOpeningProject: false, openError: 'project.openFailed' });
          return;
        }

        const project = unsaved ?? fromProjectRecord(record!);
        set((state) => ({
          currentProjectId: id,
          currentProject: project,
          isOpeningProject: false,
          persistenceError: state.persistenceErrors[id] ?? null,
          projects: updateProjectSummary(state.projects, {
            id: project.id,
            name: project.name,
            createdAt: project.createdAt,
            updatedAt: project.updatedAt,
            nodeCount: project.nodeCount,
            coverPath: project.coverPath,
          }),
        }));
        logger.debug('完成打开工程', { event: 'project.open.completed', context: { projectId: id } });
      } catch (error) {
        if (reqSeq !== openProjectRequestSeq) {
          return;
        }
        logger.error('工程无法打开，保留当前工程与原始记录', error, {
          event: 'project.open.failed', context: { projectId: id },
        });
        set({ isOpeningProject: false, openError: 'project.openFailed' });
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
        setProjectPersistenceError(currentProjectId, 'project.persistenceFailed')
        throw error
      }
      setProjectPersistenceError(currentProjectId, null)
    }

    set((state) => ({
      projects: persistedSummary
        ? updateProjectSummary(state.projects, persistedSummary)
        : state.projects,
      currentProjectId: null,
      currentProject: null,
      isOpeningProject: false,
      persistenceError: null,
      openError: null,
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

reportBackgroundPersistenceError = (operation, error, projectId) => {
  logger.error(`Failed to persist project ${operation}`, error, { projectId })
  setProjectPersistenceError(projectId, 'project.persistenceFailed')
}

function setProjectPersistenceError(projectId: string, error: string | null): void {
  useProjectStore.setState((state) => {
    const persistenceErrors = { ...state.persistenceErrors }
    if (error) persistenceErrors[projectId] = error
    else delete persistenceErrors[projectId]
    return { persistenceErrors, persistenceError: state.currentProjectId === projectId
      ? error : state.persistenceError }
  })
}

/** 捕获当前项目快照后等待真实存储；重试不依赖 hasChanged，也不重放业务动作。 */
export function hasUnconfirmedCanvasProjectSnapshot(projectId: string): boolean {
  return persistenceQueue.getUnsavedProject(projectId) !== undefined
}

export async function flushCanvasProjectSnapshot(projectId: string, correlation?: ApplicationPersistenceCorrelation): Promise<void> {
  const project = useProjectStore.getState().currentProject
  if (!project || project.id !== projectId) throw new Error('当前画布项目已切换，请返回原项目后重试保存')
  try {
    await persistenceQueue.flushProject(project, correlation)
    setProjectPersistenceError(projectId, null)
  } catch (error) {
    setProjectPersistenceError(projectId, 'project.persistenceFailed')
    throw error
  }
}

/** 仅阻挡存储 writer，不阻塞 UI；调用方释放前必须入队最终提交或恢复快照。 */
export function pauseCanvasProjectPersistence(projectId: string): () => void {
  return persistenceQueue.pauseProject(projectId)
}
