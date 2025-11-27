/**
 * 派欧云适配器配置
 */
export const PPIO_CONFIG = {
  baseURL: 'https://api.ppinfra.com/v3',
  statusEndpoint: '/async/task-result',
  pollInterval: 3000,
  maxPollAttempts: 120
} as const
