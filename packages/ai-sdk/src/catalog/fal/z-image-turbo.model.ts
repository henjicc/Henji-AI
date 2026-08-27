import { defineModel } from "../defineModel";
import type { JsonValue, JsonObject } from "../../types/runtime";
import { falOneMegapixelSize } from './imageSizing';
const Z_IMAGE_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16'] as const;
export const zImageTurboModel = defineModel({
    meta: {
        id: 'fal-ai-z-image-turbo', canonicalModelId: 'z-image-turbo', seriesId: 'z-image', seriesRank: 1,
        provider: 'fal', type: 'image',
        tags: ['text-to-image', 'image-to-image', 'supports-image-editing', 'supports-prompt-expansion', 'turbo-mode', 'provider-fal'],
        aliases: ['z-image-turbo-fal'], polling: { interval: 3000, maxAttempts: 160, expectedAttempts: 30 }
    },
    inputLimits: { images: { max: 1 }, videos: { max: 0 } },
    params: [
        {
            id: 'falZImageTurboAspectRatio', type: 'dropdown', order: 1,
            default: 'smart',
            options: [{ value: 'smart' }, ...Z_IMAGE_RATIOS.map((value) => ({ value }))]
        },
        {
            id: 'falZImageTurboResolution', type: 'dropdown', order: 2,
            default: '1K',
            options: ['1K', '2K'].map((value) => ({ value }))
        },
        {
            id: 'falZImageTurboImageSize', type: 'dropdown', order: 3,
            default: 'provider',
            options: [{ value: 'provider' }, { value: '1MP' }]
        },
        {
            id: 'falZImageTurboNumImages', type: 'number', order: 4,
            default: 1, min: 1, max: 4, step: 1
        },
        {
            id: 'falZImageTurboNumInferenceSteps', type: 'number', order: 5,
            default: 8, min: 1, max: 8, step: 1
        },
        {
            id: 'falZImageTurboAcceleration', type: 'dropdown', order: 6,
            default: 'regular',
            options: [
                { value: 'none' },
                { value: 'regular' },
                { value: 'high' }
            ]
        },
        {
            id: 'falZImageTurboPromptExpansion', type: 'switch', order: 7,
            default: false
        },
        {
            id: 'falZImageTurboStrength', type: 'number', order: 8,
            default: 0.6, min: 0, max: 1, step: 0.05,
            visible: { condition: (params: JsonObject) => {
                    const uploaded = Array.isArray(params.uploadedFilePaths) ? params.uploadedFilePaths : [];
                    const images = uploaded.length > 0 ? uploaded : (Array.isArray(params.images) ? params.images : []);
                    return images.length > 0;
                } }
        }
    ],
    endpoints: {
        selector: async (params) => {
            const uploaded = Array.isArray(params.uploadedFilePaths) ? params.uploadedFilePaths : [];
            const images = uploaded.length > 0 ? uploaded : (Array.isArray(params.images) ? params.images : []);
            return images.length > 0 ? 'fal-ai/z-image/turbo/image-to-image' : 'fal-ai/z-image/turbo';
        }
    },
    request: {
        builder: (params) => {
            const clean = (value: JsonValue): string[] => Array.isArray(value)
                ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
            const uploaded = clean(params.uploadedFilePaths);
            const images = uploaded.length > 0 ? uploaded : clean(params.images);
            const ratios = ['1:1', '4:3', '3:4', '16:9', '9:16'];
            const raw = String(params.falZImageTurboAspectRatio || 'smart');
            const hint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0 ? params.__firstImageRatio : 1;
            let ratio = ratios.includes(raw) ? raw : '1:1';
            if (raw === 'smart' || raw === 'auto') {
                let difference = Number.POSITIVE_INFINITY;
                for (const candidate of ratios) {
                    const pair = candidate.split(':').map(Number);
                    const next = Math.abs(pair[0] / pair[1] - hint);
                    if (next < difference) {
                        difference = next;
                        ratio = candidate;
                    }
                }
            }
            const longSide = params.falZImageTurboResolution === '2K' ? 2048 : 1024;
            const pair = ratio.split(':').map(Number);
            const width = pair[0] >= pair[1] ? longSide : Math.round(longSide * pair[0] / pair[1]);
            const height = pair[1] >= pair[0] ? longSide : Math.round(longSide * pair[1] / pair[0]);
            const body: JsonObject = {
                prompt: typeof params.prompt === 'string' ? params.prompt : '',
                image_size: params.falZImageTurboImageSize === '1MP'
                    ? falOneMegapixelSize(ratio)
                    : (images.length > 0 && raw === 'smart' ? 'auto' : { width, height }),
                num_inference_steps: Math.min(8, Math.max(1, Math.round(Number(params.falZImageTurboNumInferenceSteps || 8)))),
                num_images: Math.min(4, Math.max(1, Math.round(Number(params.falZImageTurboNumImages || 1)))),
                enable_safety_checker: true,
                acceleration: ['none', 'high'].includes(String(params.falZImageTurboAcceleration)) ? String(params.falZImageTurboAcceleration) : 'regular',
                enable_prompt_expansion: params.falZImageTurboPromptExpansion === true
            };
            if (images.length > 0) {
                body.image_url = images[0];
                body.strength = Math.min(1, Math.max(0, Number(params.falZImageTurboStrength ?? 0.6)));
            }
            return body;
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => {
            const ratioText = String(params.falZImageTurboAspectRatio || '1:1');
            const pair = ratioText.split(':').map(Number);
            const ratio = pair[0] > 0 && pair[1] > 0 ? pair[0] / pair[1] : 1;
            const longSide = params.falZImageTurboResolution === '2K' ? 2048 : 1024;
            const width = ratio >= 1 ? longSide : longSide * ratio;
            const height = ratio >= 1 ? longSide / ratio : longSide;
            const megapixels = width * height / 1000000;
            const count = Math.min(4, Math.max(1, Math.round(Number(params.falZImageTurboNumImages || 1))));
            return count * megapixels * 0.005 + (params.falZImageTurboPromptExpansion === true ? 0.0025 : 0);
        },
        description: '$0.005/百万像素；提示词扩展 +$0.0025/次'
    }
});
export default zImageTurboModel;
