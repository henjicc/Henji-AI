import { defineModel } from "../defineModel";
import type { JsonValue, JsonObject } from "../../types/runtime";
export const falSeedance25Model = defineModel({
    meta: {
        id: 'fal-ai-seedance-2.5', canonicalModelId: 'seedance-2.5', seriesId: 'seedance', seriesRank: 2.5,
        provider: 'fal', type: 'video',
        tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'reference-mode', 'mixed-upload-mode', 'supports-audio-generation', 'multi-mode-switch', 'provider-fal'],
        aliases: ['seedance-2-5-fal'], polling: { interval: 3000, maxAttempts: 420, expectedAttempts: 100 }
    },
    inputLimits: {
        images: { max: 2 }, videos: { max: 0 }, audios: { max: 0 },
        rules: [{ when: 'falSeedance25Mode === "reference-to-video"', images: { max: 30 }, videos: { max: 10 }, audios: { max: 10 } }]
    },
    params: [
        {
            id: 'falSeedance25Mode', type: 'dropdown', order: 1,
            default: 'text-image-to-video',
            options: [
                { value: 'text-image-to-video' },
                { value: 'reference-to-video' }
            ]
        },
        {
            id: 'falSeedance25AspectRatio', type: 'dropdown', order: 2,
            default: 'smart',
            options: [
                { value: 'smart' },
                ...['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'].map((value) => ({ value }))
            ]
        },
        {
            id: 'falSeedance25Resolution', type: 'dropdown', order: 3,
            default: '720p',
            options: ['480p', '720p', '1080p'].map((value) => ({ value }))
        },
        {
            id: 'falSeedance25Duration', type: 'number', order: 4,
            default: 5, min: 4, max: 30, step: 1
        },
        {
            id: 'falSeedance25AutoDuration', type: 'switch', order: 5,
            default: false
        },
        {
            id: 'falSeedance25GenerateAudio', type: 'switch', order: 6,
            default: true
        },
        {
            id: 'falSeedance25Bitrate', type: 'dropdown', order: 7,
            default: 'standard',
            options: [{ value: 'standard' }, { value: 'high' }]
        }
    ],
    endpoints: {
        selector: async (params) => {
            const uploaded = Array.isArray(params.uploadedFilePaths) ? params.uploadedFilePaths : [];
            const images = uploaded.length > 0 ? uploaded : (Array.isArray(params.images) ? params.images : []);
            if (params.falSeedance25Mode === 'reference-to-video')
                return 'bytedance/seedance-2.5/reference-to-video';
            return images.length > 0 ? 'bytedance/seedance-2.5/image-to-video' : 'bytedance/seedance-2.5/text-to-video';
        }
    },
    request: {
        builder: (params) => {
            const clean = (value: JsonValue): string[] => Array.isArray(value)
                ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
            const pick = (primary: JsonValue, fallback: JsonValue): string[] => {
                const first = clean(primary);
                return first.length > 0 ? first : clean(fallback);
            };
            const images = pick(params.uploadedFilePaths, params.images);
            const videos = pick(params.uploadedVideoFilePaths, params.videos);
            const audios = pick(params.uploadedAudioFilePaths, params.audios);
            const ratios = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];
            const raw = String(params.falSeedance25AspectRatio || 'smart');
            const hint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0 ? params.__firstImageRatio : 16 / 9;
            let ratio = ratios.includes(raw) ? raw : '16:9';
            if (raw === 'smart' || raw === 'auto') {
                let difference = Number.POSITIVE_INFINITY;
                for (const candidate of ratios) {
                    const pair = candidate.split(':').map(Number);
                    const next = Math.abs(pair[0] / pair[1] - hint);
                    if (next < difference) {
                        difference = next;
                        ratio = candidate;
                    }
                }
            }
            const body: JsonObject = {
                prompt: typeof params.prompt === 'string' ? params.prompt : '',
                resolution: ['480p', '1080p'].includes(String(params.falSeedance25Resolution)) ? String(params.falSeedance25Resolution) : '720p',
                duration: params.falSeedance25AutoDuration === true
                    ? 'auto'
                    : String(Math.min(30, Math.max(4, Math.round(Number(params.falSeedance25Duration || 5))))),
                aspect_ratio: raw === 'smart' && (images.length + videos.length) > 0 ? 'auto' : ratio,
                generate_audio: params.falSeedance25GenerateAudio !== false,
                bitrate_mode: params.falSeedance25Bitrate === 'high' ? 'high' : 'standard'
            };
            if (params.falSeedance25Mode === 'reference-to-video') {
                if (images.length > 0)
                    body.image_urls = images.slice(0, 30);
                if (videos.length > 0)
                    body.video_urls = videos.slice(0, 10);
                if (audios.length > 0)
                    body.audio_urls = audios.slice(0, 10);
            }
            else if (images.length > 0) {
                body.image_url = images[0];
                if (images.length > 1)
                    body.end_image_url = images[1];
            }
            return body;
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => {
            const duration = params.falSeedance25AutoDuration === true
                ? 30
                : Math.min(30, Math.max(4, Math.round(Number(params.falSeedance25Duration || 5))));
            const rates: Record<string, number> = { '480p': 0.2205, '720p': 0.473, '1080p': 1.137 };
            const baseRate = rates[String(params.falSeedance25Resolution || '720p')] ?? rates['720p'];
            const uploadedVideos = Array.isArray(params.uploadedVideoFilePaths) ? params.uploadedVideoFilePaths : [];
            const videos = uploadedVideos.length > 0 ? uploadedVideos : (Array.isArray(params.videos) ? params.videos : []);
            const hasVideo = params.falSeedance25Mode === 'reference-to-video' && videos.length > 0;
            const inputDuration = typeof params.__firstVideoDurationSeconds === 'number' && params.__firstVideoDurationSeconds > 0
                ? params.__firstVideoDurationSeconds * videos.length
                : 0;
            return (duration + (hasVideo ? inputDuration : 0)) * baseRate * (hasVideo ? 0.6 : 1);
        },
        description: '输出约：480p $0.2205、720p $0.4730、1080p $1.137/秒；有视频参考时费率乘 0.6，并按输入与输出总时长计费；自动时长按 30 秒预估'
    }
});
export default falSeedance25Model;
