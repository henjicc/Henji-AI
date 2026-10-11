/** 当前渲染运行时代次；页面切换与模型回合结束不会改变，重载后重新生成。 */
export const rendererEpoch = crypto.randomUUID()
