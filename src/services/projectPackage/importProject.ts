import { openDialog } from '@/platform/desktopApi';
import type { Viewport } from '@xyflow/react';

import { createLogger } from '@/core/logging';
import { importProjectPackage } from '@/commands/projectPackage';
import { deleteImageEditorV3DocumentIfRevision } from '@/commands/imageEditorV3';
import { parseImageEditProjectPackageReferenceMappingsV3 } from '@/core/imageEdit/v3/projectPackageContracts';
import { getPlatform } from '@/platform/runtime';
import { canvasToDocumentContent } from '@/features/canvas/application/canvasDocumentContent';
import { canvasDocumentCommands } from '@/features/canvas/application/canvasDocumentEnvironment';
import { getDocumentOperations } from '@/features/documents/documentOperations';
import type { CanvasEdge, CanvasNode } from '@/features/canvas/domain/canvasNodes';
import { rewritePackagePathsToLocal } from './collectMediaRefs';
import { rewriteProjectImageEditorV3References } from './imageEditorV3ProjectAdapter';
import { PROJECT_PACKAGE_EXTENSION, PROJECT_PACKAGE_FORMAT_VERSION } from './exportProject';

const logger = createLogger('services.projectPackage.importProject');

/** 包里的名称来自别人的机器：去掉文件名不允许的字符与首尾空格、点，过长截断。 */
function sanitizeDocumentName(name: string | undefined): string {
  // eslint-disable-next-line no-control-regex -- 文件名里不允许控制字符，要换掉
  return (name ?? '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().replace(/[. ]+$/, '').slice(0, 100);
}

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

/**
 * 从 .henjiproj 包导入画布：在作品目录“画布/”新建一份画布文档（重名自动加序号，不覆盖已有画布），
 * 包里的视口写进新画布的会话状态。4.1 改为通用单文件包前保留。返回新画布文档 ID；用户取消时返回 null。
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

  const { manifestJson, pathMap, imageEditReferences = [] } = await importProjectPackage(zipPath);
  const importedDocumentMappings = parseImageEditProjectPackageReferenceMappingsV3(imageEditReferences);
  try {
    const manifest = JSON.parse(manifestJson) as ProjectPackageManifest;

    const formatVersion = manifest.formatVersion ?? 0;
    if (formatVersion < 1 || formatVersion > PROJECT_PACKAGE_FORMAT_VERSION) {
      throw new Error(`不支持的项目包版本：${formatVersion}`);
    }

    const rawNodes = Array.isArray(manifest.nodes) ? manifest.nodes : [];
    const restoredMediaNodes = rewritePackagePathsToLocal(rawNodes, pathMap);
    const nodes = rewriteProjectImageEditorV3References(restoredMediaNodes, imageEditReferences);
    const edges = Array.isArray(manifest.edges) ? manifest.edges : [];
    const baseName = sanitizeDocumentName(manifest.project?.name) || '导入画布';

    const meta = await getDocumentOperations().createDocument({
      kind: 'canvas',
      container: { kind: 'user' },
      name: `${baseName}（导入）`,
      content: canvasToDocumentContent({ nodes, edges }),
      onConflict: 'keepBoth',
    });
    if (manifest.viewport) {
      await canvasDocumentCommands().writeSessionState({ docId: meta.id, key: 'canvas.viewport', value: manifest.viewport }).catch(() => undefined);
    }
    logger.info('[projectPackage] 画布导入完成', {
      zipPath,
      projectId: meta.id,
      nodeCount: nodes.length,
      mediaCount: Object.keys(pathMap).length,
    });
    return meta.id;
  } catch (error) {
    await Promise.all(importedDocumentMappings.map(async (mapping) => {
      const result = await deleteImageEditorV3DocumentIfRevision({
        requestId: `project-package-import-rollback:${crypto.randomUUID()}`,
        documentRef: mapping.imported.documentRef,
        expectedRevision: mapping.imported.revision,
      });
      if (!result.deleted) throw new Error(`无法精确回滚导入文档：${mapping.imported.documentRef}`);
    })).then(async () => {
      await getPlatform().imageEditorV3.collectGarbage({
        requestId: `project-package-import-rollback-gc:${crypto.randomUUID()}`,
        retainedResourceRefs: [],
      });
    }).catch((rollbackError) => {
      logger.error('项目包导入失败后的图片编辑文档补偿失败', rollbackError, {
        event: 'project_package.image_editor_v3.rollback.failed',
        context: { documentCount: importedDocumentMappings.length },
      });
    });
    throw error;
  }
}
