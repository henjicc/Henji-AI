import { save as saveDialog } from '@tauri-apps/plugin-dialog';

import { createLogger } from '@/core/logging';
import { exportProjectPackage } from '@/commands/projectPackage';
import { getProjectRecord } from '@/commands/projectState';
import { decodeProjectRecord } from '@/stores/projectStore';
import { collectAndRewriteMedia } from './collectMediaRefs';

const logger = createLogger('services.projectPackage.exportProject');

export const PROJECT_PACKAGE_EXTENSION = 'henjiproj';
export const PROJECT_PACKAGE_FORMAT_VERSION = 1;

function sanitizeFileName(name: string): string {
  const trimmed = name.trim().replace(/[\\/:*?"<>|]/g, '_');
  return trimmed || 'henji-project';
}

/**
 * 导出画布项目为 .henjiproj 包（zip：manifest.json + media/）。
 * 返回保存路径；用户取消时返回 null。
 */
export async function exportProjectToPackage(projectId: string): Promise<string | null> {
  const record = await getProjectRecord(projectId);
  if (!record) {
    throw new Error('项目不存在或已被删除');
  }

  const project = decodeProjectRecord(record);
  const { nodes, mediaFiles } = collectAndRewriteMedia(project.nodes);

  const targetPath = await saveDialog({
    defaultPath: `${sanitizeFileName(project.name)}.${PROJECT_PACKAGE_EXTENSION}`,
    filters: [{ name: 'Henji Project', extensions: [PROJECT_PACKAGE_EXTENSION] }],
  });
  if (!targetPath) {
    return null;
  }

  const manifest = {
    formatVersion: PROJECT_PACKAGE_FORMAT_VERSION,
    app: 'henji-ai',
    exportedAt: Date.now(),
    project: {
      name: project.name,
      createdAt: project.createdAt,
    },
    nodes,
    edges: project.edges,
    viewport: project.viewport,
  };

  await exportProjectPackage(JSON.stringify(manifest), mediaFiles, targetPath);
  logger.info('[projectPackage] 项目导出完成', {
    projectId,
    targetPath,
    mediaCount: mediaFiles.length,
  });
  return targetPath;
}
