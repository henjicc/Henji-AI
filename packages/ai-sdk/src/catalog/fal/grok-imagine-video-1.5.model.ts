import { defineModel } from "../defineModel";
import type { JsonObject } from "../../types/runtime";
import { countUploadedImages, hasUploadedImage, resolveUploadedImageSources } from "../shared/mediaPresence";

// 价格与字段来源：docs/model-adaptation/Grok-Imagine-Video-1.5/Grok-Imagine-Video-1.5_Fal.md（Fal 模型页与 OpenAPI，2026-11-07 读取）
const RATIOS = ['16:9', '4:3', '3:2', '1:1', '2:3', '3:4', '9:16'];
const RATES: Record<string, Record<string, number>> = {
    standard: { '480p': 0.08, '720p': 0.14, '1080p': 0.25 },
    lite: { '480p': 0.02, '720p': 0.03, '1080p': 0.14 }
};

function lite(params: JsonObject): boolean {
    return params.falGrokVideo15Version === 'lite';
}

/** 参考生视频只有标准版提供。 */
function reference(params: JsonObject): boolean {
    return !lite(params) && params.falGrokVideo15Mode === 'reference-to-video';
}

/** 参考生视频只支持 480p/720p。 */
function resolution(params: JsonObject): string {
    const value = String(params.falGrokVideo15Resolution);
    const allowed = reference(params) ? ['480p', '720p'] : ['480p', '720p', '1080p'];
    return allowed.includes(value) ? value : '720p';
}

function duration(params: JsonObject): number {
    const value = Math.round(Number(params.falGrokVideo15Duration));
    return Number.isFinite(value) ? Math.min(15, Math.max(1, value)) : 6;
}

function ratio(params: JsonObject): string {
    const raw = String(params.falGrokVideo15AspectRatio || 'smart');
    if (RATIOS.includes(raw))
        return raw;
    const hint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0
        ? params.__firstImageRatio : 16 / 9;
    const numeric = (value: string) => { const [w, h] = value.split(':').map(Number); return w / h; };
    return RATIOS.reduce((best, next) => Math.abs(numeric(next) - hint) < Math.abs(numeric(best) - hint) ? next : best, '16:9');
}

export const falGrokImagineVideo15Model = defineModel({
    meta: {
        id: 'fal-ai-grok-imagine-video-1.5', canonicalModelId: 'grok-imagine-video-1.5', seriesId: 'grok-imagine-video', seriesRank: 1.5,
        provider: 'fal', type: 'video',
        tags: ['text-to-video', 'image-to-video', 'reference-mode'],
        polling: { interval: 3000, maxAttempts: 300, expectedAttempts: 40 }
    },
    inputLimits: {
        images: { max: 1 }, videos: { max: 0 }, audios: { max: 0 },
        rules: [{ when: 'falGrokVideo15Version !== "lite" && falGrokVideo15Mode === "reference-to-video"', images: { min: 1, max: 7 } }]
    },
    requirements: [
        {
            id: 'fal-grok-video-1.5-reference', when: 'falGrokVideo15Version !== "lite" && falGrokVideo15Mode === "reference-to-video"',
            require: { images: { min: 1 } },
            message: { title: '图片必需', message: '参考生视频需要 1–7 张参考图', type: 'warning' }
        }
    ],
    params: [
        {
            id: 'falGrokVideo15Version', type: 'dropdown', order: 1,
            default: 'standard',
            options: [{ value: 'standard' }, { value: 'lite' }]
        },
        {
            id: 'falGrokVideo15Mode', type: 'dropdown', order: 2,
            default: 'text-image-to-video',
            visible: { condition: (params: JsonObject) => !lite(params) },
            options: [{ value: 'text-image-to-video' }, { value: 'reference-to-video' }]
        },
        {
            id: 'falGrokVideo15AspectRatio', type: 'dropdown', order: 3,
            default: 'smart',
            visible: { condition: (params: JsonObject) => reference(params) || !hasUploadedImage(params) },
            options: [{ value: 'smart' }, ...RATIOS.map((value) => ({ value }))]
        },
        {
            id: 'falGrokVideo15Resolution', type: 'dropdown', order: 4,
            default: '720p',
            options: [{ value: '480p' }, { value: '720p' }, { value: '1080p' }]
        },
        {
            id: 'falGrokVideo15Duration', type: 'number', order: 5,
            default: 6, min: 1, max: 15, step: 1
        }
    ],
    endpoints: {
        selector: async (params) => {
            if (reference(params))
                return 'xai/grok-imagine-video/v1.5/reference-to-video';
            const family = lite(params) ? 'xai/grok-imagine-video/v1.5/lite' : 'xai/grok-imagine-video/v1.5';
            return hasUploadedImage(params) ? `${family}/image-to-video` : `${family}/text-to-video`;
        }
    },
    request: {
        builder: (params) => {
            const prompt = typeof params.prompt === 'string' ? params.prompt.trim().slice(0, 4096) : '';
            if (!prompt)
                throw new Error('Grok Imagine Video 1.5 的提示词不能为空');
            const images = resolveUploadedImageSources(params);
            const body: JsonObject = { prompt, duration: duration(params), resolution: resolution(params) };
            if (reference(params)) {
                if (images.length === 0)
                    throw new Error('Grok Imagine Video 1.5 参考生视频需要至少 1 张参考图');
                body.reference_image_urls = images.slice(0, 7);
                body.aspect_ratio = ratio(params);
            }
            else if (images.length > 0) {
                body.image_url = images[0];
            }
            else {
                body.aspect_ratio = ratio(params);
            }
            return body;
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => {
            const rates = lite(params) ? RATES.lite : RATES.standard;
            const images = reference(params) ? Math.min(7, countUploadedImages(params)) : Math.min(1, countUploadedImages(params));
            return rates[resolution(params)] * duration(params) + images * 0.01;
        },
        description: '标准版 480p/720p/1080p $0.08/$0.14/$0.25 每秒，Lite 版 $0.02/$0.03/$0.14 每秒；每张输入或参考图 +$0.01'
    }
});
export default falGrokImagineVideo15Model;
