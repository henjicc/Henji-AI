import { defineModel } from "../defineModel";
import type { JsonValue, JsonObject } from "../../types/runtime";
import { hasUploadedVideo } from './mediaSources';
const KIE_CREATE_TASK_ENDPOINT = '/api/v1/jobs/createTask';
export const kieSeedance20MiniModel = defineModel({
    meta: {
        id: 'kie-seedance-2.0-mini',
        canonicalModelId: 'seedance-2.0-mini',
        seriesId: 'seedance',
        seriesRank: 2.0,
        provider: 'kie',
        type: 'video',
        tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'reference-mode', 'multi-mode-switch', 'mixed-upload-mode', 'supports-audio-generation', 'provider-kie'],
        polling: {
            interval: 3000,
            maxAttempts: 180,
            expectedAttempts: 60
        }
    },
    inputLimits: {
        images: { max: 2 },
        videos: { max: 0 },
        audios: { max: 0 },
        rules: [
            {
                when: 'kieSeedance20MiniMode === "reference-to-video"',
                images: { max: 9 },
                videos: { max: 3 },
                audios: { max: 3 }
            }
        ]
    },
    params: [
        {
            id: 'kieSeedance20MiniMode',
            type: 'dropdown',
            order: 1,
            default: 'reference-to-video',
            options: [
                { value: 'text-image-to-video' },
                { value: 'reference-to-video' }
            ]
        },
        {
            id: 'kieSeedance20MiniAspectRatio',
            type: 'dropdown',
            order: 2,
            default: 'smart',
            options: [
                { value: 'smart' },
                { value: '1:1' },
                { value: '4:3' },
                { value: '3:4' },
                { value: '16:9' },
                { value: '9:16' },
                { value: '21:9' }
            ]
        },
        {
            id: 'kieSeedance20MiniResolution',
            type: 'dropdown',
            order: 3,
            default: '720p',
            options: [
                { value: '480p' },
                { value: '720p' }
            ]
        },
        {
            id: 'kieSeedance20MiniDuration',
            type: 'number',
            order: 4,
            default: 5,
            min: 4,
            max: 15,
            step: 1
        },
        {
            id: 'kieSeedance20MiniGenerateAudio',
            type: 'switch',
            order: 5,
            default: true
        },
        {
            id: 'kieSeedance20MiniWebSearch',
            type: 'switch',
            order: 6,
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
            const audios = pickSources(params.uploadedAudioFilePaths, params.audios);
            const prompt = typeof params.prompt === 'string' ? params.prompt.slice(0, 20000) : '';
            const mode = params.kieSeedance20MiniMode === 'reference-to-video' ? 'reference-to-video' : 'text-image-to-video';
            const resolution = params.kieSeedance20MiniResolution || params.resolution || '720p';
            const duration = Number(params.kieSeedance20MiniDuration ?? params.duration ?? 5);
            const generateAudio = params.kieSeedance20MiniGenerateAudio !== false
            const webSearch = params.kieSeedance20MiniWebSearch === true;
            const aspectRatio = params.kieSeedance20MiniAspectRatio || params.aspect_ratio || 'smart';
            const supportedAspectRatios = ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9'];
            const normalizeRatio = (value: string): string => {
                if (value && value !== 'smart' && value !== 'auto' && supportedAspectRatios.includes(value)) {
                    return value;
                }
                const ratioHint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0
                    ? params.__firstImageRatio
                    : 16 / 9;
                let best = '16:9';
                let bestDiff = Number.POSITIVE_INFINITY;
                for (const ratioText of supportedAspectRatios) {
                    const pair = ratioText.split(':').map(Number);
                    const ratio = pair[0] / Math.max(1, pair[1]);
                    const diff = Math.abs(ratio - ratioHint);
                    if (diff < bestDiff) {
                        bestDiff = diff;
                        best = ratioText;
                    }
                }
                return best;
            };
            const input: JsonObject = {
                prompt,
                aspect_ratio: normalizeRatio(String(aspectRatio)),
                resolution,
                duration,
                generate_audio: generateAudio,
                web_search: webSearch,
                nsfw_checker: true
            };
            if (mode === 'reference-to-video') {
                if (images.length > 0) {
                    input.reference_image_urls = images.slice(0, 9);
                }
                if (videos.length > 0) {
                    input.reference_video_urls = videos.slice(0, 3);
                }
                if (audios.length > 0) {
                    input.reference_audio_urls = audios.slice(0, 3);
                }
            }
            else {
                if (images[0]) {
                    input.first_frame_url = images[0];
                }
                if (images[1]) {
                    input.last_frame_url = images[1];
                }
            }
            return {
                model: 'bytedance/seedance-2-mini',
                input
            };
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => {
            const resolution = String(params.kieSeedance20MiniResolution || '720p');
            const duration = Number(params.kieSeedance20MiniDuration || 5);
            const mode = params.kieSeedance20MiniMode === 'reference-to-video' ? 'reference-to-video' : 'text-image-to-video';
            const hasVideoInput = mode === 'reference-to-video' && hasUploadedVideo(params);
            const perSecond: Record<string, {
                noVideo: number;
                withVideo: number;
            }> = {
                '480p': { noVideo: 0.019, withVideo: 0.012 },
                '720p': { noVideo: 0.041, withVideo: 0.025 }
            };
            const rate = perSecond[resolution] ?? perSecond['720p'];
            const videoCount = Array.isArray(params.uploadedVideoFilePaths)
                ? params.uploadedVideoFilePaths.length
                : (Array.isArray(params.videos) ? params.videos.length : 0);
            const firstVideoDuration = typeof params.__firstVideoDurationSeconds === 'number' && params.__firstVideoDurationSeconds > 0
                ? params.__firstVideoDurationSeconds
                : 0;
            const billedSeconds = duration + (hasVideoInput ? firstVideoDuration * videoCount : 0);
            return (hasVideoInput ? rate.withVideo : rate.noVideo) * billedSeconds;
        },
        description: '480p: $0.019/$0.012 per second (no/with video input); 720p: $0.041/$0.025；有视频时按输入与输出总时长计费'
    }
});
export default kieSeedance20MiniModel;
