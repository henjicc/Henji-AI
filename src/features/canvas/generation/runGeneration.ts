import { createLogger } from '@/core/logging';
import { registry } from '@/core/ModelRegistry';
import { getMultiAngleExecutionModel } from '@/core/modelCatalog/multiAngleExecutionModels';
import { GenerationService } from '@/core/services/GenerationService';
import type { GenerateResult, ProgressStatus } from '@/core/providers/base';
import { persistImageLocally } from '@/features/canvas/application/imageData';
import { extractServerTaskIdFromMetadata } from '@/features/generation/application/taskServerId';

const logger = createLogger('features.canvas.generation.runGeneration');

export type CanvasMediaType = 'image' | 'video' | 'audio';

const PROGRESS_THROTTLE_MS = 200;

export interface CanvasGenerationUpstream {
  images?: string[];
  videos?: string[];
  audios?: string[];
}

export interface CanvasGenerationRequest {
  modelId: string;
  mediaType?: CanvasMediaType;
  params: DynamicValueMap;
  /** @deprecated 请使用 upstream.images */
  referenceImages?: string[];
  /** 上游节点输出的媒体输入（按协议键注入生成参数） */
  upstream?: CanvasGenerationUpstream;
  /** 真进度回调，范围 0~1 */
  onProgress?: (progress: number) => void;
  /**
   * 异步任务创建后立即回调服务端任务 ID。
   * 调用方应把它持久化到结果节点，否则应用中途退出这次生成就再也找不回来了。
   */
  onTaskId?: (taskId: string) => void;
}

export interface CanvasResumeRequest {
  modelId: string;
  mediaType?: CanvasMediaType;
  taskId: string;
  onProgress?: (progress: number) => void;
}

export interface CanvasGenerationOutput {
  /** 全部输出（多结果按 '|||' 拆分，优先本地文件路径） */
  outputs: string[];
  /** 首个输出 */
  primary: string;
}

/**
 * 兼容旧画布节点数据中的模型 ID（短 ID、带 provider 前缀的别名等）。
 * 未匹配时回退到对应媒体类型的第一个模型并记录告警。
 */
export function resolveCanvasModelId(inputModelId: string, mediaType: CanvasMediaType = 'image'): string {
  const requested = (inputModelId ?? '').trim();
  if (requested && (registry.getModel(requested) || getMultiAngleExecutionModel(requested))) {
    return requested;
  }

  const models = registry.getModelsByType(mediaType);
  if (models.length === 0) {
    throw new Error(`未找到可用的${mediaType}模型，请先加载模型配置`);
  }

  const shortId = requested.includes('/') ? requested.split('/').pop() ?? requested : requested;
  const exactMatch = models.find((model) => model.meta.id === requested || model.meta.id === shortId);
  if (exactMatch) {
    return exactMatch.meta.id;
  }

  if (shortId) {
    const fuzzyMatch = models.find(
      (model) => model.meta.id.endsWith(`/${shortId}`) || model.meta.id.includes(shortId)
    );
    if (fuzzyMatch) {
      return fuzzyMatch.meta.id;
    }
  }

  logger.warn('[CanvasGeneration] 模型 ID 未匹配，回退默认模型', {
    requested,
    fallback: models[0].meta.id,
  });
  return models[0].meta.id;
}

function splitMultiValue(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split('|||')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function collectOutputs(result: GenerateResult): string[] {
  const filePaths = splitMultiValue(result.filePath);
  const urls = splitMultiValue(result.url);
  const count = Math.max(filePaths.length, urls.length);
  const outputs: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const output = filePaths[index] || urls[index];
    if (output) {
      outputs.push(output);
    }
  }
  return outputs;
}

function createThrottledProgressHandler(
  onProgress: ((progress: number) => void) | undefined
): ((status: ProgressStatus) => void) | undefined {
  if (!onProgress) {
    return undefined;
  }

  let lastEmittedAt = 0;
  let lastProgress = 0;
  return (status: ProgressStatus) => {
    if (typeof status.progress !== 'number' || !Number.isFinite(status.progress)) {
      return;
    }
    const normalized = Math.min(1, Math.max(0, status.progress / 100));
    const now = Date.now();
    if (normalized < 1 && now - lastEmittedAt < PROGRESS_THROTTLE_MS && normalized - lastProgress < 0.05) {
      return;
    }
    lastEmittedAt = now;
    lastProgress = normalized;
    onProgress(normalized);
  };
}

/**
 * 画布节点统一生成入口：直连 GenerationService，处理参考图本地化、
 * 异步轮询续接与真进度回调。
 */
export async function runCanvasGeneration(request: CanvasGenerationRequest): Promise<CanvasGenerationOutput> {
  const mediaType = request.mediaType ?? 'image';
  const modelId = resolveCanvasModelId(request.modelId, mediaType);
  const generationService = GenerationService.getInstance();
  const handleProgress = createThrottledProgressHandler(request.onProgress);

  const params: DynamicValueMap = { ...request.params };

  // 上游媒体注入：协议键与对话模式一致（images/uploadedFilePaths 等）
  const upstreamImages = [
    ...(request.upstream?.images ?? []),
    ...(request.referenceImages ?? []),
  ];
  if (upstreamImages.length > 0) {
    const normalizedImages = await Promise.all(
      upstreamImages.map(async (imageUrl) => await persistImageLocally(imageUrl))
    );
    params.images = normalizedImages;
    params.uploadedFilePaths = normalizedImages;
  }
  if ((request.upstream?.videos ?? []).length > 0) {
    params.videos = request.upstream?.videos;
    params.uploadedVideoFilePaths = request.upstream?.videos;
  }
  if ((request.upstream?.audios ?? []).length > 0) {
    params.audios = request.upstream?.audios;
    params.uploadedAudioFilePaths = request.upstream?.audios;
  }

  let result = await generationService.generate(modelId, params, handleProgress, {
    progressSource: 'canvas',
  });

  if (result.status === 'pending') {
    const taskId = result.taskId ?? extractServerTaskIdFromMetadata(result.metadata);
    if (!taskId) {
      throw new Error('异步任务缺少 taskId，无法继续轮询');
    }
    request.onTaskId?.(taskId);
    result = await generationService.continuePolling(modelId, taskId, params, handleProgress, {
      progressSource: 'canvas',
    });
  }

  return toGenerationOutput(result);
}

/**
 * 对已存在的服务端任务续查（应用重启后恢复未完成的异步生成）。
 * 不重新提交任务，只接着取结果。
 */
export async function resumeCanvasGeneration(
  request: CanvasResumeRequest
): Promise<CanvasGenerationOutput> {
  const mediaType = request.mediaType ?? 'image';
  const modelId = resolveCanvasModelId(request.modelId, mediaType);
  const result = await GenerationService.getInstance().continuePolling(
    modelId,
    request.taskId,
    {},
    createThrottledProgressHandler(request.onProgress),
    { progressSource: 'canvas' }
  );
  return toGenerationOutput(result);
}

function toGenerationOutput(result: GenerateResult): CanvasGenerationOutput {
  const outputs = collectOutputs(result);
  if (outputs.length === 0) {
    throw new Error('生成结果为空');
  }

  return {
    outputs,
    primary: outputs[0],
  };
}
