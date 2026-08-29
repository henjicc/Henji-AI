import { defineModel } from "../defineModel";
import type { JsonObject } from "../../types/runtime";
import { resolveKieImageSources } from './mediaSources';
const KIE_CREATE_TASK_ENDPOINT = '/api/v1/jobs/createTask';

type Hailuo23Mode = 'standard' | 'pro';
type Hailuo23Resolution = '768P' | '1080P';

function resolveHailuo23Spec(params: JsonObject): {
    mode: Hailuo23Mode;
    duration: 6 | 10;
    resolution: Hailuo23Resolution;
} {
    const mode: Hailuo23Mode = params.kieHailuo23Mode === 'pro' || params.mode === 'pro'
        ? 'pro'
        : 'standard';
    const duration: 6 | 10 = Number(params.kieHailuo23Duration ?? params.duration) === 10 ? 10 : 6;
    const requestedResolution = params.kieHailuo23Resolution ?? params.resolution;
    // KIE 的 1080P 只有 6 秒档，10 秒历史参数统一回收到 768P。
    const resolution: Hailuo23Resolution = duration === 6 && requestedResolution === '1080P'
        ? '1080P'
        : '768P';
    return { mode, duration, resolution };
}

export const kieHailuo23Model = defineModel({
    meta: {
        id: 'kie-hailuo-2-3',
        canonicalModelId: 'hailuo-2.3',
        seriesId: 'hailuo',
        seriesRank: 2.3,
        provider: 'kie',
        type: 'video',
        tags: ['image-to-video', 'provider-kie'],
        aliases: ['hailuo-2-3-kie'],
        polling: {
            interval: 3000,
            maxAttempts: 120,
            expectedAttempts: 40
        }
    },
    inputLimits: {
        images: { exact: 1 },
        videos: { max: 0 }
    },
    requirements: [
        {
            id: 'hailuo-2-3-image',
            require: { images: { exact: 1 } },
            message: {
                title: '图片必需',
                message: '海螺 2.3 是图生视频模型，必须上传1张图片才能生成',
                type: 'warning'
            }
        },
        {
            id: 'hailuo-2-3-prompt',
            require: { prompt: true },
            message: {
                title: '提示词必需',
                message: '请输入提示词描述期望的视频效果',
                type: 'warning'
            }
        }
    ],
    params: [
        {
            id: 'kieHailuo23Mode',
            type: 'dropdown',
            order: 1,
            default: 'standard',
            options: [
                { value: 'standard' },
                { value: 'pro' }
            ]
        },
        {
            id: 'kieHailuo23Duration',
            type: 'dropdown',
            order: 2,
            default: 6,
            options: [
                { value: 6 },
                { value: 10 }
            ]
        },
        {
            id: 'kieHailuo23Resolution',
            type: 'dropdown',
            order: 3,
            default: '768P',
            options: [
                { value: '768P' },
                { value: '1080P' }
            ]
        }
    ],
    endpoints: KIE_CREATE_TASK_ENDPOINT,
    request: {
        builder: (params) => {
            const images = resolveKieImageSources(params);
            const prompt = params.prompt || '';
            const { mode, duration, resolution } = resolveHailuo23Spec(params);
            const model = mode === 'pro'
                ? 'hailuo/2-3-image-to-video-pro'
                : 'hailuo/2-3-image-to-video-standard';
            return {
                model,
                input: {
                    prompt,
                    image_url: images.length > 0 ? images[0] : '',
                    duration: String(duration),
                    resolution
                }
            };
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => {
            const { mode, duration, resolution } = resolveHailuo23Spec(params);
            const standardPrices: Record<string, number> = { '6-768P': 0.15, '10-768P': 0.25, '6-1080P': 0.25 };
            const proPrices: Record<string, number> = { '6-768P': 0.225, '10-768P': 0.45, '6-1080P': 0.4 };
            const key = `${duration}-${resolution}`;
            const price = (mode === 'pro' ? proPrices : standardPrices)[key];
            if (price === undefined) {
                throw new Error(`Hailuo 2.3 缺少 ${mode} ${key} 的 KIE 价格`);
            }
            return price;
        },
        description: 'Standard：6s768P $0.15、10s768P $0.25、6s1080P $0.25；Pro：6s768P $0.225、10s768P $0.45、6s1080P $0.4'
    }
});
export default kieHailuo23Model;
