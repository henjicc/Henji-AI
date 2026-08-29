import { defineModel } from "../defineModel";
import { countUploadedVideos, resolveUploadedVideoDurationSeconds } from '../shared/mediaPresence';
import type { JsonValue, JsonObject } from "../../types/runtime";
export const apimartSeedance20MiniModel = defineModel({
    meta: {
        id: 'apimart-seedance-2.0-mini', canonicalModelId: 'seedance-2.0-mini', seriesId: 'seedance', seriesRank: 2.05,
        provider: 'apimart', type: 'video',
        tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'reference-mode', 'multi-mode-switch', 'mixed-upload-mode', 'supports-audio-generation', 'fast-mode', 'provider-apimart'],
        aliases: ['seedance-2-mini-apimart'], polling: { interval: 3000, maxAttempts: 300, expectedAttempts: 70 }
    },
    inputLimits: {
        images: { max: 2 }, videos: { max: 0 }, audios: { max: 0 },
        rules: [{ when: 'apimartSeedance20MiniMode === "reference-to-video"', images: { max: 9 }, videos: { max: 3 }, audios: { max: 3 } }]
    },
    params: [
        {
            id: 'apimartSeedance20MiniMode', type: 'dropdown', order: 1,
            default: 'reference-to-video',
            options: [
                { value: 'text-image-to-video' },
                { value: 'reference-to-video' }
            ]
        },
        {
            id: 'apimartSeedance20MiniAspectRatio', type: 'dropdown', order: 2,
            default: 'smart',
            options: [{ value: 'smart' }, ...['1:1', '4:3', '3:4', '16:9', '9:16', '21:9'].map((ratio) => ({ value: ratio }))]
        },
        {
            id: 'apimartSeedance20MiniResolution', type: 'dropdown', order: 3,
            default: '720p',
            options: ['480p', '720p'].map((value) => ({ value }))
        },
        {
            id: 'apimartSeedance20MiniDuration', type: 'number', order: 4,
            default: 5, min: 4, max: 15, step: 1
        },
        {
            id: 'apimartSeedance20MiniGenerateAudio', type: 'switch', order: 5,
            default: true
        },
        {
            id: 'apimartSeedance20MiniReturnLastFrame', type: 'switch', order: 6,
            default: false
        },
        {
            id: 'apimartSeedance20MiniWebSearch', type: 'switch', order: 7,
            default: false
        }
    ],
    endpoints: '/v1/videos/generations',
    request: {
        builder: (params) => {
            const filterSources = (value: JsonValue): string[] => Array.isArray(value)
                ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
            const pickSources = (primary: JsonValue, fallback: JsonValue): string[] => {
                const preferred = filterSources(primary);
                return preferred.length > 0 ? preferred : filterSources(fallback);
            };
            const images = pickSources(params.uploadedFilePaths, params.images);
            const videos = pickSources(params.uploadedVideoFilePaths, params.videos);
            const audios = pickSources(params.uploadedAudioFilePaths, params.audios);
            const ratios = ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9'];
            const raw = String(params.apimartSeedance20MiniAspectRatio || 'smart');
            let size = ratios.includes(raw) ? raw : '16:9';
            if ((raw === 'smart' || raw === 'auto' || raw === 'adaptive') && images.length + videos.length > 0)
                size = 'adaptive';
            const body: JsonObject = {
                model: 'seedance-2.0-mini', prompt: typeof params.prompt === 'string' ? params.prompt : '',
                duration: Math.min(15, Math.max(4, Math.round(Number(params.apimartSeedance20MiniDuration || 5)))),
                size, resolution: params.apimartSeedance20MiniResolution === '480p' ? '480p' : '720p',
                generate_audio: params.apimartSeedance20MiniGenerateAudio !== false,
                return_last_frame: params.apimartSeedance20MiniReturnLastFrame === true,
                nsfw_check: false
            };
            if (params.apimartSeedance20MiniWebSearch === true)
                body.tools = [{ type: 'web_search' }];
            if (params.apimartSeedance20MiniMode === 'reference-to-video') {
                if (audios.length > 0 && images.length + videos.length === 0) {
                    throw new Error('Seedance 2.0 Mini 的参考音频必须与参考图片或参考视频一起使用');
                }
                if (images.length > 0)
                    body.image_urls = images.slice(0, 9);
                if (videos.length > 0)
                    body.video_urls = videos.slice(0, 3);
                if (audios.length > 0)
                    body.audio_urls = audios.slice(0, 3);
            }
            else if (images.length > 0) {
                body.image_with_roles = images.slice(0, 2).map((url, index) => ({ url, role: index === 0 ? 'first_frame' : 'last_frame' }));
            }
            return body;
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => {
            const duration = Math.min(15, Math.max(4, Math.round(Number(params.apimartSeedance20MiniDuration || 5))));
            const rate = params.apimartSeedance20MiniResolution === '480p'
                ? { noVideo: 0.01056, withVideo: 0.0064 }
                : { noVideo: 0.02288, withVideo: 0.01384 };
            const hasVideo = params.apimartSeedance20MiniMode === 'reference-to-video' && countUploadedVideos(params) > 0;
            const inputDuration = hasVideo ? resolveUploadedVideoDurationSeconds(params) : 0;
            return (duration + (hasVideo ? inputDuration : 0)) * (hasVideo ? rate.withVideo : rate.noVideo);
        },
        description: '无/有视频输入每秒：480p $0.01056/$0.0064，720p $0.02288/$0.01384；有视频时按输入与输出总时长计费'
    }
});
export default apimartSeedance20MiniModel;
