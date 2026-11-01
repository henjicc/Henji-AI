import type { FontsPlatform } from '../../contracts/fonts'
function native(): FontsPlatform {
  if (!window.henjiNative?.fonts) throw new Error('字体库仅在桌面应用中可用。')
  return window.henjiNative.fonts
}
export function createElectronFonts(): FontsPlatform {
  return { list: fixed => native().list(fixed), importFiles: () => native().importFiles(), remove: id => native().remove(id), readFace: (id, source) => native().readFace(id, source), onChanged: handler => native().onChanged(handler) }
}
