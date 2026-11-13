import type { AudioEditTask } from '../../../audioEdit/types'

/**
 * 最近一次转写再发起会怎样（主进程按任务回执判断，界面与助手读同一份）：
 * completed 已转写完成，再发起不会再识别；running 本窗口正在转写；
 * allowed 没有计费、可以重新转写；resume 已交给识别服务或已拿到结果，再发起只续查或取回；
 * blocked 无法确认是否已计费或素材已变化，拒绝再提交；running_elsewhere 另一个进程（助手命令行）正在转写。
 */
export const AUDIO_EDIT_TRANSCRIPTION_RESUBMISSIONS = ['completed', 'running', 'allowed', 'resume', 'blocked', 'running_elsewhere'] as const
export type AudioEditTranscriptionResubmission = typeof AUDIO_EDIT_TRANSCRIPTION_RESUBMISSIONS[number]

export interface AudioEditTaskStatus extends AudioEditTask {
  /** 这份口播最近一次转写上总会给出（口播文件读不出来时除外）。 */
  resubmission?: AudioEditTranscriptionResubmission
}
