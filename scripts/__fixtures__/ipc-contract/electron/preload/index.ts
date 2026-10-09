import { CHANNELS as c } from '../../channels'
const PORT_CALL_CHANNELS: Record<string, string> = { read: c.read }
const call = { method: 'read' }
const channel = call ? PORT_CALL_CHANNELS[call.method] : undefined
nativeInvoke(channel)
ipcRenderer.postMessage(c.port, {}, [])
ipcRenderer.on(c.changed, () => undefined)
