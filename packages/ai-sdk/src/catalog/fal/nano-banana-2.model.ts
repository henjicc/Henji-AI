import { defineModel } from "../defineModel";
import type { JsonValue, JsonObject } from "../../types/runtime";
const NANO_BANANA_2_RATIOS = ['21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16', '4:1', '1:4', '8:1', '1:8'] as const;
export const falNanoBanana2Model = defineModel({
    meta: {
        id: 'fal-ai-nano-banana-2', canonicalModelId: 'nano-banana-2', seriesId: 'nano-banana', seriesRank: 2,
        provider: 'fal', type: 'image',
        tags: ['text-to-image', 'image-to-image', 'supports-image-editing', 'supports-multi-image', 'supports-4k', 'provider-fal'],
        aliases: ['nano-banana-2-fal'], polling: { interval: 3000, maxAttempts: 200, expectedAttempts: 40 }
    },
    inputLimits: { images: { max: 14 }, videos: { max: 1 }, audios: { max: 1 } },
    params: [
        {
            id: 'falNanoBanana2AspectRatio', type: 'dropdown', order: 1,
            default: 'smart',
            options: [{ value: 'smart' }, ...NANO_BANANA_2_RATIOS.map((value) => ({ value }))]
        },
        {
            id: 'falNanoBanana2Resolution', type: 'dropdown', order: 2,
            default: '1K',
            options: ['0.5K', '1K', '2K', '4K'].map((value) => ({ value }))
        },
        {
            id: 'falNanoBanana2NumImages', type: 'number', order: 3,
            default: 1, min: 1, max: 4, step: 1
        },
        {
            id: 'falNanoBanana2WebSearch', type: 'switch', order: 4,
            default: false
        },
        {
            id: 'falNanoBanana2Thinking', type: 'dropdown', order: 5,
            default: 'off',
            options: [
                { value: 'off' },
                { value: 'minimal' },
                { value: 'high' }
            ]
        },
        {
            id: 'falNanoBanana2PdfUrl', type: 'file-upload', order: 6,
            default: [],
            valueType: 'array', maxCount: 1, accept: ['application/pdf'], maxSize: 15 * 1024 * 1024
        }
    ],
    runtimeConstraints: { mediaFields: [{ field: 'pdf_url', kind: 'file' }] },
    endpoints: {
        selector: async (params) => {
            const sources = ['uploadedFilePaths', 'images', 'uploadedVideoFilePaths', 'videos', 'uploadedAudioFilePaths', 'audios'];
            const hasMedia = sources.some((key) => Array.isArray(params[key]) && params[key].length > 0);
            const pdfValues = Array.isArray(params.falNanoBanana2PdfUrl)
                ? params.falNanoBanana2PdfUrl
                : [params.falNanoBanana2PdfUrl];
            const hasPdf = pdfValues.some((item) => typeof item === 'string' && item.trim().length > 0);
            return hasMedia || hasPdf
                ? 'fal-ai/nano-banana-2/edit' : 'fal-ai/nano-banana-2';
        }
    },
    request: {
        builder: (params) => {
            const clean = (value: JsonValue): string[] => Array.isArray(value)
                ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
            const pick = (primary: JsonValue, fallback: JsonValue): string[] => {
                const first = clean(primary);
                return first.length > 0 ? first : clean(fallback);
            };
            const images = pick(params.uploadedFilePaths, params.images);
            const videos = pick(params.uploadedVideoFilePaths, params.videos);
            const audios = pick(params.uploadedAudioFilePaths, params.audios);
            const ratios = ['21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16', '4:1', '1:4', '8:1', '1:8'];
            const raw = String(params.falNanoBanana2AspectRatio || 'smart');
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
            const resolution = ['0.5K', '2K', '4K'].includes(String(params.falNanoBanana2Resolution))
                ? String(params.falNanoBanana2Resolution) : '1K';
            const body: JsonObject = {
                prompt: typeof params.prompt === 'string' ? params.prompt : '',
                aspect_ratio: images.length > 0 && raw === 'smart' ? 'auto' : ratio,
                resolution,
                num_images: Math.min(4, Math.max(1, Math.round(Number(params.falNanoBanana2NumImages || 1)))),
                limit_generations: true,
                enable_web_search: params.falNanoBanana2WebSearch === true
            };
            if (params.falNanoBanana2Thinking === 'minimal' || params.falNanoBanana2Thinking === 'high') {
                body.thinking_level = params.falNanoBanana2Thinking;
            }
            if (images.length > 0)
                body.image_urls = images.slice(0, 14);
            if (videos.length > 0)
                body.video_url = videos[0];
            if (audios.length > 0)
                body.audio_url = audios[0];
            const pdfCandidates = Array.isArray(params.falNanoBanana2PdfUrl)
                ? params.falNanoBanana2PdfUrl
                : [params.falNanoBanana2PdfUrl];
            const pdfValue = pdfCandidates.find((item) => typeof item === 'string' && item.trim().length > 0);
            const pdfUrl = typeof pdfValue === 'string' ? pdfValue.trim() : '';
            if (pdfUrl)
                body.pdf_url = pdfUrl;
            return body;
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => {
            const resolution = String(params.falNanoBanana2Resolution || '1K');
            const multiplier: Record<string, number> = { '0.5K': 0.75, '1K': 1, '2K': 1.5, '4K': 2 };
            const count = Math.min(4, Math.max(1, Math.round(Number(params.falNanoBanana2NumImages || 1))));
            const search = params.falNanoBanana2WebSearch === true ? 0.015 : 0;
            const thinking = params.falNanoBanana2Thinking === 'high' ? 0.002 : 0;
            return count * 0.08 * (multiplier[resolution] ?? 1) + search + thinking;
        },
        description: '1K $0.08/张；0.5K×0.75、2K×1.5、4K×2；联网搜索 +$0.015，高思考 +$0.002'
    }
});
export default falNanoBanana2Model;
