import { createLogger } from '@/core/logging';
import { getPlatform } from '@/platform';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';

import { CANVAS_NODE_TYPES } from '../domain/canvasNodes';
import { runCanvasTransaction } from './canvasBatchService';
import { prepareNodeImage } from './imageData';

const logger = createLogger('features.canvas.panoramaSnapshot');

export async function commitPanoramaViewSnapshot(input: {
  sourceNodeId: string;
  dataUrl: string;
  title: string;
}): Promise<string> {
  const prepared = await prepareNodeImage(input.dataUrl);
  let createdNodeId: string | null = null;
  let ownershipTransferred = false;

  try {
    const project = useProjectStore.getState();
    const projectId = project.currentProjectId;
    if (!projectId || project.currentProject?.id !== projectId) {
      throw new Error('当前画布项目不可用');
    }
    await runCanvasTransaction(projectId, 2, async () => {
      const canvas = useCanvasStore.getState();
      const sourceNode = canvas.nodes.find((node) => node.id === input.sourceNodeId);
      if (!sourceNode || sourceNode.type !== CANVAS_NODE_TYPES.panoramaViewer) {
        throw new Error('全景查看节点已不存在');
      }
      createdNodeId = canvas.addDerivedExportNode(
        input.sourceNodeId,
        prepared.imageUrl,
        prepared.aspectRatio,
        prepared.previewImageUrl,
        {
          defaultTitle: input.title,
          resultKind: 'image',
          aspectRatioStrategy: 'provided',
          sizeStrategy: 'autoMinEdge',
        },
      );
      if (!createdNodeId) throw new Error('无法创建全景视角截图节点');
      const edgeId = useCanvasStore.getState().addEdge(input.sourceNodeId, createdNodeId);
      if (!edgeId) throw new Error('无法连接全景视角截图节点');
      return [{
        operation: 'panorama-view-snapshot',
        sourceNodeId: input.sourceNodeId,
        resultNodeId: createdNodeId,
        edgeId,
      }];
    }, {
      sourceNodeId: input.sourceNodeId,
      operation: 'panorama-view-snapshot',
    });
    if (!createdNodeId) throw new Error('全景视角截图事务未返回结果节点');
    ownershipTransferred = true;
    logger.info('全景视角截图已落到画布', {
      event: 'panorama.snapshot.commit.completed',
      sourceNodeId: input.sourceNodeId,
      resultNodeId: createdNodeId,
      context: { aspectRatio: prepared.aspectRatio },
    });
    return createdNodeId;
  } catch (error) {
    logger.error('全景视角截图落图失败', error, {
      event: 'panorama.snapshot.commit.failed',
      sourceNodeId: input.sourceNodeId,
      context: { createdNodeId },
    });
    throw error;
  } finally {
    if (!ownershipTransferred && prepared.createdFilePaths.length > 0) {
      await getPlatform().image.releaseManagedGenerationMedia(prepared.createdFilePaths)
        .catch(() => undefined);
    }
  }
}
