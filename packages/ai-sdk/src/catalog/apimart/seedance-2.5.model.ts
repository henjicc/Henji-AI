import { defineModel } from "../defineModel";
import { countUploadedVideos, resolveUploadedVideoDurationSeconds } from '../shared/mediaPresence';
import type { JsonValue, JsonObject } from "../../types/runtime";
export const apimartSeedance25Model = defineModel({
    meta: {
        id: 'apimart-seedance-2.5', canonicalModelId: 'seedance-2.5', seriesId: 'seedance', seriesRank: 2.5,
        provider: 'apimart', type: 'video',
        tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'reference-mode', 'multi-mode-switch', 'mixed-upload-mode', 'supports-audio-generation', 'provider-apimart'],
        aliases: ['seedance-2-5-apimart'], polling: { interval: 3000, maxAttempts: 400, expectedAttempts: 100 }
    },
    inputLimits: {
        images: { max: 2 }, videos: { max: 0 }, audios: { max: 0 },
        rules: [{ when: 'apimartSeedance25Mode === "reference-to-video"', images: { max: 30 }, videos: { max: 10 }, audios: { max: 10 } }]
    },
    params: [
        {
            id: 'apimartSeedance25Mode', type: 'dropdown', order: 1,
            default: 'reference-to-video',
            options: [
                { value: 'text-image-to-video' },
                { value: 'reference-to-video' }
            ]
        },
        {
            id: 'apimartSeedance25TaskType', type: 'dropdown', order: 2,
            default: 'auto',
            visible: { condition: 'apimartSeedance25Mode === "reference-to-video"' },
            options: [
                { value: 'auto' },
                { value: 'reference' },
                { value: 'edit' },
                { value: 'extend' }
            ]
        },
        {
            id: 'apimartSeedance25AspectRatio', type: 'dropdown', order: 3,
            default: 'smart',
            options: [{ value: 'smart' }, ...['1:1', '4:3', '3:4', '16:9', '9:16', '21:9'].map((ratio) => ({ value: ratio }))]
        },
        {
            id: 'apimartSeedance25Resolution', type: 'dropdown', order: 4,
            default: '720p',
            options: ['480p', '720p', '1080p'].map((value) => ({ value }))
        },
        {
            id: 'apimartSeedance25Duration', type: 'number', order: 5,
            default: 5, min: 4, max: 30, step: 1
        },
        {
            id: 'apimartSeedance25AutoDuration', type: 'switch', order: 6,
            default: false
        },
        {
            id: 'apimartSeedance25GenerateAudio', type: 'switch', order: 7,
            default: true
        },
        {
            id: 'apimartSeedance25ReturnLastFrame', type: 'switch', order: 8,
            default: false
        },
        {
            id: 'apimartSeedance25WebSearch', type: 'switch', order: 9,
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
            const raw = String(params.apimartSeedance25AspectRatio || 'smart');
            const mode = params.apimartSeedance25Mode === 'reference-to-video' ? 'reference-to-video' : 'text-image-to-video';
            const taskType = ['reference', 'edit', 'extend'].includes(String(params.apimartSeedance25TaskType))
                ? String(params.apimartSeedance25TaskType)
                : 'auto';
            const hasFrames = mode === 'text-image-to-video' && images.length > 0;
            let size = ratios.includes(raw) ? raw : 'adaptive';
            if (raw === 'smart' || raw === 'adaptive' || raw === 'auto' || hasFrames || taskType === 'edit' || taskType === 'extend') {
                size = 'adaptive';
            }
            if ((taskType === 'edit' || taskType === 'extend') && videos.length === 0) {
                throw new Error(`Seedance 2.5 的${taskType === 'edit' ? '视频编辑' : '视频延长'}任务至少需要一个参考视频`);
            }
            const autoDuration = params.apimartSeedance25AutoDuration === true || taskType === 'edit';
            const body: JsonObject = {
                model: 'seedance-2.5', prompt: typeof params.prompt === 'string' ? params.prompt.slice(0, 30000) : '',
                duration: autoDuration ? -1 : Math.min(30, Math.max(4, Math.round(Number(params.apimartSeedance25Duration || 5)))),
                size,
                resolution: params.apimartSeedance25Resolution === '480p' || params.apimartSeedance25Resolution === '1080p'
                    ? params.apimartSeedance25Resolution : '720p',
                generate_audio: params.apimartSeedance25GenerateAudio !== false,
                return_last_frame: params.apimartSeedance25ReturnLastFrame === true,
                nsfw_check: false
            };
            if (params.apimartSeedance25WebSearch === true)
                body.tools = [{ type: 'web_search' }];
            if (mode === 'reference-to-video') {
                body.omni_reference_task_type = taskType;
                if (images.length > 0)
                    body.image_urls = images.slice(0, 30);
                if (videos.length > 0)
                    body.video_urls = videos.slice(0, 10);
                if (audios.length > 0)
                    body.audio_urls = audios.slice(0, 10);
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
            const autoDuration = params.apimartSeedance25AutoDuration === true || params.apimartSeedance25TaskType === 'edit';
            const duration = autoDuration ? 30 : Math.min(30, Math.max(4, Math.round(Number(params.apimartSeedance25Duration || 5))));
            const rates: Record<string, {
                noVideo: number;
                withVideo: number;
            }> = {
                '480p': { noVideo: 0.09608, withVideo: 0.0576 },
                '720p': { noVideo: 0.216, withVideo: 0.1296 },
                '1080p': { noVideo: 0.38488, withVideo: 0.22992 }
            };
            const rate = rates[String(params.apimartSeedance25Resolution || '720p')] ?? rates['720p'];
            const hasVideo = params.apimartSeedance25Mode === 'reference-to-video' && countUploadedVideos(params) > 0;
            const inputDuration = hasVideo ? resolveUploadedVideoDurationSeconds(params) : 0;
            return (duration + (hasVideo ? inputDuration : 0)) * (hasVideo ? rate.withVideo : rate.noVideo);
        },
        description: '无/有视频输入每秒：480p $0.09608/$0.0576，720p $0.216/$0.1296，1080p $0.38488/$0.22992；有视频时按输入与输出总时长计费，自动时长按 30 秒预估'
    }
});
export default apimartSeedance25Model;
