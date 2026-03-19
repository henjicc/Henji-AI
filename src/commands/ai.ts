import { GenerationService } from '@/core/services/GenerationService';
import { registry } from '@/core/ModelRegistry';

export interface GenerateRequest {
  prompt: string;
  model: string;
  size: string;
  aspect_ratio: string;
  reference_images?: string[];
  extra_params?: Record<string, unknown>;
}

function pickFirstValue(value: string | undefined): string {
  if (!value) {
    return '';
  }
  const [first] = value.split('|||');
  return first?.trim() ?? '';
}

function extractTaskIdFromMetadata(metadata: Record<string, unknown> | undefined): string | undefined {
  if (!metadata) return undefined
  const direct = metadata.task_id ?? metadata.taskId ?? metadata.request_id ?? metadata.requestId
  if (typeof direct === 'string' && direct.trim().length > 0) {
    return direct.trim()
  }
  const task = metadata.task
  if (task && typeof task === 'object') {
    const taskRecord = task as Record<string, unknown>
    const nested = taskRecord.task_id ?? taskRecord.taskId ?? taskRecord.request_id ?? taskRecord.requestId
    if (typeof nested === 'string' && nested.trim().length > 0) {
      return nested.trim()
    }
  }
  return undefined
}

function resolveImageModelId(inputModelId: string): string {
  const requested = inputModelId.trim();
  if (requested && registry.getModel(requested)) {
    return requested;
  }

  const imageModels = registry.getModelsByType('image');
  if (imageModels.length === 0) {
    throw new Error('未找到可用的图片模型，请先加载模型配置');
  }

  const shortId = requested.includes('/') ? requested.split('/').pop() ?? requested : requested;

  const exactMatch = imageModels.find((model) => model.meta.id === requested || model.meta.id === shortId);
  if (exactMatch) {
    return exactMatch.meta.id;
  }

  if (shortId) {
    const fuzzyMatch = imageModels.find((model) =>
      model.meta.id.endsWith(`/${shortId}`)
      || model.meta.id.includes(shortId)
    );
    if (fuzzyMatch) {
      return fuzzyMatch.meta.id;
    }
  }

  return imageModels[0].meta.id;
}

export async function setApiKey(provider: string, apiKey: string): Promise<void> {
  await GenerationService.getInstance().setApiKey(provider, apiKey);
}

export async function generateImage(request: GenerateRequest): Promise<string> {
  const modelId = resolveImageModelId(request.model);
  const generationService = GenerationService.getInstance();
  const params: Record<string, unknown> = {
    ...(request.extra_params ?? {}),
    prompt: request.prompt,
    text: request.prompt,
    size: request.size,
    aspect_ratio: request.aspect_ratio,
    requestAspectRatio: request.aspect_ratio,
  };

  if ((request.reference_images ?? []).length > 0) {
    params.images = request.reference_images;
    params.uploadedFilePaths = request.reference_images;
  }

  let result = await generationService.generate(modelId, params);
  if (result.status === 'pending') {
    const taskId = result.taskId ?? extractTaskIdFromMetadata(result.metadata)
    if (!taskId) {
      throw new Error('异步任务缺少 taskId，无法继续轮询')
    }
    result = await generationService.continuePolling(modelId, taskId, params)
  }

  const firstUrl = pickFirstValue(result.url);
  const firstPath = pickFirstValue(result.filePath);
  const output = firstPath || firstUrl;

  if (!output) {
    throw new Error('生成结果为空');
  }

  return output;
}

export async function listModels(): Promise<string[]> {
  return registry.getModelsByType('image').map((model) => model.meta.id);
}
