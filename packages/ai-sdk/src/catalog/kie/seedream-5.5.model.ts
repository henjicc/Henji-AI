import { defineModel } from "../defineModel";
import type { JsonObject } from "../../types/runtime";
import { countUploadedImages, resolveKieImageSources } from './mediaSources';
import { parseSeedreamLayerStack } from '../../structured-output';

// 字段与价格来源：docs/model-adaptation/Seedream-5.5/Seedream-5.5_KIE.md（KIE 文档与 kie.ai/pricing，2026-11-14 读取）
const RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'] as const;
const RESOLUTIONS = ['1K', '1.5K', '2K'] as const;
const LAYER_SIZES = ['auto', '1K', '1.5K', '2K'] as const;
const BACKGROUNDS = ['auto', 'opaque', 'transparent'] as const;
// 图层结果契约只认底图加 16 层；官方默认最多返回 30 张，超出会让整份结果作废，所以固定按上限请求。
const LAYER_MAX_IMAGES = 17;
// 1 credit = $0.005：输出 1K/1.5K 3.6 credits、2K 6.3 credits，每张输入图 1.44 credits。
const OUTPUT_PRICE: Record<string, number> = { '1K': 0.018, '1.5K': 0.018, '2K': 0.0315 };
const INPUT_IMAGE_PRICE = 0.0072;

const isLayerMode = (params: JsonObject): boolean => params.kieSeedream55Mode === 'layer-decomposition';

function choice<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
    return values.includes(value as T) ? value as T : fallback;
}

/** 智能比例取第一张图最接近的支持比例，没有图时用 1:1；有参考图却读不到其比例时交给图生图端点的 auto，避免按 1:1 裁掉画面。 */
function aspectRatio(params: JsonObject): string {
    const raw = String(params.kieSeedream55AspectRatio || 'smart');
    const ratios: readonly string[] = RATIOS;
    if (ratios.includes(raw))
        return raw;
    const known = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0;
    // 与端点选择同一取图口径：只有真的走图生图端点时才能发 auto。
    if (!known && resolveKieImageSources(params).length > 0)
        return 'auto';
    const hint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0 ? params.__firstImageRatio : 1;
    const value = (ratio: string) => { const [w, h] = ratio.split(':').map(Number); return w / h; };
    return ratios.reduce((best, next) => Math.abs(value(next) - hint) < Math.abs(value(best) - hint) ? next : best, '1:1');
}

export const kieSeedream55Model = defineModel({
    meta: {
        id: 'kie-seedream-5.5', canonicalModelId: 'seedream-5.5', seriesId: 'seedream', seriesRank: 5.5,
        provider: 'kie', type: 'image',
        tags: ['text-to-image', 'image-to-image', 'layer-decomposition', 'transparent-background'],
        polling: { interval: 3000, maxAttempts: 200 }
    },
    inputLimits: {
        images: { max: 10 }, videos: { max: 0 },
        rules: [
            { when: 'kieSeedream55Mode === "layer-decomposition"', images: { min: 1, max: 1 } }
        ]
    },
    requirements: [
        {
            id: 'kie-seedream-5.5-layer-single-image',
            when: 'kieSeedream55Mode === "layer-decomposition"',
            require: { images: { exact: 1 } },
            message: { title: '需要一张图片', message: '图层拆分模式必须且只能输入 1 张图片。', type: 'warning' }
        }
    ],
    params: [
        {
            id: 'kieSeedream55Mode', type: 'dropdown', order: 1,
            transferKey: 'layer-decomposition-mode',
            default: 'generate',
            options: [{ value: 'generate' }, { value: 'layer-decomposition' }]
        },
        {
            id: 'kieSeedream55AspectRatio', type: 'dropdown', order: 2,
            default: 'smart',
            visible: { condition: (params: JsonObject) => !isLayerMode(params) },
            options: [{ value: 'smart' }, ...RATIOS.map((value) => ({ value }))]
        },
        {
            id: 'kieSeedream55Resolution', type: 'dropdown', order: 3,
            default: '2K',
            visible: { condition: (params: JsonObject) => !isLayerMode(params) },
            options: RESOLUTIONS.map((value) => ({ value }))
        },
        {
            id: 'kieSeedream55LayerSize', type: 'dropdown', order: 4,
            transferKey: 'layer-output-size',
            default: 'auto',
            visible: { condition: isLayerMode },
            options: LAYER_SIZES.map((value) => ({ value }))
        },
        {
            id: 'kieSeedream55Background', type: 'dropdown', order: 5,
            default: 'auto',
            visible: { condition: (params: JsonObject) => !isLayerMode(params) },
            options: BACKGROUNDS.map((value) => ({ value }))
        }
    ],
    endpoints: '/api/v1/jobs/createTask',
    request: {
        builder: (params) => {
            const prompt = typeof params.prompt === 'string' ? params.prompt.trim() : '';
            const images = resolveKieImageSources(params);
            if (isLayerMode(params)) {
                if (images.length !== 1)
                    throw new Error('Seedream 5.5 图层拆分模式必须且只能输入 1 张图片');
                if (prompt.length > 2000)
                    throw new Error('Seedream 5.5 图层拆分的提示词最多 2000 字符');
                return {
                    model: 'seedream/5-5-layer-decomposition',
                    input: {
                        prompt,
                        image_url: images[0],
                        size: choice(params.kieSeedream55LayerSize, LAYER_SIZES, 'auto'),
                        max_images: LAYER_MAX_IMAGES
                    }
                };
            }
            if (prompt.length < 5 || prompt.length > 5000)
                throw new Error('Seedream 5.5 提示词需要 5–5000 个字符');
            if (images.length > 10)
                throw new Error('Seedream 5.5 最多接受 10 张参考图');
            // 官方默认输出 PNG，透明背景依赖 PNG，因此不发送 output_format。
            const input: JsonObject = {
                prompt,
                aspect_ratio: aspectRatio(params),
                size: choice(params.kieSeedream55Resolution, RESOLUTIONS, '2K'),
                background: choice(params.kieSeedream55Background, BACKGROUNDS, 'auto')
            };
            if (images.length > 0)
                input.image_urls = images;
            return {
                model: images.length > 0 ? 'seedream/5-5-image-to-image' : 'seedream/5-5-text-to-image',
                input
            };
        }
    },
    response: {
        structuredOutput: ({ metadata, params }) => isLayerMode(params)
            ? parseSeedreamLayerStack('kie', metadata)
            : undefined
    },
    pricing: {
        currency: '$',
        calculator: (params) => {
            // 图层数由模型按画面决定，提交前不知道会返回几张，给不出可靠总价。
            if (isLayerMode(params))
                return Number.NaN;
            return OUTPUT_PRICE[choice(params.kieSeedream55Resolution, RESOLUTIONS, '2K')] + countUploadedImages(params) * INPUT_IMAGE_PRICE;
        },
        description: '生成/编辑：1K/1.5K $0.018、2K $0.0315/张，每张输入图另加 $0.0072；图层拆分按实际返回的底图与各层计费（1K/1.5K $0.018、2K 与自动档 $0.0315/张），另加输入图 $0.0072，提交前总价暂不可估算'
    }
});
export default kieSeedream55Model;
