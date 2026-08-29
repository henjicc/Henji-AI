import { defineModel } from "../defineModel";
import type { JsonObject } from "../../types/runtime";
import { hasUploadedImage, resolveUploadedImageSources } from "../shared/mediaPresence";
export const falKling30OmniModel = defineModel({
    meta: {
        id: 'fal-ai-kling-3.0-omni', canonicalModelId: 'kling-video-3.0-omni', seriesId: 'kling-video', seriesRank: 3.02,
        provider: 'fal', type: 'video',
        tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'reference-mode', 'supports-multi-image', 'supports-audio-generation', 'multi-mode-switch', 'provider-fal'],
        aliases: ['kling-o3-fal'], polling: { interval: 3000, maxAttempts: 300, expectedAttempts: 75 }
    },
    inputLimits: {
        images: { max: 2 }, videos: { max: 0 }, audios: { max: 0 },
        rules: [{ when: 'falKling30OmniMode === "reference-to-video"', images: { max: 7 } }]
    },
    params: [
        {
            id: 'falKling30OmniMode', type: 'dropdown', order: 1,
            default: 'text-image-to-video',
            options: [
                { value: 'text-image-to-video' },
                { value: 'reference-to-video' }
            ]
        },
        {
            id: 'falKling30OmniAspectRatio', type: 'dropdown', order: 2,
            default: 'smart',
            visible: {
                condition: (params: JsonObject) => params.falKling30OmniMode === 'reference-to-video' ||
                    !hasUploadedImage(params)
            },
            options: [
                { value: 'smart' },
                { value: '16:9' }, { value: '9:16' }, { value: '1:1' }
            ]
        },
        {
            id: 'falKling30OmniResolution', type: 'dropdown', order: 3,
            default: 'standard',
            options: [
                { value: 'standard' },
                { value: 'pro' }
            ]
        },
        {
            id: 'falKling30OmniDuration', type: 'number', order: 4,
            default: 5, min: 3, max: 15, step: 1
        },
        {
            id: 'falKling30OmniGenerateAudio', type: 'switch', order: 5,
            default: false
        }
    ],
    endpoints: {
        selector: async (params) => {
            const images = resolveUploadedImageSources(params);
            const tier = params.falKling30OmniResolution === 'pro' ? 'pro' : 'standard';
            const mode = params.falKling30OmniMode === 'reference-to-video'
                ? 'reference-to-video' : (images.length > 0 ? 'image-to-video' : 'text-to-video');
            return `fal-ai/kling-video/o3/${tier}/${mode}`;
        }
    },
    request: {
        builder: (params) => {
            const images = resolveUploadedImageSources(params);
            const raw = String(params.falKling30OmniAspectRatio || 'smart');
            const ratio = ['9:16', '1:1'].includes(raw) ? raw : '16:9';
            const body: JsonObject = {
                prompt: typeof params.prompt === 'string' ? params.prompt : '',
                duration: String(Math.min(15, Math.max(3, Math.round(Number(params.falKling30OmniDuration || 5))))),
                generate_audio: params.falKling30OmniGenerateAudio === true,
                shot_type: 'customize'
            };
            if (params.falKling30OmniMode === 'reference-to-video') {
                body.aspect_ratio = ratio;
                if (images.length > 0)
                    body.image_urls = images.slice(0, 7);
            }
            else if (images.length > 0) {
                body.image_url = images[0];
                if (images.length > 1)
                    body.end_image_url = images[1];
            }
            else {
                body.aspect_ratio = ratio;
            }
            return body;
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => {
            const duration = Math.min(15, Math.max(3, Math.round(Number(params.falKling30OmniDuration || 5))));
            const audio = params.falKling30OmniGenerateAudio === true;
            const pro = params.falKling30OmniResolution === 'pro';
            return duration * (pro ? (audio ? 0.14 : 0.112) : (audio ? 0.112 : 0.084));
        },
        description: '标准 $0.084/$0.112，专业 $0.112/$0.14 每秒（无/有音频）'
    }
});
export default falKling30OmniModel;
