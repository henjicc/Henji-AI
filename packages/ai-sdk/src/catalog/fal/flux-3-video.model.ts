import { defineModel } from "../defineModel";
import type { JsonObject } from "../../types/runtime";
import { hasUploadedImage, resolveUploadedImageSources, resolveUploadedVideoDurationSeconds, resolveUploadedVideoSources } from "../shared/mediaPresence";

// 价格与字段来源：docs/model-adaptation/FLUX-3-Video/FLUX-3-Video_Fal.md（Fal 各端点 llms.txt，2026-11-07 读取）。
// 草稿端点与草稿增强需要回传上一次的 draft_cache 文件，当前参数体系没有对应入口，不接入。
const RATIOS = ['21:9', '2:1', '16:9', '4:3', '1:1', '3:4', '9:16'];
// 续写与 Max 只公布了 720p/1080p 的价格，更高档位不开放，避免按未知价格出片。
const RATES: Record<string, Record<string, number>> = {
    generate: { '720p': 0.17, '1080p': 0.29, '1440p': 0.32, '2160p': 0.47 },
    extend: { '720p': 0.41, '1080p': 0.53 },
    // Max 当前有限时折扣，按 2026-11-23 起的标准价估算，避免折扣结束后低估费用。
    max: { '720p': 0.17, '1080p': 0.29 }
};
const EDIT_RATE = 0.03;
const EDIT_MAX_SECONDS = 15;

type Mode = 'text-image-to-video' | 'extend' | 'edit';

function isMax(params: JsonObject): boolean {
    return params.falFlux3VideoVersion === 'max';
}

/** Max 只有文生与图生视频两个端点。 */
function mode(params: JsonObject): Mode {
    if (isMax(params))
        return 'text-image-to-video';
    return params.falFlux3VideoMode === 'extend' || params.falFlux3VideoMode === 'edit' ? params.falFlux3VideoMode : 'text-image-to-video';
}

function rates(params: JsonObject): Record<string, number> {
    if (isMax(params))
        return RATES.max;
    return mode(params) === 'extend' ? RATES.extend : RATES.generate;
}

function resolution(params: JsonObject): string {
    const value = String(params.falFlux3VideoResolution);
    return value in rates(params) ? value : '720p';
}

function duration(params: JsonObject): number {
    const value = Math.round(Number(params.falFlux3VideoDuration ?? 5));
    return Number.isFinite(value) ? Math.min(20, Math.max(5, value)) : 5;
}

export const falFlux3VideoModel = defineModel({
    meta: {
        id: 'fal-flux-3-video', canonicalModelId: 'flux-3-video', seriesId: 'flux', seriesRank: 3,
        provider: 'fal', type: 'video',
        tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'video-extension', 'video-to-video'],
        polling: { interval: 3000, maxAttempts: 300, expectedAttempts: 25 }
    },
    inputLimits: {
        images: { max: 1 }, videos: { max: 0 }, audios: { max: 0 },
        rules: [
            { when: 'falFlux3VideoVersion === "max"', images: { max: 2 } },
            { when: 'falFlux3VideoVersion !== "max" && (falFlux3VideoMode === "extend" || falFlux3VideoMode === "edit")', images: { max: 0 }, videos: { exact: 1 }, videoConstraints: { maxDurationSec: EDIT_MAX_SECONDS } }
        ]
    },
    params: [
        { id: 'falFlux3VideoVersion', type: 'dropdown', order: 1, default: 'standard', options: [{ value: 'standard' }, { value: 'max' }] },
        {
            id: 'falFlux3VideoMode', type: 'dropdown', order: 2, default: 'text-image-to-video',
            visible: { condition: (params: JsonObject) => !isMax(params) },
            options: [{ value: 'text-image-to-video' }, { value: 'extend' }, { value: 'edit' }]
        },
        {
            id: 'falFlux3VideoAspectRatio', type: 'dropdown', order: 3, default: 'smart',
            visible: { condition: (params: JsonObject) => mode(params) === 'text-image-to-video' && !hasUploadedImage(params) },
            options: [{ value: 'smart' }, ...RATIOS.map((value) => ({ value }))]
        },
        {
            id: 'falFlux3VideoResolution', type: 'dropdown', order: 4, default: '720p',
            visible: { condition: (params: JsonObject) => mode(params) !== 'edit' },
            options: ['720p', '1080p', '1440p', '2160p'].map((value) => ({ value }))
        },
        {
            id: 'falFlux3VideoDuration', type: 'number', order: 5, default: 5, min: 5, max: 20, step: 1,
            visible: { condition: (params: JsonObject) => mode(params) !== 'edit' }
        },
        {
            id: 'falFlux3VideoGenerateAudio', type: 'switch', order: 6, default: true,
            visible: { condition: (params: JsonObject) => mode(params) !== 'edit' }
        },
        {
            id: 'falFlux3VideoReasoning', type: 'dropdown', order: 7, default: 'high',
            visible: { condition: (params: JsonObject) => isMax(params) },
            options: [{ value: 'low' }, { value: 'high' }]
        }
    ],
    endpoints: {
        selector: async (params) => {
            const current = mode(params);
            if (current === 'extend')
                return 'blackforestlabs/flux-3/extend-video';
            if (current === 'edit')
                return 'blackforestlabs/flux-3/edit-video';
            const family = isMax(params) ? 'blackforestlabs/flux-3-max' : 'blackforestlabs/flux-3';
            return hasUploadedImage(params) ? `${family}/image-to-video` : `${family}/text-to-video`;
        }
    },
    request: {
        builder: (params) => {
            const prompt = typeof params.prompt === 'string' ? params.prompt.trim() : '';
            if (!prompt)
                throw new Error('FLUX 3 Video 的提示词不能为空');
            const current = mode(params);
            if (current !== 'text-image-to-video') {
                const videos = resolveUploadedVideoSources(params);
                if (videos.length !== 1)
                    throw new Error(`FLUX 3 Video ${current === 'extend' ? '视频续写' : '视频编辑'}需要 1 段视频`);
                if (current === 'edit')
                    return { prompt, video_url: videos[0] };
                return { prompt, video_url: videos[0], resolution: resolution(params), duration: duration(params), generate_audio: params.falFlux3VideoGenerateAudio !== false };
            }
            const images = resolveUploadedImageSources(params);
            const body: JsonObject = { prompt, resolution: resolution(params), duration: duration(params), generate_audio: params.falFlux3VideoGenerateAudio !== false };
            const raw = String(params.falFlux3VideoAspectRatio || 'smart');
            // 有首帧时交给平台跟随图片比例；纯文生视频回退 16:9。
            body.aspect_ratio = images.length > 0 ? 'auto' : RATIOS.includes(raw) ? raw : '16:9';
            if (images.length > 0)
                body.image_url = images[0];
            if (isMax(params)) {
                if (images.length > 1)
                    body.end_image_url = images[1];
                body.reasoning_level = params.falFlux3VideoReasoning === 'low' ? 'low' : 'high';
            }
            return body;
        }
    },
    pricing: {
        currency: '$',
        billingMode: 'estimated',
        calculator: (params) => mode(params) === 'edit'
            ? EDIT_RATE * Math.min(EDIT_MAX_SECONDS, resolveUploadedVideoDurationSeconds(params, EDIT_MAX_SECONDS))
            : rates(params)[resolution(params)] * duration(params),
        description: '标准版文/图生视频每秒 720p $0.17、1080p $0.29、2K $0.32、4K $0.47；视频续写每秒 720p $0.41、1080p $0.53；视频编辑 $0.03/秒（按输入视频时长）；Max 每秒 720p $0.17、1080p $0.29（当前限时折扣，按标准价预估）'
    }
});
export default falFlux3VideoModel;
