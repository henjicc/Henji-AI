/**
 * NodeConnection - 节点连接接口
 *
 * 定义节点间的连接关系
 */

/**
 * 节点连接接口
 */
export interface NodeConnection {
  /** 连接 ID */
  id: string

  /** 源节点 */
  source: {
    /** 源节点 ID */
    nodeId: string

    /** 源端口 ID */
    portId: string
  }

  /** 目标节点 */
  target: {
    /** 目标节点 ID */
    nodeId: string

    /** 目标端口 ID */
    portId: string
  }

  /** 数据转换（可选） */
  transform?: (value: DynamicValue) => DynamicValue
}
