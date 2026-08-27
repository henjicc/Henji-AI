import { defineModel } from "../defineModel";
import type { JsonValue, JsonObject } from "../../types/runtime";
import { resolveKieImageSources } from './mediaSources';
const KIE_CREATE_TASK_ENDPOINT = '/api/v1/jobs/createTask';
export const kieHailuo02Model = defineModel({
    meta: {
        id: 'kie-hailuo-02',
        canonicalModelId: 'hailuo-02',
        seriesId: 'hailuo',
        seriesRank: 2.0,
        provider: 'kie',
        type: 'video',
        tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'provider-kie'],
        aliases: ['hailuo-02-kie'],
        polling: {
            interval: 3000,
            maxAttempts: 120,
            expectedAttempts: 40
        }
    },
    inputLimits: {
        images: { max: 2 },
        videos: { max: 0 }
    },
    params: [
        {
            id: 'kieHailuo02Duration',
            type: 'dropdown',
            order: 1,
            default: 6,
            options: [
                { value: 6 },
                { value: 10 }
            ]
        },
        {
            id: 'kieHailuo02Resolution',
            type: 'dropdown',
            order: 2,
            default: '768P',
            options: [
                { value: '512P' },
                { value: '768P' },
                { value: '1080P' }
            ]
        },
        {
            id: 'kieHailuo02PromptOptimizer',
            type: 'switch',
            order: 3,
            default: true
        }
    ],
    endpoints: KIE_CREATE_TASK_ENDPOINT,
    request: {
        builder: (params) => {
            const images = resolveKieImageSources(params);
            const prompt = params.prompt || '';
            const duration = params.kieHailuo02Duration || params.duration || 6;
            const resolution = params.kieHailuo02Resolution || params.resolution || '768P';
            const promptOptimizer = params.kieHailuo02PromptOptimizer ?? params.prompt_optimizer ?? false;
            const usePro = duration === 6 && resolution === '1080P';
            let model: string;
            if (images.length === 0) {
                model = usePro
                    ? 'hailuo/02-text-to-video-pro'
                    : 'hailuo/02-text-to-video-standard';
            }
            else {
                model = usePro
                    ? 'hailuo/02-image-to-video-pro'
                    : 'hailuo/02-image-to-video-standard';
            }
            const input: JsonObject = { prompt };
            if (images.length > 0) {
                input.image_url = images[0];
                if (images.length > 1) {
                    input.end_image_url = images[1];
                }
            }
            if (!usePro) {
                input.duration = String(duration);
                if (images.length > 0) {
                    input.resolution = resolution;
                }
            }
            if (promptOptimizer) {
                input.prompt_optimizer = true;
            }
            return {
                model,
                input
            };
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => {
            const duration = Number(params.kieHailuo02Duration) || 6;
            const resolution = params.kieHailuo02Resolution || '768P';
            const usePro = duration === 6 && resolution === '1080P';
            if (usePro)
                return 0.0475 * duration;
            return (resolution === '512P' ? 0.01 : 0.025) * duration;
        },
        description: 'Standard：768P $0.025/秒，512P $0.010/秒；Pro（1080P 固定 6 秒）：$0.0475/秒'
    }
});
export default kieHailuo02Model;
