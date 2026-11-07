import { defineModel } from "../defineModel";
import type { JsonValue, JsonObject } from "../../types/runtime";
import { resolveUploadedVideoDurationSeconds } from "../shared/mediaPresence";
export const klingVideoO1Model = defineModel({
    meta: {
        id: 'fal-ai-kling-video-o1',
        canonicalModelId: 'kling-video-o1',
        seriesId: 'kling-video',
        seriesRank: 10,
        provider: 'fal',
        type: 'video',
        tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'reference-mode', 'video-to-video']
    },
    inputLimits: {
        images: { max: 2 },
        videos: { max: 0 },
        rules: [
            {
                // 图生视频端点官方必填 start_image_url：没有首帧图时自动切到参考生视频（纯文字也能生成）。
                when: 'falKlingVideoO1Mode === "image-to-video"',
                images: { min: 1, max: 2 }
            },
            {
                when: 'falKlingVideoO1Mode === "reference-to-video"',
                images: { max: 7 }
            },
            {
                // 官方 schema：带视频时 elements + 参考图合计最多 4 张
                // （reference-to-video 无视频，上限才是 7）
                when: 'falKlingVideoO1Mode === "video-to-video-edit" || falKlingVideoO1Mode === "video-to-video-reference"',
                images: { max: 4 },
                videos: { exact: 1 }
            }
        ]
    },
    requirements: [
        {
            id: 'kling-video-o1-video-edit',
            when: 'falKlingVideoO1Mode === "video-to-video-edit" || falKlingVideoO1Mode === "video-to-video-reference"',
            require: { videos: { exact: 1 } },
            message: {
                title: '视频必需',
                message: '视频编辑/参考模式需要上传1个视频才能生成',
                type: 'warning'
            }
        }
    ],
    params: [
        {
            id: 'falKlingVideoO1Mode',
            order: 1,
            type: 'dropdown',
            default: 'image-to-video',
            options: [
                { value: 'image-to-video' },
                { value: 'reference-to-video' },
                { value: 'video-to-video-edit' },
                { value: 'video-to-video-reference' }
            ]
        },
        {
            id: 'falKlingVideoO1VideoDuration',
            order: 2,
            type: 'dropdown',
            default: 5,
            // 视频编辑的成片时长跟随输入视频，官方编辑端点没有时长字段。
            visible: {
                condition: 'falKlingVideoO1Mode !== "video-to-video-edit"'
            },
            options: [
                { value: 5 },
                { value: 10 }
            ]
        },
        {
            id: 'falKlingVideoO1AspectRatio',
            order: 3,
            type: 'dropdown',
            default: '16:9',
            visible: {
                condition: 'falKlingVideoO1Mode === "reference-to-video" || falKlingVideoO1Mode === "video-to-video-reference"'
            },
            options: [
                { value: 'auto' },
                { value: '16:9' },
                { value: '9:16' },
                { value: '1:1' }
            ]
        },
        {
            id: 'falKlingVideoO1KeepAudio',
            order: 4,
            type: 'switch',
            default: false,
            visible: {
                condition: 'falKlingVideoO1Mode === "video-to-video-edit" || falKlingVideoO1Mode === "video-to-video-reference"'
            }
        }
    ],
    endpoints: {
        selector: async (params) => {
            const mode = params.falKlingVideoO1Mode || 'image-to-video';
            switch (mode) {
                case 'image-to-video':
                    return 'fal-ai/kling-video/o1/image-to-video';
                case 'reference-to-video':
                    return 'fal-ai/kling-video/o1/reference-to-video';
                case 'video-to-video-edit':
                    return 'fal-ai/kling-video/o1/video-to-video/edit';
                case 'video-to-video-reference':
                    return 'fal-ai/kling-video/o1/video-to-video/reference';
                default:
                    return 'fal-ai/kling-video/o1/image-to-video';
            }
        }
    },
    request: {
        builder: (params) => {
            const mode = params.falKlingVideoO1Mode || 'image-to-video';
            const filterSources = (value: JsonValue): string[] => Array.isArray(value)
                ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
                : [];
            const uploadedImages = filterSources(params.uploadedFilePaths);
            const images = uploadedImages.length > 0 ? uploadedImages : filterSources(params.images);
            const uploadedVideos = filterSources(params.uploadedVideoFilePaths);
            const videos = uploadedVideos.length > 0 ? uploadedVideos : filterSources(params.videos);
            const prompt = params.prompt || '';
            const duration = params.falKlingVideoO1VideoDuration || 5;
            const aspectRatio = params.falKlingVideoO1AspectRatio;
            const keepAudio = params.falKlingVideoO1KeepAudio || false;
            const videoInput = typeof params.video === 'string' ? params.video : videos[0];
            const requestData: JsonObject = mode === 'video-to-video-edit'
                ? { prompt }
                : { prompt, duration: `${duration}` };
            if (mode === 'image-to-video') {
                if (images.length > 0) {
                    requestData.start_image_url = images[0];
                    if (images.length > 1) {
                        requestData.end_image_url = images[1];
                    }
                }
            }
            if (mode === 'reference-to-video') {
                if (images.length > 0) {
                    requestData.image_urls = images;
                }
                if (aspectRatio && aspectRatio !== 'auto') {
                    requestData.aspect_ratio = aspectRatio;
                }
            }
            if (mode === 'video-to-video-edit' || mode === 'video-to-video-reference') {
                if (videoInput) {
                    requestData.video_url = videoInput;
                }
                requestData.keep_audio = keepAudio;
                if (images.length > 0) {
                    requestData.image_urls = images;
                }
                if (mode === 'video-to-video-reference' && aspectRatio && aspectRatio !== 'auto') {
                    requestData.aspect_ratio = aspectRatio;
                }
            }
            return requestData;
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => {
            const mode = params.falKlingVideoO1Mode || 'image-to-video';
            const chosen = Number(params.falKlingVideoO1VideoDuration) || 5;
            // 编辑按输入视频时长计费；读不到时长时按官方输入上限 10 秒估，宁高勿低。
            const duration = mode === 'video-to-video-edit' ? resolveUploadedVideoDurationSeconds(params, 10) : chosen;
            const isVideoEdit = mode === 'video-to-video-edit' || mode === 'video-to-video-reference';
            return (isVideoEdit ? 0.168 : 0.112) * duration;
        },
        description: '图生视频/参考生视频 $0.112/秒；视频参考 $0.168/秒；视频编辑 $0.168/秒，按输入视频时长计'
    }
});
export default klingVideoO1Model;
