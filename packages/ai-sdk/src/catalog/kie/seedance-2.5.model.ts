import { defineModel } from "../defineModel";
import type { JsonValue, JsonObject } from "../../types/runtime";
import { hasUploadedVideo } from './mediaSources';
const KIE_CREATE_TASK_ENDPOINT = '/api/v1/jobs/createTask';
export const kieSeedance25Model = defineModel({
    meta: {
        id: 'kie-seedance-2.5',
        canonicalModelId: 'seedance-2.5',
        seriesId: 'seedance',
        seriesRank: 2.5,
        provider: 'kie',
        type: 'video',
        tags: [
            'text-to-video',
            'image-to-video',
            'start-end-frame',
            'reference-mode',
            'multi-mode-switch',
            'mixed-upload-mode',
            'supports-audio-generation',
            'provider-kie'
        ],
        polling: { interval: 3000, maxAttempts: 300, expectedAttempts: 90 }
    },
    inputLimits: {
        images: { max: 2 },
        videos: { max: 0 },
        audios: { max: 0 },
        rules: [
            {
                when: 'kieSeedance25Mode === "reference-to-video"',
                images: { max: 30 },
                videos: { max: 10 },
                audios: { max: 10 }
            }
        ]
    },
    params: [
        {
            id: 'kieSeedance25Mode',
            type: 'dropdown',
            order: 1,
            default: 'reference-to-video',
            options: [
                { value: 'text-image-to-video' },
                { value: 'reference-to-video' }
            ]
        },
        {
            id: 'kieSeedance25AspectRatio',
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
            id: 'kieSeedance25Resolution',
            type: 'dropdown',
            order: 3,
            default: '720p',
            options: [
                { value: '480p' },
                { value: '720p' },
                { value: '1080p' }
            ]
        },
        {
            id: 'kieSeedance25Duration',
            type: 'number',
            order: 4,
            default: 5,
            min: 4,
            max: 30,
            step: 1
        },
        {
            id: 'kieSeedance25GenerateAudio',
            type: 'switch',
            order: 5,
            default: true
        },
        {
            id: 'kieSeedance25ReturnLastFrame',
            type: 'switch',
            order: 6,
            default: false
        },
        {
            id: 'kieSeedance25AutoDuration',
            type: 'switch',
            order: 7,
            default: false
        },
        {
            id: 'kieSeedance25WebSearch',
            type: 'switch',
            order: 8,
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
            const mode = params.kieSeedance25Mode === 'reference-to-video'
                ? 'reference-to-video'
                : 'text-image-to-video';
            const supportedAspectRatios = ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9'];
            const rawAspectRatio = String(params.kieSeedance25AspectRatio || 'smart');
            let aspectRatio = supportedAspectRatios.includes(rawAspectRatio) ? rawAspectRatio : 'adaptive';
            if (rawAspectRatio === 'smart' || rawAspectRatio === 'auto' || rawAspectRatio === 'adaptive')
                aspectRatio = 'adaptive';
            const input: JsonObject = {
                prompt: typeof params.prompt === 'string' ? params.prompt.slice(0, 30000) : '',
                aspect_ratio: aspectRatio,
                resolution: params.kieSeedance25Resolution === '480p' || params.kieSeedance25Resolution === '1080p'
                    ? params.kieSeedance25Resolution
                    : '720p',
                duration: params.kieSeedance25AutoDuration === true
                    ? -1
                    : Math.min(30, Math.max(4, Number(params.kieSeedance25Duration || 5))),
                generate_audio: params.kieSeedance25GenerateAudio !== false,
                return_last_frame: params.kieSeedance25ReturnLastFrame === true,
                nsfw_checker: true
            };
            if (params.kieSeedance25WebSearch === true)
                input.web_search = 'true';
            if (mode === 'reference-to-video') {
                if (images.length > 0)
                    input.reference_image_urls = images.slice(0, 30);
                if (videos.length > 0)
                    input.reference_video_urls = videos.slice(0, 10);
                if (audios.length > 0)
                    input.reference_audio_urls = audios.slice(0, 10);
            }
            else {
                if (images[0])
                    input.first_frame_url = images[0];
                if (images[1])
                    input.last_frame_url = images[1];
            }
            return { model: 'bytedance/seedance-2-5', input };
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => {
            const resolution = String(params.kieSeedance25Resolution || '720p');
            const duration = params.kieSeedance25AutoDuration === true
                ? 30
                : Math.min(30, Math.max(4, Number(params.kieSeedance25Duration || 5)));
            const hasVideoInput = params.kieSeedance25Mode === 'reference-to-video' && hasUploadedVideo(params);
            const perSecond: Record<string, {
                noVideo: number;
                withVideo: number;
            }> = {
                '480p': { noVideo: 0.14, withVideo: 0.085 },
                '720p': { noVideo: 0.315, withVideo: 0.19 },
                '1080p': { noVideo: 0.57, withVideo: 0.3425 }
            };
            const rate = perSecond[resolution] ?? perSecond['720p'];
            const videoCount = Array.isArray(params.uploadedVideoFilePaths)
                ? params.uploadedVideoFilePaths.length
                : (Array.isArray(params.videos) ? params.videos.length : 0);
            const firstVideoDuration = typeof params.__firstVideoDurationSeconds === 'number' && params.__firstVideoDurationSeconds > 0
                ? params.__firstVideoDurationSeconds
                : 0;
            const billedSeconds = duration + (hasVideoInput ? firstVideoDuration * videoCount : 0);
            return billedSeconds * (hasVideoInput ? rate.withVideo : rate.noVideo);
        },
        description: '无/有视频输入每秒：480p $0.14/$0.085，720p $0.315/$0.19，1080p $0.57/$0.3425；有视频时按输入与输出总时长计费，自动时长按 30 秒预估'
    }
});
export default kieSeedance25Model;
