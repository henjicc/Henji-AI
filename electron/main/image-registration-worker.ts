import { parentPort } from 'node:worker_threads'

import { isRegistrationWorkerRequest } from './services/image/registration/worker-contracts'
import { executeRegistrationWorkerTask } from './services/image/registration/worker-task'

const registrationParentPort = parentPort
if (!registrationParentPort) throw new Error('图像配准 Worker 缺少父线程通信端口')

registrationParentPort.once('message', (raw: unknown) => {
  if (!isRegistrationWorkerRequest(raw)) {
    throw new Error('图像配准 Worker 收到无效请求')
  }
  const response = executeRegistrationWorkerTask(raw)
  const transfer = response.movingData.buffer instanceof ArrayBuffer
    ? [response.movingData.buffer]
    : []
  registrationParentPort.postMessage(response, transfer)
})
