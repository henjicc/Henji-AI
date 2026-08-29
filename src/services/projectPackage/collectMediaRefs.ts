import type { CanvasNode } from '@/features/canvas/domain/canvasNodes';
import { mapCanvasNodeMediaReferences } from '@/features/canvas/application/canvasNodeMediaReferences';
import { isLikelyLocalImagePath } from '@/features/canvas/application/imageData';
import type { PackageMediaFile } from '@/commands/projectPackage';
import {
  reconcileLayerStackMissingResources,
  validateLayerStackDocument,
  type LayerStackDocumentV1,
} from '@/features/canvas/domain/layerStack';

const PACKAGE_MEDIA_PREFIX = 'media/';

export interface CollectMediaResult {
  /** 媒体字段已重写为包内路径的节点副本 */
  nodes: CanvasNode[];
  mediaFiles: PackageMediaFile[];
}

function basenameOf(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const name = normalized.slice(normalized.lastIndexOf('/') + 1) || 'media.bin';
  // 防止特殊字符破坏包内路径
  return name.replace(/[^A-Za-z0-9._-]/g, '_').slice(-120);
}

/**
 * 收集节点引用的本地媒体文件并把字段重写为包内路径（media/N-文件名）。
 * 远程 URL 原样保留；同一文件只收集一次。
 */
export function collectAndRewriteMedia(nodes: CanvasNode[]): CollectMediaResult {
  const srcToPackagePath = new Map<string, string>();
  const mediaFiles: PackageMediaFile[] = [];

  const mapValue = (value: string): string => {
    if (!isLikelyLocalImagePath(value)) {
      return value;
    }
    const existing = srcToPackagePath.get(value);
    if (existing) {
      return existing;
    }
    const packagePath = `${PACKAGE_MEDIA_PREFIX}${mediaFiles.length + 1}-${basenameOf(value)}`;
    srcToPackagePath.set(value, packagePath);
    mediaFiles.push({ srcPath: value, packagePath });
    return packagePath;
  };

  const rewrittenNodes = nodes.map((node) => ({
    ...node,
    data: mapCanvasNodeMediaReferences(node.data as DynamicValueMap, mapValue),
  })) as CanvasNode[];

  return { nodes: rewrittenNodes, mediaFiles };
}

/** 导入时把包内路径替换为解压后的本地绝对路径 */
export function rewritePackagePathsToLocal(
  nodes: CanvasNode[],
  pathMap: Record<string, string>
): CanvasNode[] {
  const mapValue = (value: string): string => {
    if (value.startsWith(PACKAGE_MEDIA_PREFIX)) {
      return pathMap[value] ?? value;
    }
    return value;
  };

  const existingPaths = new Set(Object.values(pathMap));
  return nodes.map((node) => {
    const data = mapCanvasNodeMediaReferences(node.data as DynamicValueMap, mapValue);
    if (!data.layerStackDocument || typeof data.layerStackDocument !== 'object' || Array.isArray(data.layerStackDocument)) {
      return { ...node, data } as CanvasNode;
    }
    try {
      const rawDocument = data.layerStackDocument as unknown as LayerStackDocumentV1;
      const sourceMissing = rawDocument.source.inputResourceId.startsWith(PACKAGE_MEDIA_PREFIX);
      const document = reconcileLayerStackMissingResources(
        validateLayerStackDocument({
          ...rawDocument,
          status: sourceMissing ? 'degraded' : rawDocument.status,
          source: {
            ...rawDocument.source,
            inputResourceStatus: sourceMissing ? 'missing' : 'ready',
          },
        }),
        existingPaths,
      );
      const composite = document.resources.find((resource) => resource.resourceId === document.compositeResourceId);
      const thumbnail = document.resources.find((resource) => resource.resourceId === document.thumbnailResourceId);
      return {
        ...node,
        data: {
          ...data,
          layerStackDocument: document,
          imageUrl: composite?.filePath ?? null,
          previewImageUrl: thumbnail?.filePath ?? composite?.filePath ?? null,
        },
      } as CanvasNode;
    } catch {
      // 未知旧版本保持原始数据，交由节点迁移器降级；导入器不猜测像素语义。
      return { ...node, data } as CanvasNode;
    }
  });
}
