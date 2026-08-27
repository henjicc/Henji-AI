import { defineModel } from "../defineModel";
import type { JsonValue, JsonObject } from "../../types/runtime";
import { hasUploadedImage } from "../shared/mediaPresence";
export const klingVideoV26ProModel = defineModel({
    meta: {
        id: 'fal-ai-kling-video-v2.6-pro',
        canonicalModelId: 'kling-video-2.6-pro',
        seriesId: 'kling-video',
        seriesRank: 2.6,
        provider: 'fal',
        type: 'video',
        tags: ['video', 'text-to-video', 'image-to-video', 'motion-control']
    },
    inputLimits: {
        images: { max: 1 },
        videos: { max: 0 },
        rules: [
            {
                when: 'falKlingV26ProMode === "motion-control"',
                images: { exact: 1 },
                videos: { exact: 1 },
                videoConstraints: {
                    maxSizeMB: 100,
                    minDurationSec: 3,
                    maxDurationSec: 30
                }
            }
        ]
    },
    requirements: [
        {
            id: 'kling-v26-motion-image',
            when: 'falKlingV26ProMode === "motion-control"',
            require: { images: { exact: 1 } },
            message: {
                title: '图片必需',
                message: '动作控制模式需要上传1张图片（不能多也不能少）',
                type: 'warning'
            }
        },
        {
            id: 'kling-v26-motion-video',
            when: 'falKlingV26ProMode === "motion-control"',
            require: { videos: { exact: 1 } },
            message: {
                title: '视频必需',
                message: '动作控制模式需要上传1个视频（不能多也不能少）',
                type: 'warning'
            }
        }
    ],
    params: [
        {
            id: 'falKlingV26ProMode',
            order: 1,
            type: 'dropdown',
            default: 'text-image-to-video',
            options: [
                { value: 'text-image-to-video' },
                { value: 'motion-control' }
            ]
        },
        {
            id: 'falKlingV26ProResolution',
            order: 2,
            type: 'dropdown',
            default: '720p',
            visible: {
                condition: 'falKlingV26ProMode === "motion-control"'
            },
            options: [
                { value: '720p' },
                { value: '1080p' }
            ]
        },
        {
            id: 'falKlingV26ProCharacterOrientation',
            order: 3,
            type: 'dropdown',
            default: 'video',
            visible: {
                condition: 'falKlingV26ProMode === "motion-control"'
            },
            options: [
                { value: 'video' },
                { value: 'image' }
            ]
        },
        {
            id: 'falKlingV26ProKeepOriginalSound',
            order: 4,
            type: 'switch',
            default: true,
            visible: {
                condition: 'falKlingV26ProMode === "motion-control"'
            }
        },
        {
            id: 'falKlingV26ProVideoDuration',
            order: 5,
            type: 'dropdown',
            default: 5,
            visible: {
                condition: 'falKlingV26ProMode !== "motion-control"'
            },
            options: [
                { value: 5 },
                { value: 10 }
            ]
        },
        {
            id: 'falKlingV26ProAspectRatio',
            order: 6,
            type: 'dropdown',
            default: '16:9',
            visible: {
                condition: (params: JsonObject) => params.falKlingV26ProMode !== 'motion-control' &&
                    !hasUploadedImage(params)
            },
            options: [
                { value: '16:9' },
                { value: '9:16' },
                { value: '1:1' }
            ]
        },
        {
            id: 'falKlingV26ProCfgScale',
            order: 7,
            type: 'number',
            default: 0.5,
            min: 0,
            max: 1,
            step: 0.1,
            visible: {
                condition: (params: JsonObject) => params.falKlingV26ProMode !== 'motion-control' &&
                    !hasUploadedImage(params)
            }
        },
        {
            id: 'falKlingV26ProGenerateAudio',
            order: 8,
            type: 'switch',
            default: true,
            visible: {
                condition: 'falKlingV26ProMode !== "motion-control"'
            }
        }
    ],
    endpoints: {
        selector: async (params) => {
            const mode = params.falKlingV26ProMode || 'text-image-to-video';
            if (mode === 'motion-control') {
                const resolution = params.falKlingV26ProResolution || '720p';
                return resolution === '1080p'
                    ? 'fal-ai/kling-video/v2.6/pro/motion-control'
                    : 'fal-ai/kling-video/v2.6/standard/motion-control';
            }
            const filterSources = (value: JsonValue): string[] => Array.isArray(value)
                ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
                : [];
            const uploadedImages = filterSources(params.uploadedFilePaths);
            const images = uploadedImages.length > 0 ? uploadedImages : filterSources(params.images);
            return images.length > 0
                ? 'fal-ai/kling-video/v2.6/pro/image-to-video'
                : 'fal-ai/kling-video/v2.6/pro/text-to-video';
        }
    },
    request: {
        builder: (params) => {
            const mode = params.falKlingV26ProMode || 'text-image-to-video';
            const filterSources = (value: JsonValue): string[] => Array.isArray(value)
                ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
                : [];
            const uploadedImages = filterSources(params.uploadedFilePaths);
            const images = uploadedImages.length > 0 ? uploadedImages : filterSources(params.images);
            const uploadedVideos = filterSources(params.uploadedVideoFilePaths);
            const videos = uploadedVideos.length > 0 ? uploadedVideos : filterSources(params.videos);
            const prompt = params.prompt || '';
            const duration = params.falKlingV26ProVideoDuration || 5;
            const aspectRatio = params.falKlingV26ProAspectRatio || '16:9';
            const generateAudio = params.falKlingV26ProGenerateAudio !== false;
            const cfgScale = params.falKlingV26ProCfgScale;
            const characterOrientation = params.falKlingV26ProCharacterOrientation || 'video';
            const keepOriginalSound = params.falKlingV26ProKeepOriginalSound !== false;
            const videoInput = typeof params.video === 'string' ? params.video : videos[0];
            if (mode === 'motion-control') {
                const requestData: JsonObject = {
                    image_url: images[0],
                    video_url: videoInput,
                    character_orientation: characterOrientation,
                    keep_original_sound: keepOriginalSound
                };
                if (prompt) {
                    requestData.prompt = prompt;
                }
                return requestData;
            }
            const requestData: JsonObject = {
                prompt,
                duration: `${duration}`,
                generate_audio: generateAudio
            };
            if (images.length > 0) {
                requestData.image_url = images[0];
            }
            else {
                if (aspectRatio && aspectRatio !== 'auto') {
                    requestData.aspect_ratio = aspectRatio;
                }
                if (cfgScale !== undefined) {
                    requestData.cfg_scale = cfgScale;
                }
            }
            return requestData;
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => {
            const mode = params.falKlingV26ProMode || 'text-image-to-video';
            const duration = Number(params.falKlingV26ProVideoDuration) || 5;
            if (mode === 'motion-control') {
                const resolution = params.falKlingV26ProResolution || '720p';
                return (resolution === '1080p' ? 0.112 : 0.07) * duration;
            }
            const generateAudio = params.falKlingV26ProGenerateAudio !== false;
            return (generateAudio ? 0.14 : 0.07) * duration;
        },
        description: '无音频 $0.07/秒，有音频 $0.14/秒；动作控制 720p $0.07/秒，1080p $0.112/秒'
    }
});
export default klingVideoV26ProModel;
