import React from 'react'
import CameraStageEditor from '@/features/cameraStage/CameraStageEditor'

/**
 * 工具箱 Tab 容器
 *
 * 当前承载「运镜控制」编辑器（2.1 起为正式开发代码）；
 * 工具箱多工具入口布局与正式命名文案由 3.2 任务落地。
 */
const ToolboxPlaceholder: React.FC = () => <CameraStageEditor />

export default ToolboxPlaceholder
