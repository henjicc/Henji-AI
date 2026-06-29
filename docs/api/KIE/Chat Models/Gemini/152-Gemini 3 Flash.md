# Gemini 3 Flash

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /gemini/v1/models/gemini-3-flash-v1betamodels:streamGenerateContent:
    post:
      summary: Gemini 3 Flash
      deprecated: false
      description: >-
        ### Streaming Support


        Gemini 端点使用 `streamGenerateContent` 返回流式结果。函数调用结果会出现在
        `candidates[].content.parts[].functionCall` 中。


        **Streaming Response Format:**

        - Content-Type: `text/event-stream` 或提供方分块流

        - 函数调用会在 `parts[].functionCall` 中返回

        - 思考输出可能通过 `thoughtSignature` 和 usage 信息体现


        ## Features


        - 使用 `contents` 进行标准对话。

        - 使用 `googleSearch` 启用联网搜索。

        - 使用 `functionDeclarations` 进行函数调用。

        - 使用 `generationConfig.thinkingConfig` 控制思考配置。


        ## Request Notes


        - 使用 `contents` 作为主要输入字段。

        - 使用 `tools.googleSearch` 开启 Google Search。

        - 使用 `tools.functionDeclarations` 定义可调用函数。

        - 使用 `generationConfig.thinkingConfig` 控制思考输出与 thinking level。


        ## Authentication


        该接口使用鉴权配置中的 `X-Goog-Api-Key`，不作为普通请求参数填写。
      operationId: gemini_3_flash_v1betamodels
      tags:
        - docs/zh-CN/Market/Chat  Models/Gemini
      parameters: []
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                stream:
                  type: boolean
                  default: true
                  description: 如果设为 true，提供方会返回流式分块结果。
                  examples:
                    - true
                contents:
                  type: array
                  description: Gemini 对话输入数组。
                  items:
                    type: object
                    properties:
                      role:
                        type: string
                        enum:
                          - user
                          - model
                        description: 内容角色。
                        examples:
                          - user
                      parts:
                        type: array
                        description: 内容片段数组，可传 text、inline_data 或提供方特有结构。
                        items:
                          oneOf:
                            - type: object
                              properties:
                                text:
                                  type: string
                                  description: 文本输入内容。
                                  examples:
                                    - What is the weather in Beijing today?
                              x-apidog-orders:
                                - text
                            - type: object
                              properties:
                                inline_data:
                                  type: object
                                  description: 内联二进制数据。
                                  properties:
                                    mime_type:
                                      type: string
                                      examples:
                                        - image/jpeg
                                    data:
                                      type: string
                                      description: Base64 数据。
                                  x-apidog-orders:
                                    - mime_type
                                    - data
                              x-apidog-orders:
                                - inline_data
                            - type: object
                              properties:
                                file_data:
                                  type: object
                                  properties:
                                    mime_type:
                                      type: string
                                      description: 文件 mime type
                                    file_uri:
                                      type: string
                                      description: 文件链接地址
                                  x-apidog-orders:
                                    - mime_type
                                    - file_uri
                              x-apidog-orders:
                                - file_data
                    required:
                      - role
                      - parts
                    x-apidog-orders:
                      - role
                      - parts
                  minItems: 1
                tools:
                  type: array
                  description: 可选的 Gemini 工具配置，支持 googleSearch 和 functionDeclarations。
                  items:
                    oneOf:
                      - type: object
                        properties:
                          googleSearch:
                            type: object
                            description: Google Search 联网搜索工具。
                            additionalProperties: false
                            x-apidog-orders: []
                        x-apidog-orders:
                          - googleSearch
                      - type: object
                        properties:
                          functionDeclarations:
                            type: array
                            description: 函数声明列表。
                            items:
                              type: object
                              properties:
                                name:
                                  type: string
                                  description: 函数名称。
                                  examples:
                                    - get_weather_forecast
                                description:
                                  type: string
                                  description: 函数描述。
                                  examples:
                                    - >-
                                      Get the weather forecast for a given
                                      location
                                parameters:
                                  type: object
                                  description: 函数参数 Schema。
                                  properties:
                                    type:
                                      type: string
                                      examples:
                                        - OBJECT
                                    properties:
                                      type: object
                                      additionalProperties: true
                                      x-apidog-orders: []
                                    required:
                                      type: array
                                      items:
                                        type: string
                                  x-apidog-orders:
                                    - type
                                    - properties
                                    - required
                                  examples:
                                    - type: OBJECT
                                      properties:
                                        location:
                                          type: STRING
                                          description: The city name, e.g. Beijing
                                      required:
                                        - location
                              required:
                                - name
                                - description
                                - parameters
                              x-apidog-orders:
                                - name
                                - description
                                - parameters
                        x-apidog-orders:
                          - functionDeclarations
                generationConfig:
                  type: object
                  description: 生成配置。
                  properties:
                    thinkingConfig:
                      type: object
                      description: 思考配置。
                      properties:
                        includeThoughts:
                          type: boolean
                          description: 是否包含思考输出。
                          examples:
                            - true
                        thinkingLevel:
                          type: string
                          enum:
                            - low
                            - high
                          description: thinking level 等级。
                          examples:
                            - high
                      x-apidog-orders:
                        - includeThoughts
                        - thinkingLevel
                  x-apidog-orders:
                    - thinkingConfig
              required:
                - contents
              x-apidog-orders:
                - stream
                - contents
                - tools
                - generationConfig
              examples:
                - stream: true
                  contents:
                    - role: user
                      parts:
                        - text: What is the weather in Beijing today?
                  tools:
                    - functionDeclarations:
                        - name: get_weather_forecast
                          description: Get the weather forecast for a given location
                          parameters:
                            type: OBJECT
                            properties:
                              location:
                                type: STRING
                                description: The city name, e.g. Beijing
                            required:
                              - location
                  generationConfig:
                    thinkingConfig:
                      includeThoughts: true
                      thinkingLevel: high
            example:
              stream: true
              contents:
                - role: user
                  parts:
                    - text: What is the weather in Beijing today?
              tools:
                - functionDeclarations:
                    - name: get_weather_forecast
                      description: Get the weather forecast for a given location
                      parameters:
                        type: OBJECT
                        properties:
                          location:
                            type: STRING
                            description: The city name, e.g. Beijing
                        required:
                          - location
              generationConfig:
                thinkingConfig:
                  includeThoughts: true
                  thinkingLevel: high
      responses:
        '200':
          description: 请求成功。
          content:
            application/json:
              schema:
                type: object
                properties:
                  candidates:
                    type: array
                    description: 候选结果列表
                    items:
                      type: object
                      properties:
                        content:
                          type: object
                          properties:
                            role:
                              type: string
                              examples:
                                - model
                            parts:
                              type: array
                              items:
                                type: object
                                properties:
                                  functionCall:
                                    type: object
                                    description: 函数调用结构
                                    properties:
                                      args:
                                        type: object
                                        description: 函数参数
                                        additionalProperties: true
                                        x-apidog-orders: []
                                      name:
                                        type: string
                                        description: 函数名称
                                        examples:
                                          - get_weather_forecast
                                      id:
                                        type: string
                                        description: 函数调用标识
                                        examples:
                                          - gp737npz
                                    x-apidog-orders:
                                      - args
                                      - name
                                      - id
                                  thoughtSignature:
                                    type: string
                                    description: 思考签名字段
                                    examples:
                                      - Es8CCswCAb4example
                                  text:
                                    type: string
                                    description: 文本输出
                                x-apidog-orders:
                                  - functionCall
                                  - thoughtSignature
                                  - text
                          x-apidog-orders:
                            - role
                            - parts
                        finishReason:
                          type: string
                          description: 候选结束原因
                          examples:
                            - STOP
                      x-apidog-orders:
                        - content
                        - finishReason
                  modelVersion:
                    type: string
                    description: 返回的模型版本
                    examples:
                      - gemini-3-flash
                  usageMetadata:
                    type: object
                    description: Token 用量信息
                    properties:
                      candidatesTokenCount:
                        type: integer
                        examples:
                          - 18
                      thoughtsTokenCount:
                        type: integer
                        examples:
                          - 55
                      totalTokenCount:
                        type: integer
                        examples:
                          - 325
                      promptTokenCount:
                        type: integer
                        examples:
                          - 252
                    x-apidog-orders:
                      - candidatesTokenCount
                      - thoughtsTokenCount
                      - totalTokenCount
                      - promptTokenCount
                  credits_consumed:
                    type: number
                    description: 本次请求消耗的 credits
                    examples:
                      - 0.01
                  responseId:
                    type: string
                    description: 响应唯一标识
                    examples:
                      - xRS0aZC5BNHVz7IPuaO42Qk
                x-apidog-orders:
                  - candidates
                  - modelVersion
                  - usageMetadata
                  - credits_consumed
                  - responseId
              example:
                candidates:
                  - content:
                      role: model
                      parts:
                        - functionCall:
                            args:
                              location: Beijing
                            name: get_weather_forecast
                            id: gp737npz
                          thoughtSignature: Es8CCswCAb4example
                    finishReason: STOP
                modelVersion: gemini-3-flash
                usageMetadata:
                  candidatesTokenCount: 18
                  thoughtsTokenCount: 55
                  totalTokenCount: 325
                  promptTokenCount: 252
                credits_consumed: 0.01
                responseId: xRS0aZC5BNHVz7IPuaO42Qk
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
      x-apidog-folder: docs/zh-CN/Market/Chat  Models/Gemini
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-30749695-run
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
