# Claude Fable 5

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /claude/v1/messages:
    post:
      summary: Claude Fable 5
      deprecated: false
      description: >-
        ### Streaming Support


        当请求中设置 `stream: true` 时，接口会以 SSE 的形式返回结果。


        **Streaming Response Format:**

        - Content-Type: `text/event-stream`

        - 常见事件包括
        `message_start`、`content_block_start`、`content_block_delta`、`message_delta`
        和 `message_stop`


        ## Features


        - 使用 `messages` 进行标准对话。

        - 支持 Claude 原生事件流返回。

        - 支持项目中的 thinking 开关。

        - **注意**: 该模型不支持函数调用以及claude code

        ## Request Notes


        - 在 `model` 字段中传入当前模型名称。

        - 使用 `messages` 传递对话上下文。

        - 设置 `stream: true` 可获得 SSE 流式返回。


        ## Authentication


        该接口使用鉴权配置中的 `X-Api-Key` 和 `anthropic-version`，不作为普通请求参数填写。
      operationId: claude_fable_5_zh
      tags:
        - docs/zh-CN/Market/Chat  Models/Claude
      parameters: []
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                model:
                  type: string
                  description: 模型名称，必须与当前文档对应的模型一致。
                  enum:
                    - claude-fable-5
                  x-apidog-enum:
                    - value: claude-fable-5
                      name: ''
                      description: ''
                  examples:
                    - claude-fable-5
                messages:
                  type: array
                  description: 按时间顺序传递的对话消息数组。
                  items:
                    type: object
                    properties:
                      role:
                        type: string
                        enum:
                          - user
                          - assistant
                        description: 消息角色。
                        examples:
                          - user
                      content:
                        oneOf:
                          - type: string
                            description: 纯文本内容。
                          - type: array
                            description: 结构化内容块数组。
                            items:
                              type: object
                              additionalProperties: true
                              x-apidog-orders: []
                        description: 消息内容。
                        examples:
                          - What is the weather like in Boston today?
                    required:
                      - role
                      - content
                    x-apidog-orders:
                      - role
                      - content
                  minItems: 1
                thinkingFlag:
                  type: boolean
                  description: 当前 Claude 适配层使用的项目内 thinking 开关。
                  examples:
                    - true
                stream:
                  type: boolean
                  default: true
                  description: 如果设为 true，接口会返回 SSE 流。
                  examples:
                    - false
                max_tokens:
                  type: number
                  default: 4096
                  examples:
                    - 4096
                  description: 可选的Claude输出令牌限制。留空以使用默认值4096。
              required:
                - model
                - messages
              x-apidog-orders:
                - model
                - messages
                - thinkingFlag
                - stream
                - max_tokens
              examples:
                - model: claude-opus-4-6-v1messages
                  messages:
                    - role: user
                      content: What is the weather like in Boston today?
                  tools:
                    - name: get_current_weather
                      description: Get the current weather in a given location
                      input_schema:
                        type: object
                        properties:
                          location:
                            type: string
                            description: The city and state, e.g. Boston, MA
                        required:
                          - location
                  thinkingFlag: true
                  stream: false
            example:
              model: claude-fable-5
              messages:
                - role: user
                  content: What is the weather like in Boston today?
              thinkingFlag: true
              stream: false
              max_tokens: 4096
      responses:
        '200':
          description: 请求成功。
          content:
            application/json:
              schema:
                type: object
                properties:
                  role:
                    type: string
                    description: 返回消息角色
                    examples:
                      - assistant
                  usage:
                    type: object
                    description: 提供方返回的用量信息
                    properties:
                      input_tokens:
                        type: integer
                        description: 输入 token 数量
                        examples:
                          - 600
                      output_tokens:
                        type: integer
                        description: 输出 token 数量
                        examples:
                          - 57
                      cache_creation_input_tokens:
                        type: integer
                        description: 缓存创建输入 token 数量
                        examples:
                          - 0
                      cache_read_input_tokens:
                        type: integer
                        description: 缓存读取输入 token 数量
                        examples:
                          - 0
                      service_tier:
                        type: string
                        description: 服务等级
                        examples:
                          - standard
                    x-apidog-orders:
                      - input_tokens
                      - output_tokens
                      - cache_creation_input_tokens
                      - cache_read_input_tokens
                      - service_tier
                  stop_reason:
                    type: string
                    description: 生成停止原因
                    examples:
                      - tool_use
                  model:
                    type: string
                    description: 提供方实际返回的模型版本
                  id:
                    type: string
                    description: 消息唯一标识
                    examples:
                      - msg_01VSoxV4a8YWB3DBh9TdM63W
                  credits_consumed:
                    type: number
                    description: 本次请求消耗的 credits
                    examples:
                      - 0.25
                  type:
                    type: string
                    description: 顶层响应对象类型
                    examples:
                      - message
                  content:
                    type: array
                    description: 响应内容块
                    items:
                      type: object
                      properties:
                        input:
                          type: object
                          description: 工具输入参数
                          additionalProperties: true
                          x-apidog-orders: []
                          properties: {}
                        caller:
                          type: object
                          description: 工具调用来源信息
                          properties:
                            type:
                              type: string
                              examples:
                                - direct
                          x-apidog-orders:
                            - type
                        name:
                          type: string
                          description: 工具名称
                          examples:
                            - get_current_weather
                        id:
                          type: string
                          description: 工具调用标识
                          examples:
                            - toolu_018gdqs2FHxrRjQHLZv1qvbF
                        type:
                          type: string
                          description: 内容块类型
                          examples:
                            - tool_use
                      x-apidog-orders:
                        - input
                        - caller
                        - name
                        - id
                        - type
                x-apidog-orders:
                  - role
                  - usage
                  - stop_reason
                  - model
                  - id
                  - credits_consumed
                  - type
                  - content
              example:
                role: assistant
                usage:
                  cache_creation:
                    ephemeral_1h_input_tokens: 0
                    ephemeral_5m_input_tokens: 0
                  output_tokens: 57
                  service_tier: standard
                  cache_creation_input_tokens: 0
                  input_tokens: 600
                  cache_read_input_tokens: 0
                  inference_geo: not_available
                stop_reason: tool_use
                model: claude-fable-5
                id: msg_01VSoxV4a8YWB3DBh9TdM63W
                credits_consumed: 0.25
                type: message
                content:
                  - input:
                      location: Beijing, China
                    caller:
                      type: direct
                    name: get_current_weather
                    id: toolu_018gdqs2FHxrRjQHLZv1qvbF
                    type: tool_use
          headers: {}
          x-apidog-name: ''
        '400':
          description: 错误请求 - 请求参数无效
          content:
            application/json:
              schema:
                type: object
                properties:
                  error:
                    type: object
                    properties:
                      message:
                        type: string
                        examples:
                          - Invalid request parameters
                      type:
                        type: string
                        examples:
                          - invalid_request_error
                    x-apidog-orders:
                      - message
                      - type
                x-apidog-orders:
                  - error
          headers: {}
          x-apidog-name: ''
        '401':
          description: 未授权 - API Key 无效或缺失
          content:
            application/json:
              schema:
                type: object
                properties:
                  error:
                    type: object
                    properties:
                      message:
                        type: string
                        examples:
                          - Invalid or missing API key
                      type:
                        type: string
                        examples:
                          - authentication_error
                    x-apidog-orders:
                      - message
                      - type
                x-apidog-orders:
                  - error
          headers: {}
          x-apidog-name: ''
      security: []
      x-apidog-folder: docs/zh-CN/Market/Chat  Models/Claude
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-37595105-run
components:
  schemas: {}
  securitySchemes:
    BearerAuth:
      type: bearer
      scheme: bearer
      bearerFormat: API Key
      description: >-
        All API requests require a Bearer Token. Add the header `Authorization:
        Bearer YOUR_API_KEY` to authenticate requests.
    BearerAuth1:
      type: bearer
      scheme: bearer
      bearerFormat: API Key
      description: >-
        所有 API 请求都需要 Bearer Token。请在请求头中添加 `Authorization: Bearer YOUR_API_KEY`
        进行身份验证。
servers:
  - url: https://api.kie.ai
    description: 正式环境
security:
  - BearerAuth: []
    x-apidog:
      schemeGroups:
        - id: kn8M4YUlc5i0A0179ezwx
          schemeIds:
            - BearerAuth
      required: true
      use:
        id: kn8M4YUlc5i0A0179ezwx
      scopes:
        kn8M4YUlc5i0A0179ezwx:
          BearerAuth: []

```
