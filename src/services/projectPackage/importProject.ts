import { openDialog } from '@/platform/desktopApi';
import { v4 as uuidv4 } from 'uuid';
import type { Viewport } from '@xyflow/react';

import { createLogger } from '@/core/logging';
import { importProjectPackage } from '@/commands/projectPackage';
import { upsertProjectRecord } from '@/commands/projectState';
import { encodeProjectAsRecord, type Project } from '@/stores/projectStore';
import type { CanvasEdge, CanvasNode } from '@/features/canvas/domain/canvasNodes';
import { rewritePackagePathsToLocal } from './collectMediaRefs';
import { PROJECT_PACKAGE_EXTENSION, PROJECT_PACKAGE_FORMAT_VERSION } from './exportProject';

const logger = createLogger('services.projectPackage.importProject');

interface ProjectPackageManifest {
  formatVersion?: number;
  app?: string;
  project?: {
    name?: string;
    createdAt?: number;
  };
  nodes?: CanvasNode[];
  edges?: CanvasEdge[];
  viewport?: Viewport;
}

const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };

/**
 * 从 .henjiproj 包导入画布项目（新建项目，不覆盖已有项目）。
 * 返回新项目 ID；用户取消时返回 null。
 */
export async function importProjectFromPackage(): Promise<string | null> {
  const selected = await openDialog({
    multiple: false,
    filters: [{ name: 'Henji Project', extensions: [PROJECT_PACKAGE_EXTENSION, 'zip'] }],
  });
  const zipPath = typeof selected === 'string' ? selected : null;
  if (!zipPath) {
    return null;
  }

  const { manifestJson, pathMap } = await importProjectPackage(zipPath);
  const manifest = JSON.parse(manifestJson) as ProjectPackageManifest;

  const formatVersion = manifest.formatVersion ?? 0;
  if (formatVersion < 1 || formatVersion > PROJECT_PACKAGE_FORMAT_VERSION) {
    throw new Error(`不支持的项目包版本：${formatVersion}`);
  }

  const rawNodes = Array.isArray(manifest.nodes) ? manifest.nodes : [];
  const nodes = rewritePackagePathsToLocal(rawNodes, pathMap);
  const edges = Array.isArray(manifest.edges) ? manifest.edges : [];
  const baseName = manifest.project?.name?.trim() || '导入项目';

  const now = Date.now();
  const project: Project = {
    id: uuidv4(),
    name: `${baseName}（导入）`,
    createdAt: now,
    updatedAt: now,
    nodeCount: nodes.length,
    nodes,
    edges,
    viewport: manifest.viewport ?? DEFAULT_VIEWPORT,
    history: { past: [], future: [] },
  };

  await upsertProjectRecord(encodeProjectAsRecord(project));
  logger.info('[projectPackage] 项目导入完成', {
    zipPath,
    projectId: project.id,
    nodeCount: nodes.length,
    mediaCount: Object.keys(pathMap).length,
  });
  return project.id;
}
