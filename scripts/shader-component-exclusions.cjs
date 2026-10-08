/**
 * 不进入剪辑的 `shaders` 组件与原因。剪辑要求同一帧任意次渲染结果相同、预览与导出一致，
 * 并且不读网页、不读鼠标。原因取值：
 * - pointer：跟随鼠标交互，剪辑里没有指针
 * - dom：截取网页元素或摄像头，或要在页面里建 2D 画布、加载网络字体（剪辑合成在 Worker 里，没有页面）
 * - media：自带网址/上传素材入口；剪辑画面由宿主输入，图片走素材库
 * - history：依赖上一帧状态（粒子、流体、轨迹），任意寻帧不可重现（GPU 确定性测试判定）
 */
module.exports = {
  HTMLInCanvas: 'dom',
  WebcamTexture: 'dom',
  ImageTexture: 'media',
  VideoTexture: 'media',
  Text: 'dom',
  Ascii: 'dom',
  ObjectTracker: 'dom',
  // HENJI_SHADER_SWEEP=1 的 GPU 扫描判定（shaders 4.0.2）
  DataMosh: 'history',
  Irradiance: 'history',
  KeyFrames: 'history',
  TimeTrail: 'history',
}
