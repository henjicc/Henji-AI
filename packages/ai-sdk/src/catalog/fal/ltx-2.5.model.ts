import { defineModel } from "../defineModel";
import type { JsonObject } from "../../types/runtime";
import { hasUploadedImage, resolveUploadedAudioDurationSeconds, resolveUploadedAudioSources, resolveUploadedImageSources } from "../shared/mediaPresence";

// 字段与价格来源：docs/model-adaptation/LTX-2.5/LTX-2.5_Fal.md（Fal 模型页与 OpenAPI，2026-11-14 读取）
// Pro 最长 10 秒；快速档 12–20 秒的组合限制见 longDurationAllowed。
const TIERS = {
    pro: {
        resolutions: ['720p', '1080p'], fps: [24, 25, 50],
        rates: { '720p': 0.12, '1080p': 0.17 } as Record<string, number>, audioRate: 0.17, audioMaxSeconds: 10
    },
    fast: {
        resolutions: ['720p', '1080p', '1440p', '2160p'], fps: [24, 25, 48, 50],
        rates: { '720p': 0.09, '1080p': 0.13, '1440p': 0.19, '2160p': 0.3 } as Record<string, number>, audioRate: 0.13, audioMaxSeconds: 20
    }
} as const;
const ALL_RESOLUTIONS = TIERS.fast.resolutions;
const ALL_FPS = TIERS.fast.fps;
const ALL_DURATIONS = [6, 8, 10, 12, 14, 16, 18, 20] as const;
const CAMERA_MOTIONS = ['dolly_in', 'dolly_out', 'dolly_left', 'dolly_right', 'jib_up', 'jib_down', 'static', 'focus_shift'] as const;
// 音频生视频：输出跟随输入音频长度，音频至少 2 秒；读不到时长时按所选档位的上限估，宁高勿低。
const AUDIO_MIN_SECONDS = 2;

const isAudioMode = (params: JsonObject): boolean => params.falLtx25Mode === 'audio-to-video';
const tier = (params: JsonObject) => params.falLtx25FastMode === false ? TIERS.pro : TIERS.fast;

function choice<T extends string | number>(value: unknown, values: readonly T[], fallback: T): T {
    return values.includes(value as T) ? value as T : fallback;
}

/** 快速档超过 10 秒只支持 720p/1080p 且 24/25 帧；标准档最长 10 秒。 */
function longDurationAllowed(params: JsonObject): boolean {
    return params.falLtx25FastMode !== false
        && ['720p', '1080p'].includes(String(params.falLtx25Resolution ?? '1080p'))
        && [24, 25].includes(Number(params.falLtx25Fps ?? 25));
}

function duration(params: JsonObject): number {
    return choice(Number(params.falLtx25Duration), ALL_DURATIONS, 6);
}

function audioSeconds(params: JsonObject): number {
    const max = tier(params).audioMaxSeconds;
    const value = Number(resolveUploadedAudioDurationSeconds(params, max));
    return Number.isFinite(value) ? Math.min(max, Math.max(AUDIO_MIN_SECONDS, value)) : max;
}

export const falLtx25Model = defineModel({
    meta: {
        id: 'fal-ai-ltx-2.5', canonicalModelId: 'ltx-2.5', seriesId: 'ltx', seriesRank: 2.5,
        provider: 'fal', type: 'video',
        tags: ['text-to-video', 'image-to-video', 'start-end-frame', 'audio-to-video'],
        polling: { interval: 3000, maxAttempts: 300, expectedAttempts: 40 }
    },
    inputLimits: {
        images: { max: 2 }, videos: { max: 0 }, audios: { max: 0 },
        rules: [
            { when: 'falLtx25Mode === "audio-to-video"', images: { max: 1 }, videos: { max: 0 }, audios: { exact: 1 } }
        ]
    },
    params: [
        {
            id: 'falLtx25Mode', type: 'dropdown', order: 1,
            default: 'text-image-to-video',
            options: [{ value: 'text-image-to-video' }, { value: 'audio-to-video' }]
        },
        {
            id: 'falLtx25AspectRatio', type: 'dropdown', order: 2,
            default: 'smart',
            options: [{ value: 'smart' }, { value: '16:9' }, { value: '9:16' }]
        },
        {
            id: 'falLtx25Resolution', type: 'dropdown', order: 3,
            default: '1080p',
            visible: { condition: (params: JsonObject) => !isAudioMode(params) },
            options: ALL_RESOLUTIONS.map((value) => ({ value }))
        },
        {
            id: 'falLtx25Duration', type: 'dropdown', order: 4,
            default: 6,
            visible: { condition: (params: JsonObject) => !isAudioMode(params) },
            options: ALL_DURATIONS.map((value) => ({ value }))
        },
        {
            id: 'falLtx25Fps', type: 'dropdown', order: 5,
            default: 25,
            visible: { condition: (params: JsonObject) => !isAudioMode(params) },
            options: ALL_FPS.map((value) => ({ value }))
        },
        {
            id: 'falLtx25GenerateAudio', type: 'switch', order: 6,
            default: true,
            visible: { condition: (params: JsonObject) => !isAudioMode(params) }
        },
        {
            id: 'falLtx25FastMode', type: 'switch', order: 7,
            default: true
        },
        {
            id: 'falLtx25CameraMotion', type: 'dropdown', order: 8,
            default: 'none',
            visible: { condition: (params: JsonObject) => !isAudioMode(params) },
            options: [{ value: 'none' }, ...CAMERA_MOTIONS.map((value) => ({ value }))]
        }
    ],
    endpoints: {
        selector: async (params) => {
            const suffix = params.falLtx25FastMode === false ? 'pro' : 'fast';
            if (isAudioMode(params))
                return `lightricks/ltx-2.5/audio-to-video/${suffix}`;
            return `lightricks/ltx-2.5/${hasUploadedImage(params) ? 'image-to-video' : 'text-to-video'}/${suffix}`;
        }
    },
    request: {
        builder: (params) => {
            const prompt = typeof params.prompt === 'string' ? params.prompt.trim() : '';
            const ratio = String(params.falLtx25AspectRatio || 'smart');
            const images = resolveUploadedImageSources(params);
            if (isAudioMode(params)) {
                const audio = resolveUploadedAudioSources(params)[0];
                if (!audio)
                    throw new Error('LTX-2.5 音频生视频需要上传 1 段音频');
                if (!images[0] && !prompt)
                    throw new Error('LTX-2.5 音频生视频不传首帧图时需要填写提示词');
                const audioDuration = resolveUploadedAudioDurationSeconds(params);
                const audioLimit = tier(params).audioMaxSeconds;
                if (audioDuration > audioLimit)
                    throw new Error(`LTX-2.5 ${params.falLtx25FastMode === false ? '标准' : '快速'}模式的音频最长 ${audioLimit} 秒，当前约 ${Math.ceil(audioDuration)} 秒，请剪短音频${params.falLtx25FastMode === false ? '或打开快速模式' : ''}`);
                const body: JsonObject = {
                    audio_url: audio,
                    aspect_ratio: ratio === '9:16' || ratio === '16:9' ? ratio : 'auto'
                };
                if (images[0])
                    body.image_url = images[0];
                if (prompt)
                    body.prompt = prompt;
                return body;
            }
            if (!prompt)
                throw new Error('LTX-2.5 的提示词不能为空');
            const current = tier(params);
            const resolution = choice(params.falLtx25Resolution, current.resolutions, '1080p');
            const fps = choice(Number(params.falLtx25Fps), current.fps, 25);
            const seconds = duration(params);
            if (seconds > 10 && !longDurationAllowed({ ...params, falLtx25Resolution: resolution, falLtx25Fps: fps }))
                throw new Error('LTX-2.5 超过 10 秒只支持快速模式、720P/1080P 和 24/25 帧');
            const body: JsonObject = {
                prompt,
                duration: seconds,
                resolution,
                fps,
                generate_audio: params.falLtx25GenerateAudio !== false
            };
            const cameraMotion = String(params.falLtx25CameraMotion ?? 'none');
            if ((CAMERA_MOTIONS as readonly string[]).includes(cameraMotion))
                body.camera_motion = cameraMotion;
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
            const current = tier(params);
            if (isAudioMode(params))
                return current.audioRate * audioSeconds(params);
            return current.rates[choice(params.falLtx25Resolution, current.resolutions, '1080p')] * duration(params);
        },
        mediaContext: [
            { targetParam: '__audioDurationSeconds', mediaType: 'audio', metric: 'durationSeconds', when: isAudioMode }
        ],
        description: '快速：720p $0.09、1080p $0.13、1440p $0.19、2160p $0.30 每秒；Pro：720p $0.12、1080p $0.17 每秒；音频生视频按输入音频秒数计（快速 $0.13/秒、Pro $0.17/秒，Pro 音频最长 10 秒），读不到时长时按上限估；原生音频已含在价格内'
    }
});
export default falLtx25Model;
