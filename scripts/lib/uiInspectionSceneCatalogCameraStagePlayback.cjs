const { setupCameraStagePlaybackClock } = require('./uiInspectionCameraStagePlayback.cjs')
const { setupCameraStageBackgroundRender } = require('./uiInspectionCameraStageBackgroundRender.cjs')

function createCameraStagePlaybackScenes(context) {
  return [
    {
      id: 'toolbox-camera-stage-playback-clock',
      surface: '工具箱',
      name: '工具箱-3D 镜头逐帧播放',
      writesUserData: true,
      setup: (page, _electronApp, inspection) => (
        setupCameraStagePlaybackClock(page, context, inspection)
      ),
    },
    {
      id: 'canvas-camera-stage-background-render-lifecycle',
      surface: '画布',
      name: '画布-3D 后台渲染跨工程生命周期',
      writesUserData: true,
      setup: (page, _electronApp, inspection) => (
        setupCameraStageBackgroundRender(page, context, inspection)
      ),
    },
  ]
}

module.exports = { createCameraStagePlaybackScenes }
