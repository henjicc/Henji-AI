import { defineModel } from "../defineModel";
import type { JsonValue, JsonObject } from "../../types/runtime";
export const pixverseV55Model = defineModel({
    meta: {
        id: 'fal-ai-pixverse-v5.5',
        canonicalModelId: 'pixverse-v5.5',
        seriesId: 'pixverse',
        seriesRank: 5.5,
        provider: 'fal',
        type: 'video',
        tags: ['video', 'text-to-video', 'image-to-video', 'start-end-frame']
    },
    inputLimits: {
        images: { max: 2 },
        videos: { max: 0 }
    },
    params: [
        {
            id: 'pixverseAspectRatio',
            order: 1,
            type: 'dropdown',
            default: '16:9',
            options: [
                { value: 'smart' },
                { value: '16:9' },
                { value: '4:3' },
                { value: '1:1' },
                { value: '3:4' },
                { value: '9:16' }
            ]
        },
        {
            id: 'pixverseResolution',
            order: 2,
            type: 'dropdown',
            default: '720p',
            options: [
                { value: '720p' },
                { value: '1080p' }
            ]
        },
        {
            id: 'falPixverse55VideoDuration',
            order: 3,
            type: 'dropdown',
            default: 5,
            options: [
                { value: 5 },
                { value: 10 }
            ]
        },
        {
            id: 'pixverseStyle',
            order: 4,
            type: 'dropdown',
            // 官方枚举只有这 5 个；此前的 realistic 不在其中，选中会把非法值发给 API
            default: 'none',
            options: [
                { value: 'none' },
                { value: 'anime' },
                { value: '3d_animation' },
                { value: 'clay' },
                { value: 'comic' },
                { value: 'cyberpunk' }
            ]
        },
        {
            id: 'pixverseThinkingType',
            order: 5,
            type: 'dropdown',
            // 官方枚举是 enabled / disabled / auto；此前的 normal / enhanced 不被接口接受
            default: 'auto',
            options: [
                { value: 'auto' },
                { value: 'enabled' },
                { value: 'disabled' }
            ]
        },
        {
            id: 'pixverseGenerateAudio',
            order: 6,
            type: 'switch',
            default: true
        },
        {
            id: 'pixverseMultiClip',
            order: 7,
            type: 'switch',
            default: false
        }
    ],
    endpoints: {
        selector: async (params) => {
            const filterSources = (value: JsonValue): string[] => Array.isArray(value)
                ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
                : [];
            const uploaded = filterSources(params.uploadedFilePaths);
            const images = uploaded.length > 0 ? uploaded : filterSources(params.images);
            if (images.length === 0) {
                return 'fal-ai/pixverse/v5.5/text-to-video';
            }
            if (images.length === 1) {
                return 'fal-ai/pixverse/v5.5/image-to-video';
            }
            return 'fal-ai/pixverse/v5.5/transition';
        }
    },
    request: {
        builder: (params) => {
            const filterSources = (value: JsonValue): string[] => Array.isArray(value)
                ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
                : [];
            const uploaded = filterSources(params.uploadedFilePaths);
            const images = uploaded.length > 0 ? uploaded : filterSources(params.images);
            const prompt = params.prompt || '';
            const aspectRatio = params.pixverseAspectRatio;
            const resolution = params.pixverseResolution;
            const duration = params.falPixverse55VideoDuration || 5;
            const requestData: JsonObject = { prompt };
            if (aspectRatio && aspectRatio !== 'smart' && aspectRatio !== 'auto') {
                requestData.aspect_ratio = aspectRatio;
            }
            if (resolution) {
                requestData.resolution = resolution;
            }
            requestData.duration = String(duration);
            if (params.pixverseStyle && params.pixverseStyle !== 'none') {
                requestData.style = params.pixverseStyle;
            }
            if (params.pixverseThinkingType) {
                requestData.thinking_type = params.pixverseThinkingType;
            }
            requestData.generate_audio_switch = params.pixverseGenerateAudio !== false;
            if (params.pixverseMultiClip !== undefined) {
                requestData.generate_multi_clip_switch = params.pixverseMultiClip;
            }
            if (images.length === 1) {
                requestData.image_url = images[0];
            }
            else if (images.length >= 2) {
                requestData.first_image_url = images[0];
                requestData.end_image_url = images[1];
            }
            return requestData;
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => {
            const isTransition = (() => {
                const uploaded = Array.isArray(params.uploadedFilePaths)
                    ? params.uploadedFilePaths.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
                    : [];
                const images = uploaded.length > 0
                    ? uploaded
                    : (Array.isArray(params.images)
                        ? params.images.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
                        : []);
                return images.length >= 2;
            })();
            const resolution = params.pixverseResolution === '1080p' ? '1080p' : '720p';
            const base = isTransition
                ? (resolution === '1080p' ? 1.2 : 0.6)
                : (resolution === '1080p' ? 0.4 : 0.2);
            const audio = params.pixverseGenerateAudio !== false;
            const multiClip = params.pixverseMultiClip === true;
            const surcharge = multiClip
                ? (isTransition ? (audio ? 0.4 : 0.3) : (audio ? 0.15 : 0.1))
                : (audio ? (isTransition ? 0.1 : 0.05) : 0);
            const duration = Number(params.falPixverse55VideoDuration) || 5;
            const durationMultiplier = duration === 10 ? 2.2 : (duration === 8 ? 2 : 1);
            return (base + surcharge) * durationMultiplier;
        },
        description: '单clip无音频 5s：720p $0.20、1080p $0.40；转场（双图）5s：720p $0.60、1080p $1.20；音频 +$0.05（转场 +$0.10）；多clip +$0.10/$0.15（转场 +$0.30/$0.40）；8s 双倍，10s 2.2倍且不支持 1080p'
    }
});
export default pixverseV55Model;
