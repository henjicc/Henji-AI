import type { CanvasNode } from '@/features/canvas/domain/canvasNodes';
import { isLikelyLocalImagePath } from '@/features/canvas/application/imageData';
import type { PackageMediaFile } from '@/commands/projectPackage';

/** 节点 data 中可能承载本地媒体路径的字段（含分镜帧） */
const MEDIA_URL_FIELDS = ['imageUrl', 'previewImageUrl', 'videoUrl', 'audioUrl'] as const;
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

function mapMediaFields(
  data: Record<string, unknown>,
  mapValue: (value: string) => string
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...data };

  for (const field of MEDIA_URL_FIELDS) {
    const value = next[field];
    if (typeof value === 'string' && value) {
      next[field] = mapValue(value);
    }
  }

  if (Array.isArray(next.frames)) {
    next.frames = next.frames.map((frame) => {
      if (!frame || typeof frame !== 'object') {
        return frame;
      }
      const frameRecord = { ...(frame as Record<string, unknown>) };
      for (const field of ['imageUrl', 'previewImageUrl'] as const) {
        const value = frameRecord[field];
        if (typeof value === 'string' && value) {
          frameRecord[field] = mapValue(value);
        }
      }
      return frameRecord;
    });
  }

  return next;
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
    data: mapMediaFields(node.data as Record<string, unknown>, mapValue),
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

  return nodes.map((node) => ({
    ...node,
    data: mapMediaFields(node.data as Record<string, unknown>, mapValue),
  })) as CanvasNode[];
}
