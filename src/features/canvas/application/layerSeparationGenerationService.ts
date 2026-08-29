import type { StructuredGenerationLayerStackV1 } from '@henjicc/ai-sdk';

import type { CanvasGenerationOutput } from '@/features/canvas/generation/runGeneration';
import { getPlatform } from '@/platform/runtime';

import type { CanvasNodeType } from '../domain/canvasNodes';
import type { CanvasGenerationOutputBatchContractV1 } from '../domain/generationOutputs';
import type { LayerStackDocumentV1 } from '../domain/layerStack';
import {
  commitCanvasGenerationOutputs,
  type CommitCanvasGenerationOutputsResult,
} from './generationOutputApplicationService';
import {
  prepareLayerStackDocument,
  type PrepareLayerStackDocumentInput,
} from './layerStackApplicationService';

export interface CommitLayerSeparationGenerationInput {
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
  const structuredOutput = input.result.structuredOutput;
  if (!structuredOutput || structuredOutput.kind !== 'layer-stack') {
    throw new Error('图层拆分响应缺少结构化图层数据，已拒绝按普通多图提交');
  }
  if (input.result.outputs.length !== structuredOutput.outputs.length) {
    throw new Error(`图层媒体与结构化描述数量不一致：${input.result.outputs.length}/${structuredOutput.outputs.length}`);
  }
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
    const commitOutputs = input.commitOutputs ?? commitCanvasGenerationOutputs;
    return await commitOutputs({
      sourceNodeId: input.sourceNodeId,
      placeholderNodeId: input.placeholderNodeId,
      resultNodeType: input.resultNodeType,
      contract: createLayerStackGenerationContract(structuredOutput),
      completionId: input.completionId,
      preparedLayerStack: document,
    });
  } catch (error) {
    if (createdFilePaths.length > 0) {
      try {
        await releaseResources(createdFilePaths);
      } catch {
        // 清理失败不能覆盖原始协议/事务错误；主进程已记录受管文件操作失败。
      }
    }
    throw error;
  }
}
