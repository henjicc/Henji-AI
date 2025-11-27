import { ParamDef } from '../types/schema'

/**
 * Wan 2.5 Preview 模型参数定义
 */
export const wan25PreviewParams: ParamDef[] = [
    {
        id: 'videoDuration',
        type: 'dropdown',
        label: '时长',
        defaultValue: 5,  // Wan 2.5 默认 5 秒
        options: [
            { value: 5, label: '5s' },
            { value: 10, label: '10s' }
        ]
    },
    {
        id: 'wanSize',
        type: 'dropdown',
        defaultValue: '1280*720',
        // 分辨率配置：固定尺寸，显示矩形比例示例
        resolutionConfig: {
            type: 'size',
            smartMatch: false,
            visualize: true,
            extractRatio: (value) => {
                const [w, h] = value.split('*').map(Number)
                return w / h
            }
        },
        options: [
            { value: '832*480', label: '832×480' },
            { value: '480*832', label: '480×832' },
            { value: '624*624', label: '624×624' },
            { value: '1280*720', label: '1280×720' },
            { value: '720*1280', label: '720×1280' },
            { value: '960*960', label: '960×960' },
            { value: '1088*832', label: '1088×832' },
            { value: '832*1088', label: '832×1088' },
            { value: '1920*1080', label: '1920×1080' },
            { value: '1080*1920', label: '1080×1920' },
            { value: '1440*1440', label: '1440×1440' },
            { value: '1632*1248', label: '1632×1248' },
            { value: '1248*1632', label: '1248×1632' }
        ],
        hidden: (values) => values.uploadedImages.length > 0
    },
    {
        id: 'wanResolution',
        type: 'dropdown',
        defaultValue: '720P',
        // 分辨率配置：使用面板显示
        resolutionConfig: {
            type: 'resolution',
            smartMatch: false,
            visualize: false
        },
        options: [
            { value: '480P', label: '480P' },
            { value: '720P', label: '720P' },
            { value: '1080P', label: '1080P' }
        ],
        hidden: (values) => values.uploadedImages.length === 0
    },
    {
        id: 'wanPromptExtend',
        type: 'toggle',
        label: '智能改写'
    },
    {
        id: 'wanAudio',
        type: 'toggle',
        label: '音频'
    }
]
