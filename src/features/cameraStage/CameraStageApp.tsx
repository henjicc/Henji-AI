import React, { useState } from 'react'
import CameraStageEditor from './CameraStageEditor'
import CameraStageProjectList from './projects/CameraStageProjectList'

/**
 * 运镜控制入口：管理"工程列表 ↔ 场景编辑器"两级视图。
 * 列表页负责新建/打开/重命名/删除并把场景加载进 store，编辑器负责场景搭建与截图。
 */

const CameraStageApp: React.FC = () => {
  const [view, setView] = useState<'list' | 'editor'>('list')

  if (view === 'editor') {
    return <CameraStageEditor onBackToList={() => setView('list')} />
  }
  return <CameraStageProjectList onEnterEditor={() => setView('editor')} />
}

export default CameraStageApp
