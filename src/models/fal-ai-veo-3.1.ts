import { ParamDef } from '../types/schema'

/**
 * Fal.ai Veo 3.1 模型参数定义
 */
export const falAiVeo31Params: ParamDef[] = [
    {
        id: 'veoMode',
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
        id: 'videoDuration',
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
        id: 'veoAspectRatio',
        type: 'dropdown',
        label: '宽高比',
        options: (values) => {
            const baseOptions = [
                { value: '16:9', label: '16:9' },
                { value: '9:16', label: '9:16' },
                { value: '1:1', label: '1:1' }
            ];

            // 只有当有图片上传时才显示自动选项
            if (values.uploadedImages && values.uploadedImages.length > 0) {
                return [...baseOptions, { value: 'auto', label: '自动' }];
            }

            return baseOptions;
        },
        className: 'min-w-[100px]'
    },
    {
        id: 'veoResolution',
        type: 'dropdown',
        label: '分辨率',
        options: [
            { value: '720p', label: '720p' },
            { value: '1080p', label: '1080p' }
        ]
    },
    {
        id: 'veoGenerateAudio',
        type: 'toggle',
        label: '生成音频'
    },
    {
        id: 'veoAutoFix',
        type: 'toggle',
        label: 'Auto Fix',
        tooltip: '自动修复可能违反内容政策或其他验证检查的提示词',
        tooltipDelay: 500
    },
    {
        id: 'veoFastMode',
        type: 'toggle',
        label: '快速模式'
    },
    {
        id: 'veoEnhancePrompt',
        type: 'toggle',
        label: '增强提示词'
    }
]
