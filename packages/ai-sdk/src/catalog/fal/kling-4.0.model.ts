import { defineModel } from "../defineModel";
import type { JsonObject } from "../../types/runtime";
import { hasUploadedImage, hasUploadedVideo, resolveUploadedImageSources, resolveUploadedVideoDurationSeconds, resolveUploadedVideoSources } from "../shared/mediaPresence";
import { KLING_V4_RATIOS, klingV4Duration, klingV4EditSeconds, klingV4Mode, klingV4Prompt, klingV4Ratio } from "./utils/klingV4";

// 价格与字段来源：docs/model-adaptation/Kling-4.0/Kling-4.0_Fal.md（Fal 模型页与 OpenAPI，2026-11-07 读取）
function rates(params: JsonObject) {
    const fullHd = params.falKling40Resolution !== '720p';
    return { video: fullHd ? 0.235 : 0.157, withVideoInput: fullHd ? 0.141 : 0.094 };
}

export const falKling40Model = defineModel({
    meta: {
        id: 'fal-ai-kling-4.0', canonicalModelId: 'kling-video-4.0', seriesId: 'kling-video', seriesRank: 4,
        provider: 'fal', type: 'video',
        tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'reference-mode', 'video-to-video'],
        polling: { interval: 3000, maxAttempts: 400, expectedAttempts: 90 }
    },
    inputLimits: {
        images: { max: 10 }, videos: { max: 0 }, audios: { max: 0 },
        rules: [
            { when: 'falKling40Mode === "reference-to-video"', images: { max: 10 }, videos: { max: 5 } },
            { when: 'falKling40Mode === "video-edit"', images: { max: 10 }, videos: { min: 1, max: 5 } }
        ]
    },
    requirements: [
        {
            id: 'fal-kling-4.0-edit-video', when: 'falKling40Mode === "video-edit"',
            require: { videos: { min: 1 } },
            message: { title: '视频必需', message: '视频编辑需要上传要修改的视频（3–30 秒）', type: 'warning' }
        }
    ],
    params: [
        {
            id: 'falKling40Mode', type: 'dropdown', order: 1,
            default: 'text-image-to-video',
            options: [{ value: 'text-image-to-video' }, { value: 'reference-to-video' }, { value: 'video-edit' }]
        },
        {
            id: 'falKling40AspectRatio', type: 'dropdown', order: 2,
            default: 'smart',
            visible: {
                condition: (params: JsonObject) => klingV4Mode(params.falKling40Mode) !== 'text-image-to-video' || !hasUploadedImage(params)
            },
            options: [{ value: 'smart' }, ...KLING_V4_RATIOS.map((value) => ({ value }))]
        },
        {
            id: 'falKling40Resolution', type: 'dropdown', order: 3,
            default: '1080p',
            options: [{ value: '720p' }, { value: '1080p' }]
        },
        {
            id: 'falKling40Duration', type: 'number', order: 4,
            default: 5, min: 3, max: 30, step: 1,
            visible: { condition: (params: JsonObject) => klingV4Mode(params.falKling40Mode) !== 'video-edit' }
        }
    ],
    endpoints: {
        selector: async (params) => {
            const mode = klingV4Mode(params.falKling40Mode);
            if (mode === 'reference-to-video')
                return 'kling/v4/reference-to-video';
            if (mode === 'video-edit')
                return 'kling/v4/video-to-video/edit';
            return hasUploadedImage(params) ? 'kling/v4/image-to-video' : 'kling/v4/text-to-video';
        }
    },
    request: {
        builder: (params) => {
            const mode = klingV4Mode(params.falKling40Mode);
            const prompt = klingV4Prompt(params);
            const images = resolveUploadedImageSources(params).slice(0, 10);
            const videos = resolveUploadedVideoSources(params);
            const resolution = params.falKling40Resolution === '720p' ? '720p' : '1080p';
            if (mode === 'video-edit') {
                if (!prompt)
                    throw new Error('Kling 4.0 视频编辑需要填写修改说明');
                if (videos.length === 0)
                    throw new Error('Kling 4.0 视频编辑需要上传要修改的视频');
                const body: JsonObject = { prompt, video_url: videos[0], resolution };
                if (videos.length > 1)
                    body.video_urls = videos.slice(1, 5);
                if (images.length > 0)
                    body.image_urls = images;
                const ratio = klingV4Ratio(params.falKling40AspectRatio, undefined);
                if (ratio)
                    body.aspect_ratio = ratio;
                return body;
            }
            const body: JsonObject = { duration: klingV4Duration(params.falKling40Duration, 30), resolution };
            if (prompt)
                body.prompt = prompt;
            if (mode === 'reference-to-video') {
                if (!prompt)
                    throw new Error('Kling 4.0 参考生视频需要填写提示词');
                if (images.length > 0)
                    body.image_urls = images;
                if (videos.length > 0)
                    body.video_urls = videos.slice(0, 5);
                body.aspect_ratio = klingV4Ratio(params.falKling40AspectRatio, 'auto') ?? 'auto';
                return body;
            }
            if (images.length > 0) {
                // 第一张作首帧，最后一张作尾帧，中间的按顺序作关键帧（最多 8 张）。
                body.start_image_url = images[0];
                if (images.length > 1)
                    body.end_image_url = images[images.length - 1];
                if (images.length > 2)
                    body.middle_image_urls = images.slice(1, -1).slice(0, 8);
                return body;
            }
            if (!prompt)
                throw new Error('Kling 4.0 文生视频需要填写提示词');
            body.aspect_ratio = klingV4Ratio(params.falKling40AspectRatio, undefined) ?? '16:9';
            return body;
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => {
            const mode = klingV4Mode(params.falKling40Mode);
            const rate = rates(params);
            if (mode === 'video-edit') {
                const { source, input } = klingV4EditSeconds(params);
                return rate.withVideoInput * Math.max(input + source, source * 2);
            }
            const duration = klingV4Duration(params.falKling40Duration, 30);
            if (mode === 'reference-to-video' && hasUploadedVideo(params)) {
                const input = resolveUploadedVideoDurationSeconds(params, 5);
                return rate.withVideoInput * Math.max(input + duration, duration * 2);
            }
            return rate.video * duration;
        },
        description: '720p $0.157/秒、1080p $0.235/秒；视频编辑或带参考视频时 720p $0.094/秒、1080p $0.141/秒，按输入加输出时长计费（至少为输出的 2 倍）'
    }
});
export default falKling40Model;
