// 走应用正式导出接口（与“导出”按钮同一条 platform.audioEdit.exportProject），绕开系统保存对话框
module.exports = async (page) => page.evaluate(async ({ projectId, targetPath }) => {
  const svc = await import('/src/features/audioEdit/application/audioEditApplicationService.ts')
  const fn = svc.exportAudioEdit
  const t0 = performance.now()
  const r = await fn({ projectId, targetPath, format: 'wav' })
  return { ms: Math.round(performance.now() - t0), result: r }
}, { projectId: '3b73caef-0792-4d4f-b4e2-3aa9e575bacf', targetPath: process.env.TARGET })
