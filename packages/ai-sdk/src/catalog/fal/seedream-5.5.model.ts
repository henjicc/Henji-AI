import { defineModel } from "../defineModel";
import type { JsonObject } from "../../types/runtime";
import { countUploadedImages, resolveUploadedImageSources } from "../shared/mediaPresence";
import { parseSeedreamLayerStack } from "../../structured-output";
import { FAL_COMMON_IMAGE_RATIOS } from './imageSizing';

// 字段与价格来源：docs/model-adaptation/Seedream-5.5/Seedream-5.5_Fal.md（Fal 模型页与 OpenAPI，2026-11-14 读取）
const RESOLUTIONS = ['1K', '1.5K', '2K'] as const;
const LAYER_SIZES = ['auto', '1K', '1.5K', '2K'] as const;
const LONG_SIDE: Record<string, number> = { '1K': 1024, '1.5K': 1536, '2K': 2048 };
// 图层结果契约只认底图加 16 层；Fal 默认最多返回 30 张，超出会让整份结果作废，所以固定按上限请求。
const LAYER_MAX_IMAGES = 17;
const INPUT_IMAGE_FEE = 0.012;

const isLayerMode = (params: JsonObject): boolean => params.falSeedream55Mode === 'layer-decomposition';

function choice<T extends string | number>(value: unknown, values: readonly T[], fallback: T): T {
    return values.includes(value as T) ? value as T : fallback;
}

function count(params: JsonObject): number {
    return Math.min(6, Math.max(1, Math.round(Number(params.falSeedream55NumImages) || 1)));
}

/** 智能比例取第一张图最接近的支持比例，没有图时用 1:1；再按档位面积换成具体宽高。 */
function imageSize(params: JsonObject): JsonObject {
    const raw = String(params.falSeedream55AspectRatio || 'smart');
    const ratios: readonly string[] = FAL_COMMON_IMAGE_RATIOS;
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
    const side = LONG_SIDE[choice(params.falSeedream55Resolution, RESOLUTIONS, '2K')];
    return {
        width: Math.round(Math.sqrt(side * side * ratio) / 16) * 16,
        height: Math.round(Math.sqrt(side * side / ratio) / 16) * 16
    };
}

export const falSeedream55Model = defineModel({
    meta: {
        id: 'fal-ai-seedream-5.5', canonicalModelId: 'seedream-5.5', seriesId: 'seedream', seriesRank: 5.5,
        provider: 'fal', type: 'image',
        tags: ['text-to-image', 'image-to-image', 'layer-decomposition', 'transparent-background'],
        polling: { interval: 3000, maxAttempts: 180, expectedAttempts: 35 }
    },
    inputLimits: {
        images: { max: 10 }, videos: { max: 0 },
        rules: [
            { when: 'falSeedream55Mode === "layer-decomposition"', images: { min: 1, max: 1 } }
        ]
    },
    requirements: [
        {
            id: 'fal-seedream-5.5-layer-single-image',
            when: 'falSeedream55Mode === "layer-decomposition"',
            require: { images: { exact: 1 } },
            message: { title: '需要一张图片', message: '图层拆分模式必须且只能输入 1 张图片。', type: 'warning' }
        }
    ],
    params: [
        {
            id: 'falSeedream55Mode', type: 'dropdown', order: 1,
            transferKey: 'layer-decomposition-mode',
            default: 'generate',
            options: [{ value: 'generate' }, { value: 'layer-decomposition' }]
        },
        {
            id: 'falSeedream55AspectRatio', type: 'dropdown', order: 2,
            default: 'smart',
            visible: { condition: (params: JsonObject) => !isLayerMode(params) },
            options: [{ value: 'smart' }, ...FAL_COMMON_IMAGE_RATIOS.map((value) => ({ value }))]
        },
        {
            id: 'falSeedream55Resolution', type: 'dropdown', order: 3,
            default: '2K',
            visible: { condition: (params: JsonObject) => !isLayerMode(params) },
            options: RESOLUTIONS.map((value) => ({ value }))
        },
        {
            id: 'falSeedream55LayerSize', type: 'dropdown', order: 4,
            transferKey: 'layer-output-size',
            default: 'auto',
            visible: { condition: isLayerMode },
            options: LAYER_SIZES.map((value) => ({ value }))
        },
        {
            id: 'falSeedream55NumImages', type: 'number', order: 5,
            default: 1, min: 1, max: 6, step: 1,
            visible: { condition: (params: JsonObject) => !isLayerMode(params) }
        },
        {
            id: 'falSeedream55Background', type: 'dropdown', order: 6,
            default: 'auto',
            visible: { condition: (params: JsonObject) => !isLayerMode(params) },
            options: [{ value: 'auto' }, { value: 'opaque' }, { value: 'transparent' }]
        }
    ],
    endpoints: {
        selector: async (params) => {
            if (isLayerMode(params))
                return 'bytedance/seedream/v5.5/layerize';
            return countUploadedImages(params) > 0 ? 'bytedance/seedream/v5.5/edit' : 'bytedance/seedream/v5.5/text-to-image';
        }
    },
    request: {
        builder: (params) => {
            const prompt = typeof params.prompt === 'string' ? params.prompt : '';
            const images = resolveUploadedImageSources(params);
            if (isLayerMode(params)) {
                if (images.length !== 1)
                    throw new Error('Seedream 5.5 图层拆分模式必须且只能输入 1 张图片');
                const size = choice(params.falSeedream55LayerSize, LAYER_SIZES, 'auto');
                return {
                    prompt,
                    image_url: images[0],
                    image_size: size === 'auto' ? 'auto' : `auto_${size}`,
                    max_images: LAYER_MAX_IMAGES
                };
            }
            if (images.length > 10)
                throw new Error('Seedream 5.5 最多接受 10 张参考图');
            const body: JsonObject = {
                prompt,
                image_size: imageSize(params),
                num_images: count(params),
                background: choice(params.falSeedream55Background, ['auto', 'opaque', 'transparent'], 'auto')
            };
            if (images.length > 0)
                body.image_urls = images;
            return body;
        }
    },
    response: {
        structuredOutput: ({ metadata, params }) => isLayerMode(params)
            ? parseSeedreamLayerStack('fal', metadata)
            : undefined
    },
    pricing: {
        currency: '$',
        calculator: (params) => {
            // 图层数由模型按画面决定，提交前不知道会返回几张，给不出可靠总价。
            if (isLayerMode(params))
                return Number.NaN;
            const output = params.falSeedream55Resolution === '1K' || params.falSeedream55Resolution === '1.5K' ? 0.03 : 0.0405;
            return count(params) * (output + countUploadedImages(params) * INPUT_IMAGE_FEE);
        },
        description: '生成/编辑：1K/1.5K $0.03、2K $0.0405/张，编辑另按每张输出 × 每张输入图 $0.012；图层拆分按实际返回的底图与各层计费（1K/1.5K $0.03、2K $0.0405/张，自动档按底图像素 ≤261 万 $0.03、以上 $0.0405），另加输入图 $0.012/次，提交前总价暂不可估算'
    }
});
export default falSeedream55Model;
