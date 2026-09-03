import { createLogger } from '@/core/logging';
import { useCanvasStore } from '@/stores/canvasStore';

import {
  createLayerStackCompositeOutputDescriptor,
  type CanvasGenerationOutputItem,
} from '../domain/generationOutputs';
import { validateLayerStackDocument, type LayerStackDocumentV1 } from '../domain/layerStack';
import { runCanvasTransaction } from './canvasBatchService';
import {
  GenerationOutputApplicationError,
  type CommitCanvasGenerationOutputsInput,
  type CommitCanvasGenerationOutputsResult,
} from './generationOutputApplicationContracts';
import {
  createMultiLayerDocumentFromLayerStack,
  rollbackCreatedMultiLayerDocument,
} from './multiLayerDocumentNodeGenerationAdapter';
import type { MultiLayerDocumentNodeProjection } from './multiLayerDocumentNodeApplicationContracts';

const logger = createLogger('features.canvas.generation-output');

export async function commitPreparedLayerStack(input: CommitCanvasGenerationOutputsInput & {
  completionId: string;
  ordered: CanvasGenerationOutputItem[];
  projectId: string;
}): Promise<CommitCanvasGenerationOutputsResult> {
  if (!input.preparedLayerStack) {
    throw new GenerationOutputApplicationError('INVALID_INPUT', '图层栈必须先完成下载、像素验证与合成');
  }
  let document: LayerStackDocumentV1;
  try {
    document = validateLayerStackDocument(input.preparedLayerStack);
  } catch (error) {
    throw new GenerationOutputApplicationError(
      'INVALID_INPUT',
      error instanceof Error ? error.message : '图层栈数据无效',
    );
  }
  if (document.status !== 'ready' || document.source.completionId !== input.completionId) {
    throw new GenerationOutputApplicationError('INVALID_INPUT', '初次图层栈提交必须完整且 completionId 一致');
  }
  if (document.layers.length !== input.ordered.length) {
    throw new GenerationOutputApplicationError('INVALID_INPUT', '图层栈文档与输出描述符数量不一致');
  }
  const placeholderNodeId = input.placeholderNodeId;
  if (!placeholderNodeId) {
    throw new GenerationOutputApplicationError('INVALID_INPUT', '图层栈提交必须提供结果占位节点');
  }
  const canvas = useCanvasStore.getState();
  const placeholder = canvas.nodes.find((node) => node.id === placeholderNodeId);
  if (!placeholder || placeholder.type !== input.resultNodeType) {
    throw new GenerationOutputApplicationError('NOT_FOUND', '图层栈结果占位节点已不存在');
  }
  if (input.sourceNodeId && !canvas.nodes.some((node) => node.id === input.sourceNodeId)) {
    throw new GenerationOutputApplicationError('NOT_FOUND', '图层栈来源节点已不存在');
  }
  const composite = document.resources.find((resource) => resource.resourceId === document.compositeResourceId);
  const thumbnail = document.resources.find((resource) => resource.resourceId === document.thumbnailResourceId);
  if (!composite?.filePath || !thumbnail?.filePath) {
    throw new GenerationOutputApplicationError('INVALID_INPUT', '图层栈缺少合成图或缩略图');
  }

  logger.info('图层栈原子落图开始', {
    event: 'canvas.generation_output.layer_stack.commit.start',
    projectId: input.projectId,
    sourceNodeId: input.sourceNodeId,
    placeholderNodeId,
    context: { completionId: input.completionId, layerCount: document.layers.length },
  });
  let projection: MultiLayerDocumentNodeProjection | null = null;
  let ownershipTransferred = false;
  try {
    if (input.signal?.aborted) {
      throw new GenerationOutputApplicationError('CONFLICT', '图层栈提交已取消');
    }
    const createDocument = input.createLayerStackDocument ?? createMultiLayerDocumentFromLayerStack;
    // 创建一旦开始就完成到可补偿边界；之后再观察取消并按精确 revision 删除。
    projection = await createDocument({ nodeId: placeholderNodeId, document });
    if (input.signal?.aborted) {
      throw new GenerationOutputApplicationError('CONFLICT', '图层栈提交已取消');
    }
    const committedProjection = projection;
    const transaction = await runCanvasTransaction(input.projectId, 1, async () => {
      const latest = useCanvasStore.getState();
      const latestPlaceholder = latest.nodes.find((node) => node.id === placeholderNodeId);
      if (!latestPlaceholder || latestPlaceholder.type !== input.resultNodeType) {
        throw new GenerationOutputApplicationError('CONFLICT', '提交前结果占位节点已被删除');
      }
      if (input.sourceNodeId && !latest.nodes.some((node) => node.id === input.sourceNodeId)) {
        throw new GenerationOutputApplicationError('CONFLICT', '提交前图层栈来源节点已被删除');
      }
      latest.updateNodeData(placeholderNodeId, {
        ...latestPlaceholder.data,
        imageUrl: committedProjection.imageUrl,
        previewImageUrl: committedProjection.previewImageUrl,
        aspectRatio: committedProjection.aspectRatio,
        imageEditSession: committedProjection.imageEditSession,
        resultKind: 'layer-stack',
        layerStackDocument: undefined,
        isGenerating: false,
        generationStartedAt: null,
        generationError: null,
        serverTaskId: null,
        serverTaskModelId: null,
        generationOutputCommitId: input.completionId,
        generationOutputDescriptor: createLayerStackCompositeOutputDescriptor(),
        generationOutputStrategy: 'layer-stack',
        generationOutputDescriptors: input.ordered.map((item) => item.descriptor),
      });
      if (input.sourceNodeId) latest.addEdge(input.sourceNodeId, placeholderNodeId);
      latest.setSelectedNode(placeholderNodeId);
      return [{
        operation: 'generation-output',
        completionId: input.completionId,
        resultNodeIds: [placeholderNodeId],
        groupNodeId: null,
      }];
    }, { completionId: input.completionId, strategy: 'layer-stack' });
    if (transaction.appliedOperations.length !== 1) {
      throw new GenerationOutputApplicationError('CONFLICT', '图层栈事务未完整应用');
    }
    ownershipTransferred = true;
    logger.info('图层栈原子落图完成', {
      event: 'canvas.generation_output.layer_stack.commit.completed',
      projectId: input.projectId,
      context: {
        completionId: input.completionId,
        layerCount: document.layers.length,
        documentRef: projection.imageEditSession.documentRef,
        revision: projection.imageEditSession.revision,
      },
    });
    return {
      projectId: input.projectId,
      completionId: input.completionId,
      strategy: 'layer-stack',
      resultNodeIds: [placeholderNodeId],
      groupNodeId: null,
      idempotent: false,
    };
  } catch (error) {
    logger.error('图层栈原子落图失败', error, {
      event: 'canvas.generation_output.layer_stack.commit.failed',
      projectId: input.projectId,
      context: { completionId: input.completionId, layerCount: document.layers.length },
    });
    throw error;
  } finally {
    if (projection && !ownershipTransferred) {
      const rollbackDocument = input.rollbackLayerStackDocument ?? rollbackCreatedMultiLayerDocument;
      try {
        const deleted = await rollbackDocument(projection);
        if (!deleted) {
          logger.error(
            '图层栈文档补偿未删除目标 revision',
            new Error('目标文档已不存在或 revision 已变化，已登记为清理候选'),
            {
              event: 'canvas.generation_output.layer_stack.document_rollback.failed',
              projectId: input.projectId,
              context: {
                completionId: input.completionId,
                documentRef: projection.imageEditSession.documentRef,
                revision: projection.imageEditSession.revision,
                cleanupCandidate: true,
              },
            },
          );
        }
      } catch (rollbackError) {
        logger.error('图层栈文档补偿失败', rollbackError, {
          event: 'canvas.generation_output.layer_stack.document_rollback.failed',
          projectId: input.projectId,
          context: {
            completionId: input.completionId,
            documentRef: projection.imageEditSession.documentRef,
            revision: projection.imageEditSession.revision,
            cleanupCandidate: true,
          },
        });
      }
    }
  }
}
