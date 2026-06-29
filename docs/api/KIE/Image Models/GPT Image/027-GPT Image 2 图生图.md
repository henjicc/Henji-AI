# GPT Image 2 图生图

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /api/v1/jobs/createTask:
    post:
      summary: GPT Image 2 图生图
      deprecated: false
      description: >-
        ## 创建任务


        调用该接口可创建一个新的图生图生成任务。


        <Card title="查询任务详情" icon="lucide-search"
        href="/market/common/get-task-detail">
          提交任务后，可通过统一查询接口查看任务进度并获取生成结果
        </Card>


        ::: tip[]

        生产环境建议优先使用 `callBackUrl` 参数接收任务完成通知，而不是持续轮询任务状态接口。

        :::


        ## 相关资源


        <CardGroup cols={2}>
          <Card title="模型市场" icon="lucide-store" href="/market/quickstart">
            浏览全部可用模型与能力
          </Card>
          <Card title="通用 API" icon="lucide-cog" href="/common-api/get-account-credits">
            查看账户积分与调用情况
          </Card>
        </CardGroup>
      operationId: gpt-image-2-image-to-image-cn
      tags:
        - docs/zh-CN/Market/Image    Models/GPT Image
      parameters: []
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required:
                - model
                - input
              properties:
                model:
                  type: string
                  enum:
                    - gpt-image-2-image-to-image
                  default: gpt-image-2-image-to-image
                  description: 用于生成任务的模型名称。该字段为必填项。此接口必须使用 `gpt-image-2-image-to-image` 模型。
                  examples:
                    - gpt-image-2-image-to-image
                callBackUrl:
                  type: string
                  format: uri
                  description: >-
                    任务完成通知的回调 URL。该参数为可选项。如果提供，当任务完成时，无论成功或失败，系统都会向该 URL 发送 POST
                    请求。如果未提供，则不会发送回调通知。
                  examples:
                    - https://your-domain.com/api/callback
                input:
                  type: object
                  description: 图生图任务的输入参数。
                  required:
                    - prompt
                    - input_urls
                  properties:
                    prompt:
                      type: string
                      description: 文本提示词，最多 20000 个字符。
                      examples:
                        - 将这张产品图改造成高级感电商海报风格。
                    input_urls:
                      type: array
                      items:
                        type: string
                        format: uri
                      description: 输入图片 URL 数组。
                      examples:
                        - - https://example.com/
                      maxItems: 16
                    aspect_ratio:
                      type: string
                      description: |-
                        生成图片的比例，默认auto
                        注意: 5:4和4:5比例只支持1K图片
                      enum:
                        - auto
                        - '1:1'
                        - '3:2'
                        - '2:3'
                        - '4:3'
                        - '3:4'
                        - '5:4'
                        - '4:5'
                        - '16:9'
                        - '9:16'
                        - '2:1'
                        - '1:2'
                        - '3:1'
                        - '1:3'
                        - '21:9'
                        - '9:21'
                      x-apidog-enum:
                        - label: auto
                          value: auto
                          description: ''
                        - label: '1:1'
                          value: '1:1'
                          description: ''
                        - label: '3:2'
                          value: '3:2'
                          description: ''
                        - label: '2:3'
                          value: '2:3'
                          description: ''
                        - label: '4:3'
                          value: '4:3'
                          description: ''
                        - label: '3:4'
                          value: '3:4'
                          description: ''
                        - label: '5:4'
                          value: '5:4'
                          description: ''
                        - label: '4:5'
                          value: '4:5'
                          description: ''
                        - label: '16:9'
                          value: '16:9'
                          description: ''
                        - label: '9:16'
                          value: '9:16'
                          description: ''
                        - label: '2:1'
                          value: '2:1'
                          description: ''
                        - label: '1:2'
                          value: '1:2'
                          description: ''
                        - label: '3:1'
                          value: '3:1'
                          description: ''
                        - label: '1:3'
                          value: '1:3'
                          description: ''
                        - label: '21:9'
                          value: '21:9'
                          description: ''
                        - value: '9:21'
                          name: ''
                          description: ''
                    resolution:
                      type: string
                      enum:
                        - 1K
                        - 2K
                        - 4K
                      x-apidog-enum:
                        - value: 1K
                          name: ''
                          description: ''
                        - value: 2K
                          name: ''
                          description: ''
                        - value: 4K
                          name: ''
                          description: ''
                      description: >-
                        图片的分辨率   注意:
                        1:1比例的图片无法生成4K图片,auto比例或者未传递比例参数的话只能生成1K图片,否则将无法创建任务
                  x-apidog-orders:
                    - prompt
                    - input_urls
                    - aspect_ratio
                    - resolution
                  x-apidog-ignore-properties: []
              x-apidog-orders:
                - model
                - callBackUrl
                - input
              x-apidog-ignore-properties: []
            example:
              model: gpt-image-2-image-to-image
              callBackUrl: https://your-domain.com/api/callback
              input:
                prompt: take a photo with Sam Altman in the conference room
                input_urls:
                  - >-
                    https://static.aiquickdraw.com/tools/example/1776782793756_wrogXTdd.png
                aspect_ratio: auto
      responses:
        '200':
          description: 请求成功
          content:
            application/json:
              schema:
                allOf:
                  - type: object
                    properties:
                      code:
                        type: integer
                        description: |-
                          响应状态码
                          200: 成功 - 请求已成功处理
                          401: 未授权 - 缺少身份验证凭据或凭据无效
                          402: 额度不足 - 账户额度不足，无法执行该操作
                          404: 未找到 - 请求的资源或接口不存在
                          422: 校验错误 - 请求参数未通过校验检查
                          429: 请求受限 - 已超过该资源的请求频率限制
                          433: 请求限额 - 子 key 使用超出限额
                          455: 服务不可用 - 系统目前正在维护中
                          500: 服务器错误 - 处理请求时发生了意外错误
                          501: 生成失败 - 内容生成任务失败
                          505: 功能禁用 - 请求的功能目前已禁用
                        enum:
                          - 200
                          - 401
                          - 402
                          - 404
                          - 422
                          - 429
                          - 433
                          - 455
                          - 500
                          - 501
                          - 505
                        x-apidog-enum:
                          - value: 200
                            name: ''
                            description: ''
                          - value: 401
                            name: ''
                            description: ''
                          - value: 402
                            name: ''
                            description: ''
                          - value: 404
                            name: ''
                            description: ''
                          - value: 422
                            name: ''
                            description: ''
                          - value: 429
                            name: ''
                            description: ''
                          - value: 433
                            name: ''
                            description: ''
                          - value: 455
                            name: ''
                            description: ''
                          - value: 500
                            name: ''
                            description: ''
                          - value: 501
                            name: ''
                            description: ''
                          - value: 505
                            name: ''
                            description: ''
                      msg:
                        type: string
                        description: 响应消息，失败时的错误描述
                      data:
                        type: object
                        properties:
                          taskId:
                            type: string
                            description: 任务 ID 可与“获取任务详细信息”端点一起使用，以查询任务状态
                        x-apidog-orders:
                          - taskId
                        required:
                          - taskId
                        x-apidog-ignore-properties: []
                    x-apidog-orders:
                      - 01KPR06AAKC9D1TPJJV7085VD8
                    required:
                      - code
                      - msg
                      - data
                    x-apidog-refs:
                      01KPR06AAKC9D1TPJJV7085VD8:
                        $ref: '#/components/schemas/ApiResponse'
                    x-apidog-ignore-properties:
                      - code
                      - msg
                      - data
              example:
                code: 200
                msg: success
                data:
                  taskId: task_gptimage_1765180586443
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
      x-apidog-folder: docs/zh-CN/Market/Image    Models/GPT Image
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-33849563-run
components:
  schemas:
    ApiResponse:
      type: object
      properties:
        code:
          type: integer
          description: |-
            响应状态码
            200: 成功 - 请求已成功处理
            401: 未授权 - 缺少身份验证凭据或凭据无效
            402: 额度不足 - 账户额度不足，无法执行该操作
            404: 未找到 - 请求的资源或接口不存在
            422: 校验错误 - 请求参数未通过校验检查
            429: 请求受限 - 已超过该资源的请求频率限制
            433: 请求限额 - 子 key 使用超出限额
            455: 服务不可用 - 系统目前正在维护中
            500: 服务器错误 - 处理请求时发生了意外错误
            501: 生成失败 - 内容生成任务失败
            505: 功能禁用 - 请求的功能目前已禁用
          enum:
            - 200
            - 401
            - 402
            - 404
            - 422
            - 429
            - 433
            - 455
            - 500
            - 501
            - 505
          x-apidog-enum:
            - value: 200
              name: ''
              description: ''
            - value: 401
              name: ''
              description: ''
            - value: 402
              name: ''
              description: ''
            - value: 404
              name: ''
              description: ''
            - value: 422
              name: ''
              description: ''
            - value: 429
              name: ''
              description: ''
            - value: 433
              name: ''
              description: ''
            - value: 455
              name: ''
              description: ''
            - value: 500
              name: ''
              description: ''
            - value: 501
              name: ''
              description: ''
            - value: 505
              name: ''
              description: ''
        msg:
          type: string
          description: 响应消息，失败时的错误描述
        data:
          type: object
          properties:
            taskId:
              type: string
              description: 任务 ID 可与“获取任务详细信息”端点一起使用，以查询任务状态
          x-apidog-orders:
            - taskId
          required:
            - taskId
          x-apidog-ignore-properties: []
      x-apidog-orders:
        - code
        - msg
        - data
      required:
        - code
        - msg
        - data
      title: response not with recordId
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
