import { defineModel } from "../defineModel";
import type { JsonValue, JsonObject } from "../../types/runtime";
export const falKling30Model = defineModel({
    meta: {
        id: 'fal-ai-kling-3.0', canonicalModelId: 'kling-video-3.0', seriesId: 'kling-video', seriesRank: 3,
        provider: 'fal', type: 'video',
        tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'supports-audio-generation', 'provider-fal'],
        aliases: ['kling-v3-fal'], polling: { interval: 3000, maxAttempts: 300, expectedAttempts: 75 }
    },
    inputLimits: { images: { max: 2 }, videos: { max: 0 }, audios: { max: 0 } },
    params: [
        {
            id: 'falKling30AspectRatio', type: 'dropdown', order: 1,
            default: 'smart',
            options: [
                { value: 'smart' },
                { value: '16:9' }, { value: '9:16' }, { value: '1:1' }
            ]
        },
        {
            id: 'falKling30Resolution', type: 'dropdown', order: 2,
            default: 'standard',
            options: [
                { value: 'standard' },
                { value: 'pro' }
            ]
        },
        {
            id: 'falKling30Duration', type: 'number', order: 3,
            default: 5, min: 3, max: 15, step: 1
        },
        {
            id: 'falKling30GenerateAudio', type: 'switch', order: 4,
            default: true
        }
    ],
    endpoints: {
        selector: async (params) => {
            const uploaded = Array.isArray(params.uploadedFilePaths) ? params.uploadedFilePaths : [];
            const images = uploaded.length > 0 ? uploaded : (Array.isArray(params.images) ? params.images : []);
            const tier = params.falKling30Resolution === 'pro' ? 'pro' : 'standard';
            return `fal-ai/kling-video/v3/${tier}/${images.length > 0 ? 'image-to-video' : 'text-to-video'}`;
        }
    },
    request: {
        builder: (params) => {
            const clean = (value: JsonValue): string[] => Array.isArray(value)
                ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
            const uploaded = clean(params.uploadedFilePaths);
            const images = uploaded.length > 0 ? uploaded : clean(params.images);
            const raw = String(params.falKling30AspectRatio || 'smart');
            const body: JsonObject = {
                prompt: typeof params.prompt === 'string' ? params.prompt : '',
                duration: String(Math.min(15, Math.max(3, Math.round(Number(params.falKling30Duration || 5))))),
                generate_audio: params.falKling30GenerateAudio !== false,
                shot_type: 'customize'
            };
            if (images.length > 0) {
                body.start_image_url = images[0];
                if (images.length > 1)
                    body.end_image_url = images[1];
            }
            else {
                body.aspect_ratio = ['9:16', '1:1'].includes(raw) ? raw : '16:9';
                body.cfg_scale = 0.5;
            }
            return body;
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => {
            const duration = Math.min(15, Math.max(3, Math.round(Number(params.falKling30Duration || 5))));
            const audio = params.falKling30GenerateAudio !== false;
            const pro = params.falKling30Resolution === 'pro';
            return duration * (pro ? (audio ? 0.168 : 0.112) : (audio ? 0.126 : 0.084));
        },
        description: '标准 $0.084/$0.126，专业 $0.112/$0.168 每秒（无/有音频）'
    }
});
export default falKling30Model;
