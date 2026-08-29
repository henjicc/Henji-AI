import { defineModel } from "../defineModel";
import { countUploadedVideos, resolveUploadedVideoDurationSeconds } from '../shared/mediaPresence';
import type { JsonValue, JsonObject } from "../../types/runtime";
export const apimartSeedance20Model = defineModel({
    meta: {
        id: 'apimart-seedance-2.0', canonicalModelId: 'seedance-2.0', seriesId: 'seedance', seriesRank: 2,
        provider: 'apimart', type: 'video',
        tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'reference-mode', 'multi-mode-switch', 'mixed-upload-mode', 'supports-audio-generation', 'supports-4k', 'provider-apimart'],
        aliases: ['seedance-2-apimart'], polling: { interval: 3000, maxAttempts: 300, expectedAttempts: 80 }
    },
    inputLimits: {
        images: { max: 2 }, videos: { max: 0 }, audios: { max: 0 },
        rules: [{ when: 'apimartSeedance20Mode === "reference-to-video"', images: { max: 9 }, videos: { max: 3 }, audios: { max: 3 } }]
    },
    params: [
        {
            id: 'apimartSeedance20Mode', type: 'dropdown', order: 1,
            default: 'reference-to-video',
            options: [
                { value: 'text-image-to-video' },
                { value: 'reference-to-video' }
            ]
        },
        {
            id: 'apimartSeedance20AspectRatio', type: 'dropdown', order: 2,
            default: 'smart',
            options: [{ value: 'smart' }, ...['1:1', '4:3', '3:4', '16:9', '9:16', '21:9'].map((ratio) => ({ value: ratio }))]
        },
        {
            id: 'apimartSeedance20Resolution', type: 'dropdown', order: 3,
            default: '720p',
            options: ['480p', '720p', '1080p', '4K'].map((value) => ({ value }))
        },
        {
            id: 'apimartSeedance20Duration', type: 'number', order: 4,
            default: 5, min: 4, max: 15, step: 1
        },
        {
            id: 'apimartSeedance20GenerateAudio', type: 'switch', order: 5,
            default: true
        },
        {
            id: 'apimartSeedance20ReturnLastFrame', type: 'switch', order: 6,
            default: false
        },
        {
            id: 'apimartSeedance20WebSearch', type: 'switch', order: 7,
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
            const raw = String(params.apimartSeedance20AspectRatio || 'smart');
            let size = ratios.includes(raw) ? raw : '16:9';
            if ((raw === 'smart' || raw === 'auto' || raw === 'adaptive') && images.length + videos.length > 0)
                size = 'adaptive';
            const resolution = ['480p', '1080p', '4K'].includes(String(params.apimartSeedance20Resolution))
                ? String(params.apimartSeedance20Resolution) : '720p';
            const body: JsonObject = {
                model: 'seedance-2.0', prompt: typeof params.prompt === 'string' ? params.prompt.slice(0, 4000) : '',
                duration: Math.min(15, Math.max(4, Math.round(Number(params.apimartSeedance20Duration || 5)))),
                size, resolution: resolution === '4K' ? '4k' : resolution,
                generate_audio: params.apimartSeedance20GenerateAudio !== false,
                return_last_frame: params.apimartSeedance20ReturnLastFrame === true,
                nsfw_check: false
            };
            if (params.apimartSeedance20WebSearch === true)
                body.tools = [{ type: 'web_search' }];
            if (params.apimartSeedance20Mode === 'reference-to-video') {
                if (audios.length > 0 && images.length + videos.length === 0) {
                    throw new Error('Seedance 2.0 的参考音频必须与参考图片或参考视频一起使用');
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
            const duration = Math.min(15, Math.max(4, Math.round(Number(params.apimartSeedance20Duration || 5))));
            const rates: Record<string, {
                noVideo: number;
                withVideo: number;
            }> = {
                '480p': { noVideo: 0.066, withVideo: 0.04 },
                '720p': { noVideo: 0.142, withVideo: 0.08584 },
                '1080p': { noVideo: 0.3544, withVideo: 0.21568 },
                '4K': { noVideo: 0.722, withVideo: 0.44432 }
            };
            const rate = rates[String(params.apimartSeedance20Resolution || '720p')] ?? rates['720p'];
            const hasVideo = params.apimartSeedance20Mode === 'reference-to-video' && countUploadedVideos(params) > 0;
            const inputDuration = hasVideo ? resolveUploadedVideoDurationSeconds(params) : 0;
            return (duration + (hasVideo ? inputDuration : 0)) * (hasVideo ? rate.withVideo : rate.noVideo);
        },
        description: '无/有视频输入每秒：480p $0.066/$0.04，720p $0.142/$0.08584，1080p $0.3544/$0.21568，4K $0.722/$0.44432；有视频时按输入与输出总时长计费'
    }
});
export default apimartSeedance20Model;
