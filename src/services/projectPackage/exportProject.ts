import { saveDialog } from '@/platform/desktopApi';

import { createLogger } from '@/core/logging';
import { exportProjectPackage } from '@/commands/projectPackage';
import { getProjectRecord } from '@/commands/projectState';
import { decodeProjectRecord } from '@/stores/projectStore';
import { collectAndRewriteMedia } from './collectMediaRefs';
import { createProjectImageEditorV3Extension } from './imageEditorV3ProjectAdapter';

const logger = createLogger('services.projectPackage.exportProject');

export const PROJECT_PACKAGE_EXTENSION = 'henjiproj';
export const PROJECT_PACKAGE_FORMAT_VERSION = 2;

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
  const imageEditorV3 = createProjectImageEditorV3Extension(nodes);

  const targetPath = await saveDialog({
    defaultPath: `${sanitizeFileName(project.name)}.${PROJECT_PACKAGE_EXTENSION}`,
    filters: [{ name: 'Henji Project', extensions: [PROJECT_PACKAGE_EXTENSION] }],
  });
  if (!targetPath) {
    return null;
  }

  const manifest = {
    // 没有 V3 文档时继续产出 V1，避免普通项目无谓失去旧版本兼容性。
    formatVersion: imageEditorV3 ? PROJECT_PACKAGE_FORMAT_VERSION : 1,
    app: 'henji-ai',
    exportedAt: Date.now(),
    project: {
      name: project.name,
      createdAt: project.createdAt,
    },
    nodes,
    edges: project.edges,
    viewport: project.viewport,
    ...(imageEditorV3 ? { imageEditorV3 } : {}),
  };

  await exportProjectPackage(JSON.stringify(manifest), mediaFiles, targetPath);
  logger.info('[projectPackage] 项目导出完成', {
    projectId,
    targetPath,
    mediaCount: mediaFiles.length,
  });
  return targetPath;
}
