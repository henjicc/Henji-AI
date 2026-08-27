import { defineModel } from "../defineModel";
import type { JsonValue, JsonObject } from "../../types/runtime";
import { hasUploadedImage, resolveKieImageSources } from './mediaSources';
const KIE_CREATE_TASK_ENDPOINT = '/api/v1/jobs/createTask';
export const kieSeedanceV1Model = defineModel({
    meta: {
        id: 'kie-seedance-v1',
        canonicalModelId: 'seedance-v1',
        seriesId: 'seedance',
        seriesRank: 1.0,
        provider: 'kie',
        type: 'video',
        tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'max-images-2', 'fast-mode', 'provider-kie'],
        aliases: ['seedance-v1-kie', 'kie-seedance-1.0'],
        polling: {
            interval: 3000,
            maxAttempts: 180,
            expectedAttempts: 60
        }
    },
    inputLimits: {
        images: { max: 2 },
        videos: { max: 0 },
        rules: [
            {
                when: 'kieSeedanceV1Version === "pro"',
                images: { max: 1 }
            },
            {
                when: 'kieSeedanceV1Version === "pro" && kieSeedanceV1FastMode === true',
                images: { min: 1, max: 1 }
            }
        ]
    },
    requirements: [
        {
            id: 'seedance-v1-pro-single-image',
            when: 'kieSeedanceV1Version === "pro"',
            require: { images: { max: 1 } },
            message: {
                title: '图片数量过多',
                message: 'Pro 版本最多支持 1 张输入图片；首尾帧请使用 Lite 版本。',
                type: 'warning'
            }
        },
        {
            id: 'seedance-v1-pro-fast-image',
            when: 'kieSeedanceV1Version === "pro" && kieSeedanceV1FastMode === true',
            require: { images: { exact: 1 } },
            message: {
                title: '图片必需',
                message: 'Pro 快速模式需要上传 1 张图片，且不支持首尾帧。',
                type: 'warning'
            }
        }
    ],
    params: [
        {
            id: 'kieSeedanceV1Version',
            type: 'dropdown',
            order: 1,
            default: 'lite',
            options: [
                { value: 'lite' },
                { value: 'pro' }
            ]
        },
        {
            id: 'kieSeedanceV1FastMode',
            type: 'switch',
            order: 2,
            default: false,
            visible: {
                condition: (params: JsonObject) => params.kieSeedanceV1Version === 'pro' &&
                    hasUploadedImage(params)
            }
        },
        {
            id: 'kieSeedanceV1Duration',
            type: 'dropdown',
            order: 3,
            default: '5',
            options: [
                { value: '5' },
                { value: '10' }
            ]
        },
        {
            id: 'kieSeedanceV1AspectRatio',
            type: 'dropdown',
            order: 4,
            default: 'smart',
            visible: {
                condition: (params: JsonObject) => !hasUploadedImage(params)
            },
            options: [
                { value: 'smart' },
                { value: '21:9' },
                { value: '16:9' },
                { value: '4:3' },
                { value: '1:1' },
                { value: '3:4' },
                { value: '9:16' },
                { value: '9:21' }
            ]
        },
        {
            id: 'kieSeedanceV1Resolution',
            type: 'dropdown',
            order: 5,
            default: '720p',
            options: [
                { value: '480p' },
                { value: '720p' },
                { value: '1080p' }
            ]
        },
        {
            id: 'kieSeedanceV1CameraFixed',
            type: 'switch',
            order: 6,
            default: false,
            visible: {
                condition: 'kieSeedanceV1FastMode !== true'
            }
        }
    ],
    endpoints: KIE_CREATE_TASK_ENDPOINT,
    request: {
        builder: (params) => {
            const images = resolveKieImageSources(params);
            const prompt = params.prompt || '';
            const version = params.kieSeedanceV1Version || params.version || 'lite';
            const fastMode = params.kieSeedanceV1FastMode === true;
            const duration = String(params.kieSeedanceV1Duration || params.duration || '5');
            let resolution = params.kieSeedanceV1Resolution || params.resolution || '720p';
            const cameraFixed = params.kieSeedanceV1CameraFixed !== undefined
                ? params.kieSeedanceV1CameraFixed
                : (params.camera_fixed !== undefined ? params.camera_fixed : false);
            const aspectRatio = params.kieSeedanceV1AspectRatio || params.aspect_ratio || 'smart';
            const supportedTextRatios = version === 'pro'
                ? ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']
                : ['16:9', '4:3', '1:1', '3:4', '9:16', '9:21'];
            const normalizeRatio = (value: string): string => {
                if (value && value !== 'smart' && value !== 'auto' && supportedTextRatios.includes(value)) {
                    return value;
                }
                const ratioHint = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0
                    ? params.__firstImageRatio
                    : 1;
                let best = '1:1';
                let bestDiff = Number.POSITIVE_INFINITY;
                for (const ratioText of supportedTextRatios) {
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
            if (version === 'pro' && fastMode && images.length > 0 && resolution === '480p') {
                resolution = '720p';
            }
            let model: string;
            if (images.length === 0) {
                model = version === 'pro'
                    ? 'bytedance/v1-pro-text-to-video'
                    : 'bytedance/v1-lite-text-to-video';
            }
            else if (version === 'pro' && fastMode) {
                model = 'bytedance/v1-pro-fast-image-to-video';
            }
            else {
                model = version === 'pro'
                    ? 'bytedance/v1-pro-image-to-video'
                    : 'bytedance/v1-lite-image-to-video';
            }
            const input: JsonObject = {
                prompt,
                resolution,
                duration,
                nsfw_checker: true
            };
            if (images.length === 0) {
                input.aspect_ratio = normalizeRatio(String(aspectRatio));
            }
            else {
                input.image_url = images[0];
            }
            if (!(version === 'pro' && fastMode && images.length > 0)) {
                input.camera_fixed = cameraFixed;
                input.seed = -1;
            }
            if (version === 'lite' && images.length > 1) {
                input.end_image_url = images[1];
            }
            if (!(version === 'pro' && fastMode && images.length > 0) && !(version === 'lite' && images.length > 0)) {
                input.enable_safety_checker = true;
            }
            return {
                model,
                input
            };
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => {
            const version = params.kieSeedanceV1Version || 'lite';
            const fastMode = params.kieSeedanceV1FastMode === true;
            const resolution = params.kieSeedanceV1Resolution || '720p';
            const duration = Number(params.kieSeedanceV1Duration || 5);
            if (version === 'pro' && fastMode) {
                if (resolution === '1080p')
                    return duration === 10 ? 0.36 : 0.18;
                return duration === 10 ? 0.18 : 0.08;
            }
            const perSecond = version === 'pro'
                ? { '480p': 0.014, '720p': 0.03, '1080p': 0.07 }
                : { '480p': 0.01, '720p': 0.0225, '1080p': 0.05 };
            const rate = perSecond[resolution as keyof typeof perSecond] ?? perSecond['720p'];
            return rate * duration;
        },
        description: 'Lite: $0.010/$0.0225/$0.050 per second for 480p/720p/1080p; Pro: $0.014/$0.030/$0.070 per second; Pro Fast: $0.080-$0.360 per video'
    }
});
export default kieSeedanceV1Model;
