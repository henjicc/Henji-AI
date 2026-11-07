import { defineModel } from "../defineModel";
import type { JsonObject } from "../../types/runtime";
import { hasUploadedImage, resolveUploadedAudioDurationSeconds, resolveUploadedAudioSources, resolveUploadedImageSources, resolveUploadedVideoSources } from "../shared/mediaPresence";

// 价格与字段来源：docs/model-adaptation/LTX-2.3/LTX-2.3_Fal.md（Fal 模型页与 OpenAPI，2026-11-07 读取）
const RATES: Record<string, Record<string, number>> = {
    fast: { '1080p': 0.06, '1440p': 0.12, '2160p': 0.24 },
    pro: { '1080p': 0.08, '1440p': 0.16, '2160p': 0.32 }
};
// 快速档 12–20 秒只支持 1080p + 25fps，其余组合最长 10 秒。
const LONG_DURATIONS = [12, 14, 16, 18, 20];
// 音频生视频：输出视频跟随输入音频长度，音频须为 2–20 秒；读不到时长时按最长 20 秒估，宁高勿低。
const AUDIO_MIN_SECONDS = 2;
const AUDIO_MAX_SECONDS = 20;

function mode(params: JsonObject): string {
    return ['video-extension', 'retake-video', 'audio-to-video'].includes(String(params.falLtx23Mode)) ? String(params.falLtx23Mode) : 'text-image-to-video';
}

const showsAspectRatio = (params: JsonObject): boolean => ['text-image-to-video', 'audio-to-video'].includes(mode(params));

function choice<T extends string | number>(value: unknown, values: readonly T[], fallback: T): T {
    return values.includes(value as T) ? value as T : fallback;
}

function clampSeconds(value: unknown, min: number, max: number, fallback: number): number {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

export const falLtx23Model = defineModel({
    meta: {
        id: 'fal-ai-ltx-2.3', canonicalModelId: 'ltx-2.3', seriesId: 'ltx', seriesRank: 2.3,
        provider: 'fal', type: 'video',
        tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'video-to-video', 'video-extension', 'audio-to-video'],
        polling: { interval: 3000, maxAttempts: 300, expectedAttempts: 40 }
    },
    inputLimits: {
        images: { max: 2 }, videos: { max: 0 }, audios: { max: 0 },
        rules: [
            { when: 'falLtx23Mode === "video-extension"', images: { max: 0 }, videos: { exact: 1 } },
            { when: 'falLtx23Mode === "retake-video"', images: { max: 0 }, videos: { exact: 1 } },
            { when: 'falLtx23Mode === "audio-to-video"', images: { max: 1 }, videos: { max: 0 }, audios: { exact: 1 } }
        ]
    },
    requirements: [
        {
            id: 'fal-ltx-2.3-source-video',
            when: 'falLtx23Mode === "video-extension" || falLtx23Mode === "retake-video"',
            require: { videos: { exact: 1 } },
            message: { title: '视频必需', message: '延长视频和视频重拍需要上传 1 个视频', type: 'warning' }
        }
    ],
    params: [
        {
            id: 'falLtx23Mode', type: 'dropdown', order: 1,
            default: 'text-image-to-video',
            options: [{ value: 'text-image-to-video' }, { value: 'video-extension' }, { value: 'retake-video' }, { value: 'audio-to-video' }]
        },
        {
            id: 'falLtx23AspectRatio', type: 'dropdown', order: 2,
            default: 'smart',
            visible: { condition: showsAspectRatio },
            options: [{ value: 'smart' }, { value: '16:9' }, { value: '9:16' }]
        },
        {
            id: 'falLtx23Resolution', type: 'dropdown', order: 3,
            default: '1080p',
            visible: { condition: (params: JsonObject) => mode(params) === 'text-image-to-video' },
            options: [{ value: '1080p' }, { value: '1440p' }, { value: '2160p' }]
        },
        {
            id: 'falLtx23Duration', type: 'dropdown', order: 4,
            default: 6,
            visible: { condition: (params: JsonObject) => mode(params) === 'text-image-to-video' },
            options: [6, 8, 10, ...LONG_DURATIONS].map((value) => ({ value }))
        },
        {
            id: 'falLtx23ExtendDuration', type: 'number', order: 5,
            default: 5, min: 2, max: 20, step: 1,
            visible: { condition: (params: JsonObject) => mode(params) === 'video-extension' }
        },
        {
            id: 'falLtx23ExtendDirection', type: 'dropdown', order: 6,
            default: 'end',
            visible: { condition: (params: JsonObject) => mode(params) === 'video-extension' },
            options: [{ value: 'end' }, { value: 'start' }]
        },
        {
            id: 'falLtx23RetakeStartTime', type: 'number', order: 7,
            default: 0, min: 0, max: 20, step: 0.5,
            visible: { condition: (params: JsonObject) => mode(params) === 'retake-video' }
        },
        {
            id: 'falLtx23RetakeDuration', type: 'number', order: 8,
            default: 5, min: 2, max: 20, step: 0.5,
            visible: { condition: (params: JsonObject) => mode(params) === 'retake-video' }
        },
        {
            id: 'falLtx23RetakeMode', type: 'dropdown', order: 9,
            default: 'replace_audio_and_video',
            visible: { condition: (params: JsonObject) => mode(params) === 'retake-video' },
            options: [{ value: 'replace_audio_and_video' }, { value: 'replace_video' }, { value: 'replace_audio' }]
        },
        {
            id: 'falLtx23Fps', type: 'dropdown', order: 10,
            default: 25,
            visible: { condition: (params: JsonObject) => mode(params) === 'text-image-to-video' },
            options: [24, 25, 48, 50].map((value) => ({ value }))
        },
        {
            id: 'falLtx23GenerateAudio', type: 'switch', order: 11,
            default: true,
            visible: { condition: (params: JsonObject) => mode(params) === 'text-image-to-video' }
        },
        {
            id: 'falLtx23FastMode', type: 'switch', order: 12,
            default: true,
            visible: { condition: (params: JsonObject) => mode(params) === 'text-image-to-video' }
        }
    ],
    endpoints: {
        selector: async (params) => {
            const current = mode(params);
            if (current === 'video-extension')
                return 'fal-ai/ltx-2.3/extend-video';
            if (current === 'retake-video')
                return 'fal-ai/ltx-2.3/retake-video';
            if (current === 'audio-to-video')
                return 'fal-ai/ltx-2.3/audio-to-video';
            const route = hasUploadedImage(params) ? 'image-to-video' : 'text-to-video';
            return params.falLtx23FastMode === false ? `fal-ai/ltx-2.3/${route}` : `fal-ai/ltx-2.3/${route}/fast`;
        }
    },
    request: {
        builder: (params) => {
            const prompt = typeof params.prompt === 'string' ? params.prompt.trim() : '';
            const current = mode(params);
            if (current === 'audio-to-video') {
                const audio = resolveUploadedAudioSources(params)[0];
                if (!audio)
                    throw new Error('LTX-2.3 音频生视频需要上传 1 段音频');
                const image = resolveUploadedImageSources(params)[0];
                if (!image && !prompt)
                    throw new Error('LTX-2.3 音频生视频不传首帧图时需要填写提示词');
                const ratio = String(params.falLtx23AspectRatio || 'smart');
                const body: JsonObject = {
                    audio_url: audio,
                    aspect_ratio: ratio === '9:16' || ratio === '16:9' ? ratio : 'auto'
                };
                if (image)
                    body.image_url = image;
                if (prompt)
                    body.prompt = prompt;
                return body;
            }
            if (current !== 'text-image-to-video') {
                const video = resolveUploadedVideoSources(params)[0];
                if (!video)
                    throw new Error('LTX-2.3 延长视频和视频重拍需要上传 1 个视频');
                if (current === 'video-extension') {
                    const body: JsonObject = {
                        video_url: video,
                        duration: clampSeconds(params.falLtx23ExtendDuration, 2, 20, 5),
                        mode: choice(params.falLtx23ExtendDirection, ['end', 'start'], 'end')
                    };
                    if (prompt)
                        body.prompt = prompt;
                    return body;
                }
                if (!prompt)
                    throw new Error('LTX-2.3 视频重拍需要填写提示词');
                return {
                    prompt,
                    video_url: video,
                    start_time: clampSeconds(params.falLtx23RetakeStartTime, 0, 20, 0),
                    duration: clampSeconds(params.falLtx23RetakeDuration, 2, 20, 5),
                    retake_mode: choice(params.falLtx23RetakeMode, ['replace_audio', 'replace_video', 'replace_audio_and_video'], 'replace_audio_and_video')
                };
            }
            if (!prompt)
                throw new Error('LTX-2.3 的提示词不能为空');
            const fast = params.falLtx23FastMode !== false;
            const resolution = choice(params.falLtx23Resolution, ['1080p', '1440p', '2160p'], '1080p');
            const fps = choice(Number(params.falLtx23Fps), [24, 25, 48, 50], 25);
            const duration = choice(Number(params.falLtx23Duration), [6, 8, 10, ...LONG_DURATIONS], 6);
            if (duration > 10 && !(fast && resolution === '1080p' && fps === 25))
                throw new Error('LTX-2.3 超过 10 秒只支持快速模式、1080p 和 25 FPS');
            const images = resolveUploadedImageSources(params);
            const ratio = String(params.falLtx23AspectRatio || 'smart');
            const body: JsonObject = {
                prompt,
                duration,
                resolution,
                fps,
                generate_audio: params.falLtx23GenerateAudio !== false
            };
            if (images.length > 0) {
                body.image_url = images[0];
                if (images.length > 1)
                    body.end_image_url = images[1];
                body.aspect_ratio = ratio === '9:16' || ratio === '16:9' ? ratio : 'auto';
            }
            else {
                body.aspect_ratio = ratio === '9:16' ? '9:16' : '16:9';
            }
            return body;
        }
    },
    pricing: {
        currency: '$',
        calculator: (params) => {
            const current = mode(params);
            if (current === 'video-extension')
                return 0.1 * clampSeconds(params.falLtx23ExtendDuration, 2, 20, 5);
            if (current === 'retake-video')
                return 0.1 * clampSeconds(params.falLtx23RetakeDuration, 2, 20, 5);
            if (current === 'audio-to-video')
                return 0.1 * clampSeconds(resolveUploadedAudioDurationSeconds(params, AUDIO_MAX_SECONDS), AUDIO_MIN_SECONDS, AUDIO_MAX_SECONDS, AUDIO_MAX_SECONDS);
            const rates = params.falLtx23FastMode === false ? RATES.pro : RATES.fast;
            const resolution = choice(params.falLtx23Resolution, ['1080p', '1440p', '2160p'], '1080p');
            return rates[resolution] * choice(Number(params.falLtx23Duration), [6, 8, 10, ...LONG_DURATIONS], 6);
        },
        mediaContext: [
            { targetParam: '__audioDurationSeconds', mediaType: 'audio', metric: 'durationSeconds', when: (params) => mode(params) === 'audio-to-video' }
        ],
        description: '快速：1080p $0.06/秒、1440p $0.12/秒、2160p $0.24/秒；标准：$0.08/$0.16/$0.32 每秒；延长视频与视频重拍 $0.10/秒；音频生视频 $0.10/秒，按音频时长计算（视频与音频等长），读不到时长时按最长 20 秒估'
    }
});
export default falLtx23Model;
