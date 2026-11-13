import type { DocumentTextPlatform } from '../../contracts/documentText'
function native(): DocumentTextPlatform {
  const api = window.henjiNative?.documentText as DocumentTextPlatform | undefined
  if (!api) throw new Error('文字识别不可用，请重新启动应用。')
  return api
}
export function createElectronDocumentText(): DocumentTextPlatform {
  return { recognize: request => native().recognize(request), cancel: id => native().cancel(id) }
}
