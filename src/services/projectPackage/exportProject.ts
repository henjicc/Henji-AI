import { saveDialog } from '@/platform/desktopApi';

import { createLogger } from '@/core/logging';
import { exportProjectPackage } from '@/commands/projectPackage';
import { findCanvasProjectInstance } from '@/features/canvas/application/canvasProjectInstances';
import { readPersistedCanvasProjectSnapshot } from '@/features/canvas/application/canvasQueryService';
import { collectAndRewriteMedia } from './collectMediaRefs';
import { createProjectImageEditorV3Extension } from './imageEditorV3ProjectAdapter';
import { retainMultiLayerDocumentReferences } from '@/features/canvas/application/multiLayerDocumentLifecycleService';

const logger = createLogger('services.projectPackage.exportProject');

export const PROJECT_PACKAGE_EXTENSION = 'henjiproj';
export const PROJECT_PACKAGE_FORMAT_VERSION = 2;

function sanitizeFileName(name: string): string {
  const trimmed = name.trim().replace(/[\\/:*?"<>|]/g, '_');
  return trimmed || 'henji-project';
}

/**
 * 导出画布为 .henjiproj 包（zip：manifest.json + media/）。4.1 改为通用单文件包前保留。
 * 读的是画布文档（打开着的先写完最后一次，再读文件），返回保存路径；用户取消时返回 null。
 */
export async function exportProjectToPackage(projectId: string): Promise<string | null> {
  const open = findCanvasProjectInstance(projectId);
  if (open) await open.session.flush();
  let project;
  try {
    project = await readPersistedCanvasProjectSnapshot(projectId);
  } catch (error) {
    if (error instanceof Error && error.message === 'PROJECT_NOT_FOUND') throw new Error('画布不存在或已被删除');
    throw error;
  }
  const { nodes, mediaFiles } = collectAndRewriteMedia(project.nodes);
  const imageEditorV3 = createProjectImageEditorV3Extension(nodes);
  const releaseDocumentLease = retainMultiLayerDocumentReferences(
    imageEditorV3?.documents.map((document) => document.documentRef) ?? [],
  );

  try {
    const targetPath = await saveDialog({
      defaultPath: `${sanitizeFileName(project.name)}.${PROJECT_PACKAGE_EXTENSION}`,
      filters: [{ name: 'Henji Project', extensions: [PROJECT_PACKAGE_EXTENSION] }],
    });
    if (!targetPath) return null;

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
      // 视口不在画布文档里（会话状态）；导出用打开着的画布当前视口，没打开时为默认
      viewport: open?.store.getState().currentViewport ?? project.viewport,
      ...(imageEditorV3 ? { imageEditorV3 } : {}),
    };

    await exportProjectPackage(JSON.stringify(manifest), mediaFiles, targetPath);
    logger.info('[projectPackage] 项目导出完成', {
      projectId,
      targetPath,
      mediaCount: mediaFiles.length,
    });
    return targetPath;
  } finally {
    releaseDocumentLease();
  }
}
