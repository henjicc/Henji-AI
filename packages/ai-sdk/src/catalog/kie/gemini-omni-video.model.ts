import { defineModel } from "../defineModel";
import type { JsonValue, JsonObject } from "../../types/runtime";
import { hasUploadedVideo } from './mediaSources';
const KIE_CREATE_TASK_ENDPOINT = '/api/v1/jobs/createTask';
export const kieGeminiOmniVideoModel = defineModel({
    meta: {
        id: 'kie-gemini-omni-video',
        canonicalModelId: 'gemini-omni-video',
        provider: 'kie',
        type: 'video',
        tags: ['text-to-video', 'image-to-video', 'multi-image-reference', 'video-reference', 'provider-kie'],
        polling: {
            interval: 3000,
            maxAttempts: 180,
            expectedAttempts: 60
        }
    },
    inputLimits: {
        images: { max: 7 },
        videos: { max: 1 },
        rules: [
            {
                videoConstraints: {
                    maxDurationSec: 30,
                    maxSizeMB: 100,
                    trim: { maxClipSeconds: 10 }
                }
            },
            {
                // when 表达式在 with(params){with(context){...}} 里执行：bare 引用一个在 params/context
                // 上都不存在的标识符会直接抛 ReferenceError（画布只有 videos，没有 uploadedVideoFilePaths/
                // uploadedVideos；对话面板反过来），必须用 typeof 守卫，不能像 visible.condition 那样直接判 falsy。
                when: '(typeof uploadedVideoFilePaths !== "undefined" && Array.isArray(uploadedVideoFilePaths) && uploadedVideoFilePaths.length > 0) || (typeof videos !== "undefined" && Array.isArray(videos) && videos.length > 0) || (typeof uploadedVideos !== "undefined" && Array.isArray(uploadedVideos) && uploadedVideos.length > 0)',
                images: { max: 5 }
            }
        ]
    },
    params: [
        {
            id: 'kieGeminiOmniVideoDuration',
            type: 'dropdown',
            order: 1,
            default: '8',
            options: [
                { value: '4' },
                { value: '6' },
                { value: '8' },
                { value: '10' }
            ],
            visible: {
                condition: (params: JsonObject) => !hasUploadedVideo(params)
            }
        },
        {
            id: 'kieGeminiOmniVideoAspectRatio',
            type: 'dropdown',
            order: 2,
            default: 'smart',
            options: [
                { value: 'smart' },
                { value: '16:9' },
                { value: '9:16' }
            ]
        },
        {
            id: 'kieGeminiOmniVideoResolution',
            type: 'dropdown',
            order: 3,
            default: '720p',
            options: [
                { value: '720p' },
                { value: '1080p' },
                { value: '4k' }
            ]
        },
        {
            id: 'kieGeminiOmniVideoAudioIds',
            type: 'textarea',
            order: 4,
            default: ''
        },
        {
            id: 'kieGeminiOmniVideoCharacterIds',
            type: 'textarea',
            order: 5,
            default: ''
        }
    ],
    endpoints: KIE_CREATE_TASK_ENDPOINT,
    request: {
        // 小工具函数留在 builder 内部，保持这段模型契约自包含、便于独立测试与迁移。
        builder: (params) => {
            const filterSources = (value: JsonValue): string[] => Array.isArray(value)
                ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
                : [];
            const pickSources = (primary: JsonValue, fallback: JsonValue): string[] => {
                const preferred = filterSources(primary);
                return preferred.length > 0 ? preferred : filterSources(fallback);
            };
            const MAX_IMAGES_NO_VIDEO = 7;
            const MAX_IMAGES_WITH_VIDEO = 5;
            const ASPECT_RATIOS = ['16:9', '9:16'];
            const prompt = params.prompt || '';
            const images = pickSources(params.uploadedFilePaths, params.images);
            const videos = pickSources(params.uploadedVideoFilePaths, params.videos);
            const hasVideo = videos.length > 0;
            const splitIds = (value: JsonValue): string[] => typeof value === 'string'
                ? value.split(/[\n,]/u).map((item) => item.trim()).filter(Boolean)
                : [];
            const audioIds = splitIds(params.kieGeminiOmniVideoAudioIds).slice(0, 3);
            const characterIds = splitIds(params.kieGeminiOmniVideoCharacterIds);
            if (hasVideo && characterIds.length > 3)
                throw new Error('Gemini Omni 带视频时最多支持 3 个角色资产');
            const availableImageSlots = (hasVideo ? MAX_IMAGES_WITH_VIDEO : MAX_IMAGES_NO_VIDEO) - characterIds.length;
            if (availableImageSlots < 0 || images.length > availableImageSlots) {
                throw new Error('Gemini Omni 的图片与角色资产超过共享的 7 个槽位');
            }
            const resolution = params.kieGeminiOmniVideoResolution === '1080p' || params.kieGeminiOmniVideoResolution === '4k'
                ? params.kieGeminiOmniVideoResolution
                : '720p';
            const aspectRatioRaw = String(params.kieGeminiOmniVideoAspectRatio || 'smart');
            const aspectRatio = ASPECT_RATIOS.includes(aspectRatioRaw)
                ? aspectRatioRaw
                : (() => {
                    const imageRatio = typeof params.__firstImageRatio === 'number' && Number.isFinite(params.__firstImageRatio) && params.__firstImageRatio > 0
                        ? params.__firstImageRatio
                        : null;
                    // 无图时没有可参考的比例信号，直接选横屏（更符合大众预期），不强行套用"最接近 1:1"的判断
                    if (imageRatio === null) {
                        return '16:9';
                    }
                    let best = ASPECT_RATIOS[0];
                    let bestDiff = Number.POSITIVE_INFINITY;
                    for (const ratioText of ASPECT_RATIOS) {
                        const pair = ratioText.split(':').map(Number);
                        const ratio = pair[0] / Math.max(1, pair[1]);
                        const diff = Math.abs(ratio - imageRatio);
                        if (diff < bestDiff) {
                            bestDiff = diff;
                            best = ratioText;
                        }
                    }
                    return best;
                })();
            const input: JsonObject = {
                prompt: typeof prompt === 'string' ? prompt.slice(0, 20000) : '',
                aspect_ratio: aspectRatio,
                resolution
            };
            if (images.length > 0) {
                input.image_urls = images;
            }
            if (audioIds.length > 0)
                input.audio_ids = audioIds;
            if (characterIds.length > 0)
                input.character_ids = characterIds;
            if (hasVideo) {
                const rawClipDuration = typeof params.__firstVideoDurationSeconds === 'number' && params.__firstVideoDurationSeconds > 0
                    ? params.__firstVideoDurationSeconds
                    : 10;
                // API 只接受整秒：四舍五入到最近整数，确保裁剪/上传的片段完整覆盖（如 6.5s 取 7，6.1s 取 6）；
                // 上限夹到 10（与 inputLimits.rules 里 videoConstraints.trim.maxClipSeconds 一致）——
                // 用户没主动裁剪、源视频本身超过 10s 时防止发出超过 API"结束-起始不超过10秒"限制的 ends
                const clipDuration = Math.min(10, Math.max(1, Math.round(rawClipDuration)));
                input.video_list = [{ url: videos[0], start: 0, ends: clipDuration }];
            }
            else {
                input.duration = String(params.kieGeminiOmniVideoDuration || '8');
            }
            return {
                model: 'gemini-omni-video',
                input
            };
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => {
            const hasVideo = hasUploadedVideo(params);
            const resolution = String(params.kieGeminiOmniVideoResolution || '720p');
            const isHigh4k = resolution === '4k';
            if (hasVideo) {
                return isHigh4k ? 1.26 : 0.84;
            }
            const duration = String(params.kieGeminiOmniVideoDuration || '8');
            const basePriceByDuration: Record<string, number> = {
                '4': 0.315,
                '6': 0.42,
                '8': 0.525,
                '10': 0.63
            };
            const base = basePriceByDuration[duration] ?? basePriceByDuration['8'];
            return isHigh4k ? base + 0.42 : base;
        },
        description: '无视频输入：4/6/8/10s 在 720p/1080p 下 $0.315/$0.42/$0.525/$0.63，4K 为 $0.735/$0.84/$0.945/$1.05；有视频输入：720p/1080p 固定 $0.84，4K 固定 $1.26'
    }
});
export default kieGeminiOmniVideoModel;
