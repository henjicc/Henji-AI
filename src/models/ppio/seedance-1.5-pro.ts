import { ParamDef } from '../../types/schema'

interface ParamValues {
    ppioSeedance15ProAspectRatio?: string
    uploadedImages?: string[]
}

/**
 * PPIO Seedance 1.5 Pro 参数定义
 * 支持文生视频、图生视频、首尾帧三种模式
 */
export const ppioSeedance15ProParams: ParamDef[] = [
    // 宽高比（特殊面板，包含分辨率选择和智能匹配）
    {
        id: 'ppioSeedance15ProAspectRatio',
        type: 'dropdown',
        label: '分辨率',
        defaultValue: '1:1',
        resolutionConfig: {
            type: 'aspect_ratio',
            smartMatch: true,
            visualize: true,
            extractRatio: (value: string) => {
                if (value === 'smart') return null
                const [w, h] = value.split(':').map(Number)
                return w / h
            },
            // 指定分辨率参数的key
            qualityKey: 'ppioSeedance15ProResolution',
            // 分辨率选项（作为质量选项显示）
            qualityOptions: [
                { value: '480p', label: '480P' },
                { value: '720p', label: '720P' }
            ]
        },
        // 自动切换逻辑：上传图片后切换到智能
        autoSwitch: [
            {
                // 上传图片后自动切换到智能选项
                condition: (values: ParamValues) => {
                    const imageCount = values.uploadedImages?.length || 0
                    const currentRatio = values.ppioSeedance15ProAspectRatio
                    return imageCount > 0 && currentRatio !== 'smart'
                },
                value: 'smart',
                watchKeys: ['uploadedImages']
            },
            {
                // 删除所有图片后，将智能重置为默认比例
                condition: (values: ParamValues) => {
                    const imageCount = values.uploadedImages?.length || 0
                    const currentRatio = values.ppioSeedance15ProAspectRatio
                    return imageCount === 0 && currentRatio === 'smart'
                },
                value: '1:1',
                watchKeys: ['uploadedImages']
            }
        ],
        // 根据图片数量动态生成选项
        options: (values: ParamValues) => {
            const imageCount = values.uploadedImages?.length || 0

            // 有图片：显示智能选项
            if (imageCount > 0) {
                return [
                    { value: 'smart', label: '智能' },
                    { value: '16:9', label: '16:9' },
                    { value: '4:3', label: '4:3' },
                    { value: '1:1', label: '1:1' },
                    { value: '3:4', label: '3:4' },
                    { value: '9:16', label: '9:16' },
                    { value: '21:9', label: '21:9' }
                ]
            }

            // 无图片：不显示智能选项
            return [
                { value: '16:9', label: '16:9' },
                { value: '4:3', label: '4:3' },
                { value: '1:1', label: '1:1' },
                { value: '3:4', label: '3:4' },
                { value: '9:16', label: '9:16' },
                { value: '21:9', label: '21:9' }
            ]
        }
    },

    // 时长选择（4-12秒）
    {
        id: 'ppioSeedance15ProDuration',
        type: 'dropdown',
        label: '时长',
        defaultValue: 5,
        options: [
            { value: 4, label: '4s' },
            { value: 5, label: '5s' },
            { value: 6, label: '6s' },
            { value: 7, label: '7s' },
            { value: 8, label: '8s' },
            { value: 9, label: '9s' },
            { value: 10, label: '10s' },
            { value: 11, label: '11s' },
            { value: 12, label: '12s' }
        ]
    },

    // 生成音频开关
    {
        id: 'ppioSeedance15ProGenerateAudio',
        type: 'toggle',
        label: '生成音频',
        defaultValue: false
    },

    // 固定相机开关
    {
        id: 'ppioSeedance15ProCameraFixed',
        type: 'toggle',
        label: '固定相机',
        defaultValue: false
    },

    // 服务层级选择
    {
        id: 'ppioSeedance15ProServiceTier',
        type: 'dropdown',
        label: '服务层级',
        tooltip: '在线推理模式，RPM 和并发配额较低，适用于时效性要求高的场景。离线推理模式，TPD 配额更高，价格为在线模式的 50%，适用于对延迟不敏感的场景。',
        defaultValue: 'default',
        options: [
            { value: 'default', label: '在线模式' },
            { value: 'flex', label: '离线模式' }
        ]
    }
]

