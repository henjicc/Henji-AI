import type { ReleaseInfo } from '@/services/updateChecker'
import type { DevelopmentUpdatePreviewState } from './developmentLaunchContract'

/**
 * 更新提示弹窗的开发预览数据（`--dev-update-preview`，任务 5.7）：
 * 长说明（标题、多条列表、段落）覆盖滚动与排版；下载中带进度；失败带原因。
 * 只用于开发启动与界面核对，正式检查更新流程不读取它。
 */
export function createUpdatePreviewRelease(state: DevelopmentUpdatePreviewState, currentVersion: string): ReleaseInfo {
  const notes = [
    '## 新功能',
    '- 画布支持多图层图片文档，可以在节点里直接调整图层顺序与混合方式',
    '- 生成工作区的参数条随窗口变宽，常用参数不再收进“更多”',
    '- 新增四套界面主题预设：石墨、深海、胶片、纸白',
    '## 改进',
    '- 视频查看器的控制条跟随主题，倍速与音量改为常驻控件',
    '- 日志窗口合并为一条命令带，过滤条件放在其下的从属带',
    '这是一段较长的说明文字，用来检查正文在弹窗里的换行、行距与滚动是否正常；更新内容较多时，弹窗正文应当可以滚动，底部按钮始终可见。',
    '## 修复',
    '- 修复切换对话期间立即发送消息会被拒绝的问题',
    '- 修复危险确认按钮在悬停时文字对比度不足的问题',
  ].join('\n')
  return {
    version: '9.9.0',
    name: `痕迹AI 9.9.0（当前 ${currentVersion}）`,
    body: notes,
    publishedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    htmlUrl: 'https://github.com/henjicc/Henji-AI/releases',
    source: 'electron-updater',
    updateStatus: state === 'downloading' ? 'downloading' : state === 'failed' ? 'error' : 'available',
    progressPercent: state === 'downloading' ? 42 : undefined,
    errorMessage: state === 'failed' ? '网络连接中断，下载未完成' : undefined,
  }
}
