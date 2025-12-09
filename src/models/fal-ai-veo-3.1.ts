import { ParamDef } from '../types/schema'

/**
 * Fal.ai Veo 3.1 模型参数定义
 */
export const falAiVeo31Params: ParamDef[] = [
    {
        id: 'falVeo31Mode',
        type: 'dropdown',
        label: '模式',
        options: [
            { value: 'text-image-to-video', label: '文/图生视频' },
            { value: 'start-end-frame', label: '首尾帧' },
            { value: 'reference-to-video', label: '参考生视频' }
        ],
        className: 'min-w-[120px]'
    },
    {
        id: 'falVeo31VideoDuration',
        type: 'dropdown',
        label: '时长',
        defaultValue: 8,  // Veo 3.1 默认 8 秒
        options: [
            { value: 4, label: '4s' },
            { value: 6, label: '6s' },
            { value: 8, label: '8s' }
        ]
    },
    {
        id: 'falVeo31AspectRatio',
        type: 'dropdown',
        defaultValue: '16:9',
        // 分辨率配置：整合比例和分辨率到统一面板
        resolutionConfig: {
            type: 'aspect_ratio',
            smartMatch: true,
            visualize: true,
            extractRatio: (value) => {
                if (value === 'smart' || value === 'auto') return null
                const [w, h] = value.split(':').map(Number)
                return w / h
            },
            qualityOptions: [
                { value: '720p', label: '720P' },
                { value: '1080p', label: '1080P' }
            ],
            qualityKey: 'falVeo31Resolution'
        },
        // 当上传图片时自动切换到智能选项
        autoSwitch: {
            condition: (values) => values.uploadedImages && values.uploadedImages.length > 0,
            value: 'smart'
        },
        // 根据模式动态生成选项
        options: (values) => {
            const mode = values.falVeo31Mode || 'text-image-to-video'

            // reference-to-video 模式：不显示比例选项（会被 hidden 隐藏）
            if (mode === 'reference-to-video') {
                return []
            }

            // start-end-frame 模式：包含 auto 选项
            if (mode === 'start-end-frame') {
                return [
                    { value: 'auto', label: '自动' },
                    { value: '16:9', label: '16:9' },
                    { value: '9:16', label: '9:16' },
                    { value: '1:1', label: '1:1' }
                ]
            }

            // text-image-to-video 模式：包含智能选项和三个比例
            return [
                { value: 'smart', label: '智能' },
                { value: '16:9', label: '16:9' },
                { value: '9:16', label: '9:16' },
                { value: '1:1', label: '1:1' }
            ]
        },
        // reference-to-video 模式隐藏比例选项
        hidden: (values) => values.falVeo31Mode === 'reference-to-video',
        className: 'min-w-[100px]'
    },
    {
        id: 'falVeo31GenerateAudio',
        type: 'toggle',
        label: '生成音频'
    },
    {
        id: 'falVeo31AutoFix',
        type: 'toggle',
        label: 'Auto Fix',
        tooltip: '自动修复可能违反内容政策或其他验证检查的提示词',
        tooltipDelay: 500
    },
    {
        id: 'falVeo31FastMode',
        type: 'toggle',
        label: '快速模式'
    },
    {
        id: 'falVeo31EnhancePrompt',
        type: 'toggle',
        label: '增强提示词'
    }
]
