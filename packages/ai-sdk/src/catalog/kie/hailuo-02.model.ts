import { defineModel } from "../defineModel";
import type { JsonObject } from "../../types/runtime";
import { resolveKieImageSources } from './mediaSources';
const KIE_CREATE_TASK_ENDPOINT = '/api/v1/jobs/createTask';

type Hailuo02Resolution = '512P' | '768P' | '1080P';

function resolveHailuo02Spec(params: JsonObject) {
    const images = resolveKieImageSources(params);
    const duration = Number(params.kieHailuo02Duration ?? params.duration) === 10 ? 10 : 6;
    const requestedResolution = String(params.kieHailuo02Resolution ?? params.resolution ?? '768P');
    let resolution: Hailuo02Resolution = requestedResolution === '512P' || requestedResolution === '1080P'
        ? requestedResolution
        : '768P';

    // KIE 的 512P 只属于 Standard 图生视频；文生视频 Standard 固定按 768P 请求/计价。
    if (images.length === 0 && resolution === '512P') {
        resolution = '768P';
    }
    // 1080P 只有 6 秒 Pro 档，历史工程的 10s + 1080P 回收到合法的 10s + 768P。
    if (duration === 10 && resolution === '1080P') {
        resolution = '768P';
    }

    return {
        images,
        duration,
        resolution,
        usePro: duration === 6 && resolution === '1080P'
    };
}

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
            const { images, duration, resolution, usePro } = resolveHailuo02Spec(params);
            const prompt = params.prompt || '';
            const promptOptimizer = params.kieHailuo02PromptOptimizer ?? params.prompt_optimizer ?? false;
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
            const { duration, resolution, usePro } = resolveHailuo02Spec(params);
            if (usePro)
                return 0.285;
            return (resolution === '512P' ? 0.01 : 0.025) * duration;
        },
        description: 'Standard：文生固定 768P $0.025/秒，图生 768P $0.025/秒、512P $0.010/秒；Pro（1080P 固定 6 秒）：$0.285/条'
    }
});
export default kieHailuo02Model;
