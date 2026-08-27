import { defineModel } from "../defineModel";
import type { JsonValue, JsonObject } from "../../types/runtime";
const KIE_CREATE_TASK_ENDPOINT = '/api/v1/jobs/createTask';
export const kieGptImage2Model = defineModel({
    meta: {
        id: 'kie-gpt-image-2',
        canonicalModelId: 'gpt-image-2',
        provider: 'kie',
        type: 'image',
        tags: [
            'text-to-image',
            'image-to-image',
            'supports-image-editing',
            'supports-multi-image',
            'reference-mode',
            'supports-4k',
            'provider-kie'
        ],
        aliases: ['gpt-image-2-kie']
    },
    inputLimits: {
        images: { max: 16 },
        videos: { max: 0 }
    },
    params: [
        {
            id: 'kieGptImage2AspectRatio',
            type: 'dropdown',
            order: 1,
            default: 'smart',
            options: [
                { value: 'smart' },
                { value: '1:1' },
                { value: '5:4' },
                { value: '4:3' },
                { value: '3:2' },
                { value: '16:9' },
                { value: '21:9' },
                { value: '4:5' },
                { value: '3:4' },
                { value: '2:3' },
                { value: '9:16' },
                { value: '2:1' },
                { value: '1:2' },
                { value: '3:1' },
                { value: '1:3' },
                { value: '9:21' }
            ]
        },
        {
            id: 'kieGptImage2Resolution',
            type: 'dropdown',
            order: 2,
            default: '1K',
            options: [
                { value: '1K' },
                { value: '2K' },
                { value: '4K' }
            ]
        }
    ],
    endpoints: KIE_CREATE_TASK_ENDPOINT,
    request: {
        builder: (params) => {
            const parseRatio = (raw: string): number | null => {
                const pair = raw.split(':').map(Number);
                if (pair.length !== 2 || !Number.isFinite(pair[0]) || !Number.isFinite(pair[1]) || pair[0] <= 0 || pair[1] <= 0) {
                    return null;
                }
                return pair[0] / pair[1];
            };
            const pickClosestRatio = (target: number): string => {
                const options = ['3:1', '21:9', '2:1', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16', '1:2', '9:21', '1:3'];
                let best = '1:1';
                let bestDiff = Number.POSITIVE_INFINITY;
                for (const ratioText of options) {
                    const ratio = parseRatio(ratioText);
                    if (!ratio) {
                        continue;
                    }
                    const diff = Math.abs(ratio - target);
                    if (diff < bestDiff) {
                        best = ratioText;
                        bestDiff = diff;
                    }
                }
                return best;
            };
            const filterMediaSources = (values: JsonValue): string[] => {
                return Array.isArray(values)
                    ? values.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
                    : [];
            };
            const uploadedFilePaths = filterMediaSources(params.uploadedFilePaths);
            const legacyImages = filterMediaSources(params.images);
            const images = uploadedFilePaths.length > 0 ? uploadedFilePaths : legacyImages;
            const prompt = typeof params.prompt === 'string' ? params.prompt.slice(0, 20000) : '';
            const rawAspectRatio = params.kieGptImage2AspectRatio || params.aspect_ratio;
            const rawResolution = params.kieGptImage2Resolution || params.resolution || '1K';
            const ratioHint = typeof params.__firstImageRatio === 'number' &&
                Number.isFinite(params.__firstImageRatio) &&
                params.__firstImageRatio > 0
                ? params.__firstImageRatio
                : null;
            const aspectRatioText = typeof rawAspectRatio === 'string' ? rawAspectRatio : '';
            const aspectRatio = !aspectRatioText || aspectRatioText === 'smart' || aspectRatioText === 'auto'
                ? (ratioHint ? pickClosestRatio(ratioHint) : '1:1')
                : aspectRatioText;
            const resolution = String(rawResolution);
            const textUnsupportedRatios = ['5:4', '4:5', '3:1', '1:3', '9:21'];
            if (images.length === 0 && (resolution === '2K' || resolution === '4K') && textUnsupportedRatios.includes(aspectRatio)) {
                throw new Error(`GPT Image 2 文生图的 ${aspectRatio} 比例不支持 ${resolution} 分辨率`);
            }
            if (images.length > 0) {
                if ((aspectRatio === '5:4' || aspectRatio === '4:5') && resolution !== '1K') {
                    throw new Error(`GPT Image 2 图生图的 ${aspectRatio} 比例仅支持 1K 分辨率`);
                }
                if (aspectRatio === '1:1' && resolution === '4K') {
                    throw new Error('GPT Image 2 图生图的 1:1 比例不支持 4K 分辨率');
                }
                if ((aspectRatioText === 'auto' || !aspectRatioText) && resolution !== '1K') {
                    throw new Error('GPT Image 2 图生图的自动比例仅支持 1K 分辨率');
                }
            }
            const input: JsonObject = {
                prompt,
                aspect_ratio: aspectRatio,
                resolution
            };
            if (images.length > 0) {
                input.input_urls = images.slice(0, 16);
            }
            return {
                model: images.length > 0 ? 'gpt-image-2-image-to-image' : 'gpt-image-2-text-to-image',
                input
            };
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => {
            const resolution = params.kieGptImage2Resolution || params.resolution;
            if (resolution === '4K')
                return 0.08;
            if (resolution === '2K')
                return 0.05;
            return 0.03;
        },
        description: '1K $0.03 / 2K $0.05 / 4K $0.08'
    }
});
export default kieGptImage2Model;
