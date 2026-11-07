import { defineModel } from "../defineModel";
import type { JsonValue, JsonObject } from "../../types/runtime";
import { hasUploadedImage, hasUploadedVideo } from './mediaSources';
const KIE_CREATE_TASK_ENDPOINT = '/api/v1/jobs/createTask';
export const kieKling30OmniModel = defineModel({
    meta: {
        id: 'kie-kling-3.0-omni',
        canonicalModelId: 'kling-video-3.0-omni',
        seriesId: 'kling-video',
        seriesRank: 3.02,
        provider: 'kie',
        type: 'video',
        tags: ['text-to-video', 'image-to-video', 'reference-mode', 'video-to-video'],
        polling: { interval: 3000, maxAttempts: 300, expectedAttempts: 90 }
    },
    inputLimits: {
        images: { max: 0 },
        videos: { max: 0 },
        rules: [
            {
                when: 'kieKling30OmniMode === "image-to-video"',
                images: { exact: 1 },
                videos: { max: 0 }
            },
            {
                when: 'kieKling30OmniMode === "transformation"',
                images: { max: 4 },
                videos: { exact: 1 }
            },
            {
                when: 'kieKling30OmniMode === "reference-to-video"',
                images: { max: 7 },
                videos: { max: 1 }
            }
        ]
    },
    requirements: [
        {
            id: 'kie-kling-30-omni-image',
            when: 'kieKling30OmniMode === "image-to-video"',
            require: { images: { exact: 1 } },
            message: {
                title: '图片必需',
                message: '图生视频模式需要上传 1 张首帧图片。',
                type: 'warning'
            }
        },
        {
            id: 'kie-kling-30-omni-video',
            when: 'kieKling30OmniMode === "transformation"',
            require: { videos: { exact: 1 } },
            message: {
                title: '视频必需',
                message: '视频变换模式需要上传 1 个视频。',
                type: 'warning'
            }
        }
    ],
    params: [
        {
            id: 'kieKling30OmniMode',
            type: 'dropdown',
            order: 1,
            default: 'text-to-video',
            options: [
                { value: 'text-to-video' },
                { value: 'image-to-video' },
                { value: 'transformation' },
                { value: 'reference-to-video' }
            ]
        },
        {
            id: 'kieKling30OmniAspectRatio',
            type: 'dropdown',
            order: 2,
            // 图生视频、只带视频的风格转换由构建器固定发 auto，比例跟随素材。
            visible: { condition: (params) => params.kieKling30OmniMode !== 'image-to-video'
                    && !(['transformation', 'reference-to-video'].includes(String(params.kieKling30OmniMode)) && hasUploadedVideo(params) && !hasUploadedImage(params)) },
            default: 'smart',
            options: [
                { value: 'smart' },
                { value: '16:9' },
                { value: '9:16' },
                { value: '1:1' }
            ]
        },
        {
            id: 'kieKling30OmniResolution',
            type: 'dropdown',
            order: 3,
            default: '720p',
            options: [
                { value: '720p' },
                { value: '1080p' },
                { value: '4k' }
            ]
        },
        {
            id: 'kieKling30OmniDuration',
            type: 'dropdown',
            order: 4,
            // 只带视频的风格转换与参考生视频时长跟随视频，不发送。
            visible: { condition: (params: JsonObject) => !(['transformation', 'reference-to-video'].includes(String(params.kieKling30OmniMode)) && hasUploadedVideo(params) && !hasUploadedImage(params)) },
            default: '5',
            options: Array.from({ length: 13 }, (_, index) => {
                const value = String(index + 3);
                return { value };
            })
        },
        {
            id: 'kieKling30OmniAudio',
            type: 'switch',
            order: 5,
            // 带参考视频的参考生视频官方只允许关闭音频。
            visible: { condition: (params: JsonObject) => !(params.kieKling30OmniMode === 'reference-to-video' && hasUploadedVideo(params)) },
            default: false
        }
    ],
    endpoints: KIE_CREATE_TASK_ENDPOINT,
    request: {
        builder: (params) => {
            const filterSources = (value: JsonValue): string[] => Array.isArray(value)
                ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
                : [];
            const pickSources = (primary: JsonValue, fallback: JsonValue): string[] => {
                const preferred = filterSources(primary);
                return preferred.length > 0 ? preferred : filterSources(fallback);
            };
            const images = pickSources(params.uploadedFilePaths, params.images);
            const videos = pickSources(params.uploadedVideoFilePaths, params.videos);
            const mode = typeof params.kieKling30OmniMode === 'string'
                ? params.kieKling30OmniMode
                : 'text-to-video';
            const aspectRatios = ['16:9', '9:16', '1:1'];
            const rawAspectRatio = String(params.kieKling30OmniAspectRatio || 'smart');
            const ratioHint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0
                ? params.__firstImageRatio
                : 16 / 9;
            let aspectRatio = aspectRatios.includes(rawAspectRatio) ? rawAspectRatio : '16:9';
            if (rawAspectRatio === 'smart' || rawAspectRatio === 'auto') {
                let bestDiff = Number.POSITIVE_INFINITY;
                for (const candidate of aspectRatios) {
                    const pair = candidate.split(':').map(Number);
                    const difference = Math.abs(pair[0] / pair[1] - ratioHint);
                    if (difference < bestDiff) {
                        bestDiff = difference;
                        aspectRatio = candidate;
                    }
                }
            }
            const input: JsonObject = {
                prompt: typeof params.prompt === 'string' ? params.prompt.trim().slice(0, 3072) : '',
                duration: Math.min(15, Math.max(3, Number(params.kieKling30OmniDuration || 5))),
                resolution: params.kieKling30OmniResolution === '1080p' || params.kieKling30OmniResolution === '4k'
                    ? params.kieKling30OmniResolution
                    : '720p',
                aspect_ratio: aspectRatio,
                audio: params.kieKling30OmniAudio === true
            };
            if (!input.prompt)
                throw new Error('Kling 3.0 Omni 的提示词不能为空');
            if (mode === 'image-to-video') {
                input.aspect_ratio = 'auto';
                if (images[0])
                    input.image_urls = [images[0]];
                return { model: 'kling-3.0-omni/image-to-video', input };
            }
            // 官方 OpenAPI 的风格转换与参考生视频按“只带视频 / 视频加图 / 只带图”分成互斥的几种请求体，
            // 多余字段会被拒绝：只带视频时不传时长和图，比例只能 auto；视频加图时最多 4 张图；带视频的参考生视频不能开音频。
            if (videos.length > 0 && images.length > 4)
                throw new Error('Kling 3.0 Omni 带参考视频时最多 4 张参考图');
            if (mode === 'reference-to-video' && images.length + videos.length === 0)
                throw new Error('Kling 3.0 Omni 参考生视频至少需要一张参考图或一段参考视频');
            if (mode === 'transformation') {
                const transformation: JsonObject = { prompt: input.prompt, resolution: input.resolution, audio: input.audio };
                if (videos[0])
                    transformation.video_urls = [videos[0]];
                if (images.length > 0) {
                    transformation.image_urls = images;
                    transformation.duration = String(input.duration);
                    transformation.aspect_ratio = aspectRatio;
                }
                else {
                    transformation.aspect_ratio = 'auto';
                }
                return { model: 'kling-3.0-omni/transformation', input: transformation };
            }
            if (mode === 'reference-to-video' && videos.length > 0) {
                const reference: JsonObject = { prompt: input.prompt, resolution: input.resolution, video_urls: [videos[0]], audio: false };
                if (images.length > 0) {
                    reference.image_urls = images;
                    reference.duration = input.duration;
                    reference.aspect_ratio = aspectRatio;
                }
                else {
                    reference.aspect_ratio = 'auto';
                }
                return { model: 'kling-3.0-omni/reference-to-video', input: reference };
            }
            if (mode === 'reference-to-video') {
                if (images.length > 0)
                    input.image_urls = images.slice(0, 7);
                if (videos[0])
                    input.video_urls = [videos[0]];
                return { model: 'kling-3.0-omni/reference-to-video', input };
            }
            return { model: 'kling-3.0-omni/text-to-video', input };
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => {
            const hasVideoInput = hasUploadedVideo(params);
            // 只带视频的风格转换与参考生视频不发时长，输出跟随视频，按视频时长估价。
            const followsVideo = hasVideoInput && !hasUploadedImage(params) && ['transformation', 'reference-to-video'].includes(String(params.kieKling30OmniMode));
            const videoSeconds = typeof params.__firstVideoDurationSeconds === 'number' && params.__firstVideoDurationSeconds > 0 ? params.__firstVideoDurationSeconds : 10;
            const duration = followsVideo
                ? Math.min(10, Math.max(3, Math.ceil(videoSeconds)))
                : Math.min(15, Math.max(3, Number(params.kieKling30OmniDuration || 5)));
            const resolution = String(params.kieKling30OmniResolution || '720p');
            if (resolution === '4k')
                return duration * 0.335;
            if (hasVideoInput || params.kieKling30OmniMode === 'transformation') {
                return duration * (resolution === '1080p' ? 0.135 : 0.10);
            }
            const withAudio = params.kieKling30OmniAudio === true;
            if (resolution === '1080p')
                return duration * (withAudio ? 0.115 : 0.09);
            return duration * (withAudio ? 0.09 : 0.07);
        },
        description: '文/图生 720p $0.07/$0.09、1080p $0.09/$0.115（无/有音频）；视频输入 720p $0.10、1080p $0.135；4K $0.335 每秒'
    }
});
export default kieKling30OmniModel;
