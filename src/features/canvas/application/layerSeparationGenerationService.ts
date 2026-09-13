import type { GenerationNodeExecutionOptions } from './generationNodeExecutor';
import type { GenerationNodeResultCommitContext, GenerationNodeRuntimePreparationContext } from '../nodes/shared/generationNodeExecutionTypes';
import type { StructuredGenerationLayerStackV1 } from '@henjicc/ai-sdk';

import type { CanvasGenerationOutput } from '@/features/canvas/generation/runGeneration';
import { getPlatform } from '@/platform/runtime';
import { useProjectStore } from '@/stores/projectStore';

import type { CanvasNodeType } from '../domain/canvasNodes';
import type { CanvasGenerationOutputBatchContractV1 } from '../domain/generationOutputs';
import type { LayerStackDocumentV1 } from '../domain/layerStack';
import { GenerationOutputRollbackError } from './generationOutputApplicationContracts';
import { retainsCanvasMutation } from './canvasPersistenceService';
import {
  commitCanvasGenerationOutputs,
  commitCanvasGenerationOutputsInProject,
  type CommitCanvasGenerationOutputsResult,
} from './generationOutputApplicationService';
import {
  prepareLayerStackDocument,
  type PrepareLayerStackDocumentInput,
} from './layerStackApplicationService';

export interface CommitLayerSeparationGenerationInput {
  projectId?: string;
  sourceNodeId: string;
  placeholderNodeId: string;
  resultNodeType: CanvasNodeType;
  completionId: string;
  sourceImage: string;
  providerId: string;
  modelId: string;
  result: CanvasGenerationOutput;
  prepareDocument?: (input: PrepareLayerStackDocumentInput) => Promise<LayerStackDocumentV1>;
  commitOutputs?: typeof commitCanvasGenerationOutputs;
  releaseResources?: (filePaths: string[]) => Promise<void>;
  signal?: AbortSignal;
}

export function createLayerStackGenerationContract(
  structuredOutput: StructuredGenerationLayerStackV1,
): CanvasGenerationOutputBatchContractV1 {
  if (structuredOutput.version !== 1 || structuredOutput.kind !== 'layer-stack') {
    throw new Error('模型没有返回受支持的图层栈协议');
  }
  return {
    version: 1,
    strategy: 'layer-stack',
    resultKind: 'layer-stack',
    outputs: structuredOutput.outputs
      .map((layer) => ({
        source: layer.filePath?.trim() || layer.url,
        descriptor: {
          version: 1 as const,
          outputId: `layer-${layer.sourceOutputIndex}`,
          order: layer.zIndex,
          sourceOutputIndex: layer.sourceOutputIndex,
          mediaType: 'image' as const,
          semantic: {
            kind: 'layer',
            resultKind: 'image' as const,
            label: layer.name ?? (layer.role === 'base' ? '底图' : `图层 ${layer.zIndex}`),
          },
          layer: {
            index: layer.zIndex,
            ...(layer.name ? { name: layer.name } : {}),
            opacity: 1,
            blendMode: 'normal',
          },
          metadata: {
            role: layer.role,
            providerZIndex: layer.zIndex,
            format: layer.format,
            width: layer.width,
            height: layer.height,
            ...(layer.description ? { description: layer.description } : {}),
            ...(layer.boundingBox ? { boundingBox: layer.boundingBox } : {}),
          },
        },
      }))
      .sort((left, right) => left.descriptor.order - right.descriptor.order),
  };
}

export async function commitLayerSeparationGeneration(
  input: CommitLayerSeparationGenerationInput,
): Promise<CommitCanvasGenerationOutputsResult> {
  const projectId = input.projectId ?? useProjectStore.getState().currentProjectId;
  if (input.signal?.aborted) {
    const error = new Error('图层拆分提交已取消');
    error.name = 'AbortError';
    throw error;
  }
  const structuredOutput = input.result.structuredOutput;
  if (!structuredOutput || structuredOutput.kind !== 'layer-stack') {
    throw new Error('图层拆分响应缺少结构化图层数据，已拒绝按普通多图提交');
  }
  if (input.result.outputs.length !== structuredOutput.outputs.length) {
    throw new Error(`图层媒体与结构化描述数量不一致：${input.result.outputs.length}/${structuredOutput.outputs.length}`);
  }
  if (!projectId && !input.commitOutputs) throw new Error('未找到图层拆分的原画布项目');
  const prepareDocument = input.prepareDocument ?? prepareLayerStackDocument;
  const releaseResources = input.releaseResources ?? ((filePaths) => getPlatform().image.releaseLayerStackResources(filePaths));
  let createdFilePaths: string[] = [];
  try {
    const document = await prepareDocument({
      structuredOutput,
      completionId: input.completionId,
      sourceNodeId: input.sourceNodeId,
      inputResourceId: input.sourceImage,
      providerId: input.providerId,
      modelId: input.modelId,
      onCreatedFilePaths: (filePaths) => { createdFilePaths = [...filePaths]; },
    });
    input.signal?.throwIfAborted();
    const commitOutputs: typeof commitCanvasGenerationOutputs = input.commitOutputs ?? (projectId
      ? payload => commitCanvasGenerationOutputsInProject(projectId, payload)
      : commitCanvasGenerationOutputs);
    return await commitOutputs({
      sourceNodeId: input.sourceNodeId,
      placeholderNodeId: input.placeholderNodeId,
      resultNodeType: input.resultNodeType,
      contract: createLayerStackGenerationContract(structuredOutput),
      completionId: input.completionId,
      preparedLayerStack: document,
      signal: input.signal,
    });
  } catch (error) {
    if (createdFilePaths.length > 0 && !(error instanceof GenerationOutputRollbackError) && !retainsCanvasMutation(error)) {
      try {
        await releaseResources(createdFilePaths);
      } catch {
        // 清理失败不能覆盖原始协议/事务错误；主进程已记录受管文件操作失败。
      }
    }
    throw error;
  }
}

/** 界面与无挂载任务共用结构化图层提交。 */
export const layerSeparationGenerationExecution = {
  supportsBackgroundCompletion: true,
  resultNodeExtraData: { resultKind: 'layer-stack' },
  prepareRuntimeParams: ({ images }: GenerationNodeRuntimePreparationContext) => {
    if (images.length !== 1) throw new Error('图层拆分必须且只能提供 1 张源图');
    return {};
  },
  commitGenerationResult: (context: GenerationNodeResultCommitContext) => {
    const sourceImage = context.inputs.images[0];
    if (!sourceImage) throw new Error('图层拆分结果缺少源图引用');
    return commitLayerSeparationGeneration({
      projectId: context.projectId,
      signal: context.signal,
      sourceNodeId: context.sourceNodeId,
      placeholderNodeId: context.placeholderNodeId,
      resultNodeType: context.resultNodeType,
      completionId: context.completionId,
      sourceImage,
      providerId: context.providerId,
      modelId: context.modelId,
      result: context.result,
    });
  },

} satisfies Pick<GenerationNodeExecutionOptions, 'prepareRuntimeParams' | 'commitGenerationResult' | 'supportsBackgroundCompletion' | 'resultNodeExtraData'>;
