import { defineModel } from "../defineModel";
import type { JsonObject } from "../../types/runtime";
import { countUploadedImages, resolveUploadedImageSources } from "../shared/mediaPresence";

// 字段与价格来源：docs/model-adaptation/MiniMax-H3-Image/MiniMax-H3-Image_Fal.md（Fal 模型页与 OpenAPI，2026-11-14 读取）
// 官方比例上下限为 1:3–3:1，以下比例都在范围内。
const RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'] as const;
const RESOLUTIONS = ['1K', '2K', '4K'] as const;
const LONG_SIDE: Record<string, number> = { '1K': 1024, '2K': 2048, '4K': 4096 };
// 按 token 计费：每百万 token 美元价。highspeed 只把输出图片 token 与输入图片 token 翻倍。
const RATES = {
    standard: { text: 2.3, outputImage: 3.8, inputImage: 1.5 },
    highspeed: { text: 2.3, outputImage: 7.6, inputImage: 3.0 }
} as const;
// 模型页给的经验值：输出约每 1024 像素 1 个 token（2K 约 4100、4K 约 16400），每张输入图约 2050 个 token。
const PIXELS_PER_OUTPUT_TOKEN = 1024;
const TOKENS_PER_INPUT_IMAGE = 2050;
// 扩写后的提示词计入输入文本 token，官方未给长度；按约 4000 token 估（2K 单张合计约 $0.025，与 MiniMax 官价 $0.0236 接近），宁高勿低。
const EXPANDED_PROMPT_TOKENS = 4000;

const isHighspeed = (params: JsonObject): boolean => params.falMiniMaxH3ImageVersion === 'highspeed';

function choice<T extends string | number>(value: unknown, values: readonly T[], fallback: T): T {
    return values.includes(value as T) ? value as T : fallback;
}

function count(params: JsonObject): number {
    return Math.min(10, Math.max(1, Math.round(Number(params.falMiniMaxH3ImageNumImages) || 1)));
}

/** 智能比例取第一张图最接近的支持比例，没有图时用 1:1；再按档位面积换成具体宽高。 */
function imageSize(params: JsonObject): { width: number; height: number } {
    const raw = String(params.falMiniMaxH3ImageAspectRatio || 'smart');
    const ratios: readonly string[] = RATIOS;
    const hint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0 ? params.__firstImageRatio : 1;
    let ratioText = ratios.includes(raw) ? raw : '1:1';
    if (!ratios.includes(raw)) {
        let difference = Number.POSITIVE_INFINITY;
        for (const candidate of ratios) {
            const pair = candidate.split(':').map(Number);
            const next = Math.abs(pair[0] / pair[1] - hint);
            if (next < difference) {
                difference = next;
                ratioText = candidate;
            }
        }
    }
    const pair = ratioText.split(':').map(Number);
    const ratio = pair[0] / pair[1];
    const side = LONG_SIDE[choice(params.falMiniMaxH3ImageResolution, RESOLUTIONS, '2K')];
    return {
        width: Math.round(Math.sqrt(side * side * ratio) / 16) * 16,
        height: Math.round(Math.sqrt(side * side / ratio) / 16) * 16
    };
}

export const falMiniMaxH3ImageModel = defineModel({
    meta: {
        id: 'fal-ai-minimax-h3-image', canonicalModelId: 'minimax-h3-image', seriesId: 'minimax-image', seriesRank: 3,
        provider: 'fal', type: 'image',
        tags: ['text-to-image', 'image-to-image'],
        polling: { interval: 3000, maxAttempts: 200, expectedAttempts: 30 }
    },
    inputLimits: { images: { max: 16 }, videos: { max: 0 } },
    params: [
        {
            id: 'falMiniMaxH3ImageVersion', type: 'dropdown', order: 1,
            default: 'standard',
            options: [{ value: 'standard' }, { value: 'highspeed' }]
        },
        {
            id: 'falMiniMaxH3ImageAspectRatio', type: 'dropdown', order: 2,
            default: 'smart',
            options: [{ value: 'smart' }, ...RATIOS.map((value) => ({ value }))]
        },
        {
            id: 'falMiniMaxH3ImageResolution', type: 'dropdown', order: 3,
            default: '2K',
            options: RESOLUTIONS.map((value) => ({ value }))
        },
        {
            id: 'falMiniMaxH3ImageNumImages', type: 'number', order: 4,
            default: 1, min: 1, max: 10, step: 1
        },
        {
            // 编辑端点始终扩写提示词，没有这个开关。
            id: 'falMiniMaxH3ImagePromptExpansion', type: 'switch', order: 5,
            default: true,
            visible: { condition: (params: JsonObject) => countUploadedImages(params) === 0 }
        }
    ],
    endpoints: {
        selector: async (params) => {
            const prefix = isHighspeed(params) ? 'minimax/h3-image/highspeed' : 'minimax/h3-image';
            return countUploadedImages(params) > 0 ? `${prefix}/edit` : `${prefix}/text-to-image`;
        }
    },
    request: {
        builder: (params) => {
            const prompt = typeof params.prompt === 'string' ? params.prompt.trim() : '';
            if (!prompt)
                throw new Error('MiniMax H3 Image 的提示词不能为空');
            const images = resolveUploadedImageSources(params);
            if (images.length > 16)
                throw new Error('MiniMax H3 Image 最多接受 16 张参考图');
            const body: JsonObject = {
                prompt,
                image_size: imageSize(params),
                num_images: count(params)
            };
            if (images.length > 0)
                body.image_urls = images;
            else
                body.enable_prompt_expansion = params.falMiniMaxH3ImagePromptExpansion !== false;
            return body;
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => {
            const rates = isHighspeed(params) ? RATES.highspeed : RATES.standard;
            const { width, height } = imageSize(params);
            const output = count(params) * (width * height / PIXELS_PER_OUTPUT_TOKEN) * rates.outputImage;
            const inputs = countUploadedImages(params);
            const expanded = inputs > 0 || params.falMiniMaxH3ImagePromptExpansion !== false;
            const promptTokens = expanded ? EXPANDED_PROMPT_TOKENS : Math.max(1, String(params.prompt ?? '').length);
            return (output + inputs * TOKENS_PER_INPUT_IMAGE * rates.inputImage + promptTokens * rates.text) / 1_000_000;
        },
        description: '按 token 计费，此处为估价：标准版输出图片 $3.80/百万 token（2K 约 $0.016/张、4K 约 $0.062/张），编辑时输入图 $1.50/百万 token（约 $0.003/张）；提示词文本 $2.30/百万 token（扩写后约 $0.009/次）；Highspeed 输出与输入图单价翻倍'
    }
});
export default falMiniMaxH3ImageModel;
