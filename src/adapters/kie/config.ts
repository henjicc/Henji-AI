export const KIE_CONFIG = {
  baseURL: 'https://api.kie.ai',
  uploadBaseURL: 'https://kieai.redpandaai.co',
  createTaskEndpoint: '/api/v1/jobs/createTask',
  statusEndpoint: '/api/v1/jobs/recordInfo',
  fileUploadEndpoint: '/api/file-stream-upload',
  pollInterval: 3000,              // 轮询间隔（毫秒）
  maxPollAttempts: 200,            // 最大轮询次数（10分钟）

  // 模型预估轮询次数配置
  modelEstimatedPolls: {
    'nano-banana-pro': 30,         // 预估30次轮询（约1.5分钟）
  }
} as const
