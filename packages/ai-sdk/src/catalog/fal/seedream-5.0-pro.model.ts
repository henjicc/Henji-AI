import { defineModel } from "../defineModel";
import type { JsonValue, JsonObject } from "../../types/runtime";
import { countUploadedImages } from "../shared/mediaPresence";
import { FAL_COMMON_IMAGE_RATIOS, falOneMegapixelSize } from './imageSizing';
const SEEDREAM_PRO_RATIOS = FAL_COMMON_IMAGE_RATIOS;
export const falSeedream50ProModel = defineModel({
    meta: {
        id: 'fal-ai-seedream-5.0-pro', canonicalModelId: 'seedream-5.0-pro', seriesId: 'seedream', seriesRank: 5.1,
        provider: 'fal', type: 'image',
        tags: ['text-to-image', 'image-to-image', 'supports-image-editing', 'supports-multi-image', 'provider-fal'],
        aliases: ['seedream-5-pro-fal'], polling: { interval: 3000, maxAttempts: 180, expectedAttempts: 35 }
    },
    inputLimits: { images: { max: 10 }, videos: { max: 0 } },
    params: [
        {
            id: 'falSeedream50ProAspectRatio', type: 'dropdown', order: 1,
            default: 'smart',
            options: [{ value: 'smart' }, ...SEEDREAM_PRO_RATIOS.map((value) => ({ value }))]
        },
        {
            id: 'falSeedream50ProResolution', type: 'dropdown', order: 2,
            default: '2K',
            options: ['1K', '2K', '1MP'].map((value) => ({ value }))
        },
        {
            id: 'falSeedream50ProNumImages', type: 'number', order: 3,
            default: 1, min: 1, max: 6, step: 1
        }
    ],
    endpoints: {
        selector: async (params) => {
            const uploaded = Array.isArray(params.uploadedFilePaths) ? params.uploadedFilePaths : [];
            const images = uploaded.length > 0 ? uploaded : (Array.isArray(params.images) ? params.images : []);
            return images.length > 0 ? 'bytedance/seedream/v5/pro/edit' : 'bytedance/seedream/v5/pro/text-to-image';
        }
    },
    request: {
        builder: (params) => {
            const clean = (value: JsonValue): string[] => Array.isArray(value)
                ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
            const uploaded = clean(params.uploadedFilePaths);
            const images = uploaded.length > 0 ? uploaded : clean(params.images);
            const ratios: readonly string[] = FAL_COMMON_IMAGE_RATIOS;
            const raw = String(params.falSeedream50ProAspectRatio || 'smart');
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
            const resolution = params.falSeedream50ProResolution === '1K' ? '1K' : '2K';
            const oneMegapixel = params.falSeedream50ProResolution === '1MP';
            let imageSize: JsonValue = oneMegapixel ? falOneMegapixelSize(ratio) : `auto_${resolution}`;
            if (!oneMegapixel && raw !== 'smart' && raw !== 'auto') {
                const longSide = resolution === '2K' ? 2048 : 1024;
                const pair = ratio.split(':').map(Number);
                const width = pair[0] >= pair[1] ? longSide : Math.round(longSide * pair[0] / pair[1]);
                const height = pair[1] >= pair[0] ? longSide : Math.round(longSide * pair[1] / pair[0]);
                imageSize = { width, height };
            }
            const body: JsonObject = {
                prompt: typeof params.prompt === 'string' ? params.prompt : '',
                image_size: imageSize,
                num_images: Math.min(6, Math.max(1, Math.round(Number(params.falSeedream50ProNumImages || 1)))),
                enable_safety_checker: true
            };
            if (images.length > 0)
                body.image_urls = images.slice(0, 10);
            return body;
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => {
            const count = Math.min(6, Math.max(1, Math.round(Number(params.falSeedream50ProNumImages || 1))));
            const base = params.falSeedream50ProResolution === '1K' || params.falSeedream50ProResolution === '1MP' ? 0.0675 : 0.135;
            const inputs = countUploadedImages(params);
            return count * (base + Math.max(0, inputs - 1) * 0.0045);
        },
        description: '≤1536² $0.0675、最高 2K $0.135/输出图；第 2 张起输入图 +$0.0045/张'
    }
});
export default falSeedream50ProModel;
