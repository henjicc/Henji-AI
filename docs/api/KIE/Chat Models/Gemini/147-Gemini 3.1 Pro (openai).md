# Gemini 3.1 Pro (openai)

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /gemini-3.1-pro/v1/chat/completions:
    post:
      summary: Gemini 3.1 Pro (openai)
      deprecated: false
      description: >-
        ### 流式响应支持


        当请求中设置 `stream: true` 时，API 将以服务器发送事件（SSE）的形式返回响应，Content-Type 为
        `text/event-stream`。这允许渐进式响应交付，消息增量会在生成时逐步发送。每个事件包含部分消息内容，使您能够在应用程序中实时显示响应。


        **流式响应格式：**

        - Content-Type: `text/event-stream`

        - 每个事件行以 `data: ` 开头，后跟 JSON

        - 事件包含增量消息增量

        - 最终事件通过 `finish_reason` 指示完成


        <CardGroup cols={2}>
          <Card title="多模态" icon="image">
            支持文本和图像输入
          </Card>
          <Card title="实时搜索" icon="magnifying-glass">
            启用 Google 搜索增强
          </Card>
          <Card title="流式传输" icon="stream">
            支持服务器发送事件
          </Card>
          <Card title="灵活角色" icon="users">
            支持多种消息角色
          </Card>
        </CardGroup>


        ## 统一媒体文件格式


        ::: warning[]

        在 `messages` 参数的 `content` 数组中，无论是图像、视频、音频还是其他文档类型，所有媒体文件都使用相同的格式结构：


        - `type` 字段始终为 `"image_url"`

        - `image_url` 字段名称保持不变

        - 唯一变化的是 `url` 值，它指向相应的媒体文件地址


        例如：图像、视频、音频、PDF 和其他文档都使用相同的 `{ type: 'image_url', image_url: { url:
        '...' } }` 结构。

        :::


        ## Tools 参数


        `tools` 参数是一个可选数组，允许您定义模型可以调用的函数。数组可以包含多个对象。使用函数调用时，可以在数组中定义多个函数。


        <AccordionGroup>

        <Accordion title="Google 搜索">

        使用此格式启用 Google 搜索增强：


        ```json

        {
          "type": "function",
          "function": {
            "name": "googleSearch"
          }
        }

        ```

        这将通过 Google 搜索启用实时信息检索。

        </Accordion>

        </AccordionGroup>
      operationId: gemini-3.1-pro-chat-completions
      tags:
        - docs/zh-CN/Market/Chat  Models/Gemini
      parameters: []
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                messages:
                  type: array
                  description: >-
                    消息对象数组。每个消息都有一个角色和内容。


                    **统一媒体文件格式：**


                    在 content 数组中，无论是图像、视频、音频还是其他文档类型，所有媒体文件都使用相同的格式结构：


                    - `type` 字段始终为 `"image_url"`

                    - `image_url` 字段名称保持不变

                    - 唯一变化的是 `url` 值，它指向相应的媒体文件地址


                    例如：图像、视频、音频、PDF 和其他文档都使用相同的 `{ type: 'image_url', image_url:
                    { url: '...' } }` 结构。
                  items:
                    $ref: '#/components/schemas/Message'
                  minItems: 1
                stream:
                  type: boolean
                  default: true
                  description: 如果设置为 true，将作为服务器发送事件发送部分消息增量。默认为 true。
                tools:
                  type: array
                  description: >-
                    可选，模型可以调用的工具数组。数组可以包含多个对象。


                    **Google 搜索**：`{"type": "function", "function": {"name":
                    "googleSearch"}}` - 通过 Google 搜索启用实时信息检索。
                  items:
                    $ref: '#/components/schemas/Tool'
                  minItems: 0
                include_thoughts:
                  type: boolean
                  description: 是否包含思考过程。如果设置为 true，思考将会被包含在响应结果中，否则将不会出现在响应结果中。默认为 true。
                  default: true
                reasoning_effort:
                  type: string
                  enum:
                    - low
                    - high
                  description: 推理的力度。低力度响应更快，高力度响应更慢但解决更复杂的问题。默认为 "high"。
                  default: high
              required:
                - messages
              x-apidog-orders:
                - messages
                - stream
                - tools
                - include_thoughts
                - reasoning_effort
              examples:
                - messages:
                    - role: user
                      content:
                        - type: text
                          text: 这张图片里有什么？
                        - type: image_url
                          image_url:
                            url: >-
                              https://file.aiquickdraw.com/custom-page/akr/section-images/1759055072437dqlsclj2.png
                  tools:
                    - type: function
                      function:
                        name: googleSearch
                  stream: true
                  include_thoughts: true
                  reasoning_effort: high
                  response_format:
                    type: json_schema
                    properties:
                      response:
                        type: string
              x-apidog-ignore-properties: []
            example:
              messages:
                - role: user
                  content:
                    - type: text
                      text: What is in this image?
                    - type: image_url
                      image_url:
                        url: >-
                          https://file.aiquickdraw.com/custom-page/akr/section-images/1759055072437dqlsclj2.png
              tools:
                - type: function
                  function:
                    name: googleSearch
              stream: true
              include_thoughts: true
              reasoning_effort: high
      responses:
        '200':
          description: 请求成功。
          content:
            application/json:
              schema:
                type: object
                properties:
                  id:
                    type: string
                    description: 聊天完成的唯一标识符
                    examples:
                      - chatcmpl-example-123
                  object:
                    type: string
                    description: 对象类型
                    examples:
                      - chat.completion
                  created:
                    type: integer
                    format: int64
                    description: 完成创建时的 Unix 时间戳
                    examples:
                      - 1677652288
                  model:
                    type: string
                    description: 模型名称
                    examples:
                      - gemini-3-pro
                  choices:
                    type: array
                    description: 完成选项数组
                    items:
                      type: object
                      properties:
                        index:
                          type: integer
                          description: 选项索引
                          examples:
                            - 0
                        message:
                          type: object
                          properties:
                            role:
                              type: string
                              examples:
                                - assistant
                            content:
                              type: string
                              description: 消息内容
                          required:
                            - role
                            - content
                          x-apidog-orders:
                            - role
                            - content
                          x-apidog-ignore-properties: []
                        finish_reason:
                          type: string
                          description: 完成完成的原因
                          examples:
                            - stop
                      required:
                        - index
                        - message
                        - finish_reason
                      x-apidog-orders:
                        - index
                        - message
                        - finish_reason
                      x-apidog-ignore-properties: []
                  usage:
                    type: object
                    properties:
                      prompt_tokens:
                        type: integer
                        description: 提示中的 token 数量
                        examples:
                          - 10
                      completion_tokens:
                        type: integer
                        description: 完成中的 token 数量
                        examples:
                          - 50
                      total_tokens:
                        type: integer
                        description: 总 token 数量
                        examples:
                          - 60
                    required:
                      - prompt_tokens
                      - completion_tokens
                      - total_tokens
                    x-apidog-orders:
                      - prompt_tokens
                      - completion_tokens
                      - total_tokens
                    x-apidog-ignore-properties: []
                x-apidog-orders:
                  - id
                  - object
                  - created
                  - model
                  - choices
                  - usage
                x-apidog-ignore-properties: []
              example:
                choices:
                  - finish_reason: stop
                    index: 0
                    message:
                      content: Hello! How can I help you today?
                      role: assistant
                created: 1768283309
                credits_consumed: 27
                id: chatcmpl-********************z6IaTP6H
                model: gemini-3.1-pro
                object: chat.completion
                usage:
                  completion_tokens: 383
                  completion_tokens_details:
                    audio_tokens: 0
                    text_tokens: 0
                    reasoning_tokens: 374
                  prompt_tokens: 1
                  total_tokens: 384
          headers: {}
          x-apidog-name: ''
        '400':
          description: 错误请求 - 无效的请求参数
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
                          - 无效的请求参数
                      type:
                        type: string
                        examples:
                          - invalid_request_error
                    x-apidog-orders:
                      - message
                      - type
                    x-apidog-ignore-properties: []
                x-apidog-orders:
                  - error
                x-apidog-ignore-properties: []
          headers: {}
          x-apidog-name: ''
        '401':
          description: 未授权 - 无效或缺少 API key
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
                          - 未授权
                      type:
                        type: string
                        examples:
                          - authentication_error
                    x-apidog-orders:
                      - message
                      - type
                    x-apidog-ignore-properties: []
                x-apidog-orders:
                  - error
                x-apidog-ignore-properties: []
          headers: {}
          x-apidog-name: ''
        '429':
          description: 速率限制 - 请求过多
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
                          - 超出速率限制
                      type:
                        type: string
                        examples:
                          - rate_limit_error
                    x-apidog-orders:
                      - message
                      - type
                    x-apidog-ignore-properties: []
                x-apidog-orders:
                  - error
                x-apidog-ignore-properties: []
          headers: {}
          x-apidog-name: ''
        '500':
          description: 请求失败
          content:
            application/json:
              schema:
                type: object
                properties: {}
                x-apidog-orders: []
                x-apidog-ignore-properties: []
          headers: {}
          x-apidog-name: ''
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
      x-apidog-folder: docs/zh-CN/Market/Chat  Models/Gemini
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-30438763-run
components:
  schemas:
    Tool:
      type: object
      description: >-
        工具定义。


        - **网络访问增强**：`{"type": "function", "function": {"name":
        "googleSearch"}}`
      properties:
        type:
          type: string
          enum:
            - function
          description: 工具类型。必须是 'function'。
          examples:
            - function
        function:
          type: object
          description: 用于网络访问增强的函数声明。
          properties:
            name:
              type: string
              description: 函数名称。必须为 `googleSearch`。
            description:
              type: string
              description: 可选但推荐。清晰且具体地描述函数功能的说明。帮助模型理解何时调用此函数。
            parameters:
              type: object
              description: >-
                定义函数参数的 JSON Schema 对象。自定义函数必需，'googleSearch' 不使用。遵循 JSON Schema
                规范。
              properties:
                type:
                  type: string
                  enum:
                    - object
                  description: 必须是 'object' 用于函数参数
                properties:
                  type: object
                  description: 将参数名称映射到其 JSON Schema 定义的对象
                  additionalProperties:
                    type: string
                  x-apidog-orders: []
                  properties: {}
                  x-apidog-ignore-properties: []
                required:
                  type: array
                  items:
                    type: string
                  description: 必需参数名称数组
              required:
                - type
                - properties
              x-apidog-orders:
                - type
                - properties
                - required
              x-apidog-ignore-properties: []
          required:
            - name
          x-apidog-orders:
            - name
            - description
            - parameters
          x-apidog-ignore-properties: []
      required:
        - type
        - function
      x-apidog-orders:
        - type
        - function
      title: The tools parameter of the chat model
      x-apidog-ignore-properties: []
      x-apidog-folder: ''
    Message:
      type: object
      properties:
        role:
          type: string
          enum:
            - developer
            - system
            - user
            - assistant
            - tool
          description: >-
            消息角色


            - **developer**: 开发者提供的指令，模型应遵循这些指令，无论用户消息如何。在 o1 模型及更新版本中，developer
            消息取代了之前的 system 消息。

            - **system**: 开发者提供的指令，模型应遵循这些指令，无论用户消息如何。在 o1 模型及更新版本中，请使用
            developer 消息代替。

            - **user**: 最终用户发送的消息，包含提示或额外的上下文信息。

            - **assistant**: 模型响应用户消息而发送的消息。

            - **tool**: 工具消息的内容。
        content:
          type: array
          description: >-
            消息内容数组，可以包含文本和图像对象。


            **统一媒体文件格式：**


            无论是图像、视频、音频还是其他文档类型，所有媒体文件都使用相同的格式结构：


            - `type` 字段始终为 `"image_url"`

            - `image_url` 字段名称保持不变

            - 唯一变化的是 `url` 值，它指向相应的媒体文件地址


            例如：图像、视频、音频、PDF 和其他文档都使用相同的 `{ type: 'image_url', image_url: { url:
            '...' } }` 结构。
          items:
            oneOf:
              - type: object
                properties:
                  type:
                    type: string
                    enum:
                      - text
                    examples:
                      - text
                  text:
                    type: string
                    description: 消息的文本内容
                required:
                  - type
                  - text
                x-apidog-orders:
                  - type
                  - text
                x-apidog-ignore-properties: []
              - type: object
                properties:
                  type:
                    type: string
                    enum:
                      - image_url
                    examples:
                      - image_url
                  image_url:
                    type: object
                    properties:
                      url:
                        type: string
                        format: uri
                        description: 图像的 URL
                    required:
                      - url
                    x-apidog-orders:
                      - url
                    x-apidog-ignore-properties: []
                required:
                  - type
                  - image_url
                x-apidog-orders:
                  - type
                  - image_url
                x-apidog-ignore-properties: []
      required:
        - role
        - content
      x-apidog-orders:
        - role
        - content
      title: The messages parameter of the chat model
      x-apidog-ignore-properties: []
      x-apidog-folder: ''
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
