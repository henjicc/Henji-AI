import React from 'react'
import CameraStageVerify from '@/features/cameraStage/CameraStageVerify'

/**
 * 工具箱占位组件
 *
 * 运镜控制 1.1 技术验证期间临时挂载三维验证场景，
 * 验证完成后视情况还原占位文案或保留为正式入口（3.2 决定）。
 */
const ToolboxPlaceholder: React.FC = () => <CameraStageVerify />

export default ToolboxPlaceholder
