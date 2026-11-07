import { defineModel } from "../defineModel";
import type { JsonObject } from "../../types/runtime";
import { hasUploadedImage, hasUploadedVideo, resolveUploadedImageSources, resolveUploadedVideoDurationSeconds, resolveUploadedVideoSources } from "../shared/mediaPresence";
import { KLING_V4_RATIOS, klingV4Duration, klingV4EditSeconds, klingV4Mode, klingV4Prompt, klingV4Ratio } from "./utils/klingV4";

// 价格与字段来源：docs/model-adaptation/Kling-4.0-Flash/Kling-4.0-Flash_Fal.md（Fal 模型页与 OpenAPI，2026-11-07 读取）。
// Flash 只出 720p，首帧图生视频不收尾帧，参考与编辑不接受声音。
export const falKling40FlashModel = defineModel({
    meta: {
        id: 'fal-ai-kling-4.0-flash', canonicalModelId: 'kling-video-4.0-flash', seriesId: 'kling-video', seriesRank: 4.01,
        provider: 'fal', type: 'video',
        tags: ['text-to-video', 'image-to-video', 'reference-mode', 'video-to-video'],
        polling: { interval: 3000, maxAttempts: 300, expectedAttempts: 50 }
    },
    inputLimits: {
        images: { max: 1 }, videos: { max: 0 }, audios: { max: 0 },
        rules: [
            { when: 'falKling40FlashMode === "reference-to-video"', images: { max: 10 }, videos: { max: 5 } },
            { when: 'falKling40FlashMode === "video-edit"', images: { max: 10 }, videos: { min: 1, max: 5 } }
        ]
    },
    requirements: [
        {
            id: 'fal-kling-4.0-flash-edit-video', when: 'falKling40FlashMode === "video-edit"',
            require: { videos: { min: 1 } },
            message: { title: '视频必需', message: '视频编辑需要上传要修改的视频（3–20 秒）', type: 'warning' }
        }
    ],
    params: [
        {
            id: 'falKling40FlashMode', type: 'dropdown', order: 1,
            default: 'text-image-to-video',
            options: [{ value: 'text-image-to-video' }, { value: 'reference-to-video' }, { value: 'video-edit' }]
        },
        {
            id: 'falKling40FlashAspectRatio', type: 'dropdown', order: 2,
            default: 'smart',
            visible: {
                condition: (params: JsonObject) => {
                    const mode = klingV4Mode(params.falKling40FlashMode);
                    return mode === 'reference-to-video' || (mode === 'text-image-to-video' && !hasUploadedImage(params));
                }
            },
            options: [{ value: 'smart' }, ...KLING_V4_RATIOS.map((value) => ({ value }))]
        },
        {
            id: 'falKling40FlashDuration', type: 'number', order: 3,
            default: 5, min: 3, max: 20, step: 1,
            visible: { condition: (params: JsonObject) => klingV4Mode(params.falKling40FlashMode) !== 'video-edit' }
        }
    ],
    endpoints: {
        selector: async (params) => {
            const mode = klingV4Mode(params.falKling40FlashMode);
            if (mode === 'reference-to-video')
                return 'kling/v4/flash/reference-to-video';
            if (mode === 'video-edit')
                return 'kling/v4/flash/video-to-video';
            return hasUploadedImage(params) ? 'kling/v4/flash/image-to-video' : 'kling/v4/flash/text-to-video';
        }
    },
    request: {
        builder: (params) => {
            const mode = klingV4Mode(params.falKling40FlashMode);
            const prompt = klingV4Prompt(params);
            const images = resolveUploadedImageSources(params).slice(0, 10);
            const videos = resolveUploadedVideoSources(params);
            if (mode === 'video-edit') {
                if (!prompt)
                    throw new Error('Kling 4.0 Flash 视频编辑需要填写修改说明');
                if (videos.length === 0)
                    throw new Error('Kling 4.0 Flash 视频编辑需要上传要修改的视频');
                const body: JsonObject = { prompt, video_url: videos[0] };
                if (videos.length > 1)
                    body.video_urls = videos.slice(1, 5);
                if (images.length > 0)
                    body.image_urls = images;
                return body;
            }
            const duration = klingV4Duration(params.falKling40FlashDuration, 20);
            if (mode === 'reference-to-video') {
                if (!prompt)
                    throw new Error('Kling 4.0 Flash 参考生视频需要填写提示词');
                const body: JsonObject = {
                    prompt, duration,
                    aspect_ratio: klingV4Ratio(params.falKling40FlashAspectRatio, 'auto') ?? 'auto'
                };
                if (images.length > 0)
                    body.image_urls = images;
                if (videos.length > 0)
                    body.video_urls = videos.slice(0, 5);
                return body;
            }
            if (images.length > 0) {
                const body: JsonObject = { start_image_url: images[0], duration };
                if (prompt)
                    body.prompt = prompt;
                return body;
            }
            if (!prompt)
                throw new Error('Kling 4.0 Flash 文生视频需要填写提示词');
            return { prompt, duration, aspect_ratio: klingV4Ratio(params.falKling40FlashAspectRatio, undefined) ?? '16:9' };
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => {
            const mode = klingV4Mode(params.falKling40FlashMode);
            if (mode === 'video-edit') {
                const { source, input } = klingV4EditSeconds(params);
                return 0.063 * (source + Math.max(input, source));
            }
            const duration = klingV4Duration(params.falKling40FlashDuration, 20);
            if (mode === 'reference-to-video' && hasUploadedVideo(params))
                return 0.063 * (duration + Math.max(resolveUploadedVideoDurationSeconds(params, 5), duration));
            return 0.094 * duration;
        },
        description: '720p $0.094/秒；视频编辑或带参考视频时 $0.063/秒，按输出时长加“输入视频与输出中较长者”计费'
    }
});
export default falKling40FlashModel;
