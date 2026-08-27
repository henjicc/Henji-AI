import { defineModel } from "../defineModel";
import type { JsonValue, JsonObject } from "../../types/runtime";
export const ltx2Model = defineModel({
    meta: {
        id: 'fal-ai-ltx-2',
        canonicalModelId: 'ltx-2',
        provider: 'fal',
        type: 'video',
        tags: ['video', 'text-to-video', 'image-to-video']
    },
    inputLimits: {
        images: { max: 0 },
        videos: { max: 0 },
        rules: [
            {
                when: 'falLtx2Mode === "image-to-video"',
                images: { max: 1 }
            },
            {
                when: 'falLtx2Mode === "retake-video"',
                images: { max: 0 },
                videos: { exact: 1 }
            }
        ]
    },
    requirements: [
        {
            id: 'ltx-2-retake-video',
            when: 'falLtx2Mode === "retake-video"',
            require: { videos: { exact: 1 } },
            message: {
                title: '视频必需',
                message: '视频编辑模式需要上传1个视频才能生成',
                type: 'warning'
            }
        }
    ],
    params: [
        {
            id: 'falLtx2Mode',
            order: 1,
            type: 'dropdown',
            default: 'text-to-video',
            options: [
                { value: 'text-to-video' },
                { value: 'image-to-video' },
                { value: 'retake-video' }
            ]
        },
        {
            id: 'falLtx2Resolution',
            order: 2,
            type: 'dropdown',
            default: '1080p',
            visible: {
                condition: 'falLtx2Mode !== "retake-video"'
            },
            options: [
                { value: '1080p' },
                { value: '1440p' },
                { value: '2160p' }
            ]
        },
        {
            id: 'falLtx2VideoDuration',
            order: 3,
            type: 'dropdown',
            default: 6,
            visible: {
                condition: 'falLtx2Mode !== "retake-video"'
            },
            options: [
                { value: 6 },
                { value: 8 },
                { value: 10 }
            ]
        },
        {
            id: 'falLtx2RetakeDuration',
            order: 4,
            type: 'number',
            default: 5,
            min: 2,
            max: 20,
            step: 1,
            visible: {
                condition: 'falLtx2Mode === "retake-video"'
            }
        },
        {
            id: 'falLtx2Fps',
            order: 5,
            type: 'dropdown',
            default: 25,
            visible: {
                condition: 'falLtx2Mode !== "retake-video"'
            },
            options: [
                { value: 25 },
                { value: 50 }
            ]
        },
        {
            id: 'falLtx2GenerateAudio',
            order: 6,
            type: 'switch',
            default: true,
            visible: {
                condition: 'falLtx2Mode !== "retake-video"'
            }
        },
        {
            id: 'falLtx2FastMode',
            order: 7,
            type: 'switch',
            default: true,
            visible: {
                condition: 'falLtx2Mode !== "retake-video"'
            }
        },
        {
            id: 'falLtx2RetakeStartTime',
            order: 8,
            type: 'number',
            default: 0,
            min: 0,
            max: 20,
            step: 1,
            visible: {
                condition: 'falLtx2Mode === "retake-video"'
            }
        },
        {
            id: 'falLtx2RetakeMode',
            order: 9,
            type: 'dropdown',
            default: 'replace_audio_and_video',
            visible: {
                condition: 'falLtx2Mode === "retake-video"'
            },
            options: [
                { value: 'replace_audio' },
                { value: 'replace_video' },
                { value: 'replace_audio_and_video' }
            ]
        }
    ],
    endpoints: {
        selector: async (params) => {
            const mode = params.falLtx2Mode || 'text-to-video';
            const fastMode = params.falLtx2FastMode !== false;
            if (mode === 'retake-video') {
                return 'fal-ai/ltx-2/retake-video';
            }
            if (mode === 'image-to-video') {
                return fastMode ? 'fal-ai/ltx-2/image-to-video/fast' : 'fal-ai/ltx-2/image-to-video';
            }
            return fastMode ? 'fal-ai/ltx-2/text-to-video/fast' : 'fal-ai/ltx-2/text-to-video';
        }
    },
    request: {
        builder: (params) => {
            const mode = params.falLtx2Mode || 'text-to-video';
            const filterSources = (value: JsonValue): string[] => Array.isArray(value)
                ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
                : [];
            const uploadedImages = filterSources(params.uploadedFilePaths);
            const images = uploadedImages.length > 0 ? uploadedImages : filterSources(params.images);
            const uploadedVideos = filterSources(params.uploadedVideoFilePaths);
            const videos = uploadedVideos.length > 0 ? uploadedVideos : filterSources(params.videos);
            const prompt = params.prompt || '';
            const duration = params.falLtx2VideoDuration || 6;
            const resolution = params.falLtx2Resolution || '1080p';
            const fps = params.falLtx2Fps || 25;
            const generateAudio = params.falLtx2GenerateAudio !== false;
            const retakeStartTime = params.falLtx2RetakeStartTime || 0;
            const retakeMode = params.falLtx2RetakeMode || 'replace_audio_and_video';
            const retakeDuration = params.falLtx2RetakeDuration || duration;
            const videoInput = typeof params.video === 'string' ? params.video : videos[0];
            if (mode === 'retake-video') {
                return {
                    prompt,
                    video_url: videoInput,
                    start_time: retakeStartTime,
                    duration: retakeDuration,
                    retake_mode: retakeMode
                };
            }
            const requestData: JsonObject = {
                prompt,
                duration,
                resolution,
                aspect_ratio: '16:9',
                fps,
                generate_audio: generateAudio
            };
            if (mode === 'image-to-video' && images.length > 0) {
                requestData.image_url = images[0];
            }
            return requestData;
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => {
            const mode = params.falLtx2Mode || 'text-to-video';
            if (mode === 'retake-video') {
                const retakeDuration = Number(params.falLtx2RetakeDuration) || 5;
                return 0.1 * retakeDuration;
            }
            const duration = Number(params.falLtx2VideoDuration) || 6;
            const fastMode = params.falLtx2FastMode !== false;
            const resolution = params.falLtx2Resolution || '1080p';
            const ratePerSecond: Record<string, number> = fastMode
                ? { '1080p': 0.04, '1440p': 0.08, '2160p': 0.16 }
                : { '1080p': 0.06, '1440p': 0.12, '2160p': 0.24 };
            return (ratePerSecond[resolution as string] ?? ratePerSecond['1080p']) * duration;
        },
        description: '快速：1080p $0.04/秒、1440p $0.08/秒、2160p $0.16/秒；标准：1080p $0.06/秒、1440p $0.12/秒、2160p $0.24/秒；视频重拍 $0.10/秒'
    }
});
export default ltx2Model;
