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

function resolveImageModelId(inputModelId: string): string {
  const requested = inputModelId.trim();
  if (requested && registry.getModel(requested)) {
    return requested;
  }

  const imageModels = registry.getModelsByType('image');
  if (imageModels.length === 0) {
    throw new Error('未找到可用的图像模型，请先加载模型配置');
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
  GenerationService.getInstance().setApiKey(provider, apiKey);
}

export async function generateImage(request: GenerateRequest): Promise<string> {
  const modelId = resolveImageModelId(request.model);
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

  const result = await GenerationService.getInstance().generate(modelId, params);
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
