const { setupCameraStagePlaybackClock } = require('./uiInspectionCameraStagePlayback.cjs')

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
  ]
}

module.exports = { createCameraStagePlaybackScenes }
