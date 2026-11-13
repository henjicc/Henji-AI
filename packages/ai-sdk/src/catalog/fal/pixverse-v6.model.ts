import { defineModel } from "../defineModel";
import type { JsonObject } from "../../types/runtime";
import { countUploadedImages, resolveUploadedImageSources, resolveUploadedVideoSources } from "../shared/mediaPresence";

// 字段与价格来源：docs/model-adaptation/PixVerse-V6/PixVerse-V6_Fal.md（Fal 模型页与 OpenAPI，2026-11-14 读取）
const RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16', '2:3', '3:2', '21:9'] as const;
const RESOLUTIONS = ['360p', '540p', '720p', '1080p'] as const;
const STYLES = ['anime', '3d_animation', 'clay', 'comic', 'cyberpunk'] as const;
// 每秒美元价：[无音频, 有音频]。
const RATES: Record<'standard' | 'max', Record<string, [number, number]>> = {
    standard: { '360p': [0.025, 0.035], '540p': [0.035, 0.045], '720p': [0.045, 0.06], '1080p': [0.09, 0.115] },
    max: { '360p': [0.054, 0.081], '540p': [0.081, 0.099], '720p': [0.099, 0.135], '1080p': [0.198, 0.252] }
};

const isMax = (params: JsonObject): boolean => params.falPixverseV6Version === 'max';
// Max 只有文生与图生两个端点，没有续写。
const isExtension = (params: JsonObject): boolean => !isMax(params) && params.falPixverseV6Mode === 'video-extension';
const imageCount = (params: JsonObject): number => isExtension(params) ? 0 : countUploadedImages(params);

function choice<T extends string | number>(value: unknown, values: readonly T[], fallback: T): T {
    return values.includes(value as T) ? value as T : fallback;
}

function duration(params: JsonObject): number {
    const value = Math.round(Number(params.falPixverseV6Duration));
    return Number.isFinite(value) ? Math.min(15, Math.max(1, value)) : 5;
}

/** 智能比例按第一张图匹配最接近的支持比例，没有图时用 1:1。 */
function aspectRatio(params: JsonObject): string {
    const raw = String(params.falPixverseV6AspectRatio || '16:9');
    const ratios: readonly string[] = RATIOS;
    if (ratios.includes(raw))
        return raw;
    const hint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0 ? params.__firstImageRatio : 1;
    let closest = '1:1';
    let difference = Number.POSITIVE_INFINITY;
    for (const candidate of ratios) {
        const pair = candidate.split(':').map(Number);
        const next = Math.abs(pair[0] / pair[1] - hint);
        if (next < difference) {
            difference = next;
            closest = candidate;
        }
    }
    return closest;
}

export const falPixverseV6Model = defineModel({
    meta: {
        id: 'fal-ai-pixverse-v6', canonicalModelId: 'pixverse-v6', seriesId: 'pixverse', seriesRank: 6,
        provider: 'fal', type: 'video',
        tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'video-extension'],
        polling: { interval: 3000, maxAttempts: 300, expectedAttempts: 40 }
    },
    inputLimits: {
        images: { max: 2 }, videos: { max: 0 },
        rules: [
            { when: 'falPixverseV6Version === "max"', images: { max: 1 }, videos: { max: 0 } },
            { when: 'falPixverseV6Version !== "max" && falPixverseV6Mode === "video-extension"', images: { max: 0 }, videos: { exact: 1 } }
        ]
    },
    requirements: [
        {
            id: 'fal-pixverse-v6-source-video',
            when: 'falPixverseV6Version !== "max" && falPixverseV6Mode === "video-extension"',
            require: { videos: { exact: 1 } },
            message: { title: '视频必需', message: '视频续写需要上传 1 个视频', type: 'warning' }
        }
    ],
    params: [
        {
            id: 'falPixverseV6Version', type: 'dropdown', order: 1,
            default: 'standard',
            options: [{ value: 'standard' }, { value: 'max' }]
        },
        {
            id: 'falPixverseV6Mode', type: 'dropdown', order: 2,
            default: 'text-image-to-video',
            visible: { condition: (params: JsonObject) => !isMax(params) },
            options: [{ value: 'text-image-to-video' }, { value: 'video-extension' }]
        },
        {
            id: 'falPixverseV6AspectRatio', type: 'dropdown', order: 3,
            default: '16:9',
            // 单图生视频跟随首图比例，续写跟随原视频，这两个端点都没有比例字段。
            visible: { condition: (params: JsonObject) => !isExtension(params) && imageCount(params) !== 1 },
            options: [{ value: 'smart' }, ...RATIOS.map((value) => ({ value }))]
        },
        {
            id: 'falPixverseV6Resolution', type: 'dropdown', order: 4,
            default: '720p',
            options: RESOLUTIONS.map((value) => ({ value }))
        },
        {
            id: 'falPixverseV6Duration', type: 'number', order: 5,
            default: 5, min: 1, max: 15, step: 1
        },
        {
            id: 'falPixverseV6Style', type: 'dropdown', order: 6,
            default: 'none',
            options: [{ value: 'none' }, ...STYLES.map((value) => ({ value }))]
        },
        {
            id: 'falPixverseV6ThinkingType', type: 'dropdown', order: 7,
            default: 'auto',
            visible: { condition: (params: JsonObject) => !isExtension(params) },
            options: [{ value: 'auto' }, { value: 'enabled' }, { value: 'disabled' }]
        },
        {
            id: 'falPixverseV6GenerateAudio', type: 'switch', order: 8,
            default: true
        },
        {
            id: 'falPixverseV6MultiClip', type: 'switch', order: 9,
            default: false,
            visible: { condition: (params: JsonObject) => !isExtension(params) }
        }
    ],
    endpoints: {
        selector: async (params) => {
            const images = imageCount(params);
            if (isMax(params))
                return images > 0 ? 'pixverse/v6/max/image-to-video' : 'pixverse/v6/max/text-to-video';
            if (isExtension(params))
                return 'fal-ai/pixverse/v6/extend';
            if (images === 0)
                return 'fal-ai/pixverse/v6/text-to-video';
            return images === 1 ? 'fal-ai/pixverse/v6/image-to-video' : 'fal-ai/pixverse/v6/transition';
        }
    },
    request: {
        builder: (params) => {
            const prompt = typeof params.prompt === 'string' ? params.prompt.trim() : '';
            if (!prompt)
                throw new Error('PixVerse V6 的提示词不能为空');
            const body: JsonObject = {
                prompt,
                resolution: choice(params.falPixverseV6Resolution, RESOLUTIONS, '720p'),
                duration: duration(params),
                generate_audio_switch: params.falPixverseV6GenerateAudio !== false
            };
            const styles: readonly string[] = STYLES;
            if (typeof params.falPixverseV6Style === 'string' && styles.includes(params.falPixverseV6Style))
                body.style = params.falPixverseV6Style;
            if (isExtension(params)) {
                const video = resolveUploadedVideoSources(params)[0];
                if (!video)
                    throw new Error('PixVerse V6 视频续写需要上传 1 个视频');
                body.video_url = video;
                return body;
            }
            body.thinking_type = choice(params.falPixverseV6ThinkingType, ['auto', 'enabled', 'disabled'], 'auto');
            body.generate_multi_clip_switch = params.falPixverseV6MultiClip === true;
            const images = resolveUploadedImageSources(params);
            if (isMax(params) && images.length > 1)
                throw new Error('PixVerse V6 Max 只支持 1 张首帧图，不支持首尾帧');
            if (images.length === 1) {
                body.image_url = images[0];
            }
            else {
                body.aspect_ratio = aspectRatio(params);
                if (images.length >= 2) {
                    body.first_image_url = images[0];
                    body.end_image_url = images[1];
                }
            }
            return body;
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => {
            const rate = RATES[isMax(params) ? 'max' : 'standard'][choice(params.falPixverseV6Resolution, RESOLUTIONS, '720p')];
            return rate[params.falPixverseV6GenerateAudio === false ? 0 : 1] * duration(params);
        },
        description: '按生成秒数计费（无音频/有音频）：标准 360p $0.025/$0.035、540p $0.035/$0.045、720p $0.045/$0.06、1080p $0.09/$0.115；Max 360p $0.054/$0.081、540p $0.081/$0.099、720p $0.099/$0.135、1080p $0.198/$0.252；多镜头不加价'
    }
});
export default falPixverseV6Model;
