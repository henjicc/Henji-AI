# Grok Imagine Video 1.5 Preview

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
      summary: Grok Imagine Video 1.5 Preview
      deprecated: false
      description: >-
        ## 创建任务


        使用此接口创建新的视频生成任务。


        <Card title="Get Task Details" icon="lucide-search"
        href="/market/common/get-task-detail">
          提交后，可通过统一查询接口查看任务进度并获取结果
        </Card>


        ::: tip[]

        在生产环境中，建议传入 `callBackUrl` 参数，以便你的服务在任务完成时接收任务完成通知，而不是轮询任务状态。

        :::


        ## 文件上传


        ::: tip[]

        调用此接口前需要上传文件？请查看[文件上传 API 快速开始](/file-upload-api/quickstart)。

        :::


        ## 相关资源


        <CardGroup cols={2}>
          <Card title="Model Marketplace" icon="lucide-store" href="/cn/market/quickstart">
            浏览所有可用模型与能力
          </Card>
          <Card title="Common API" icon="lucide-cog" href="/cn/common-api/get-account-credits">
            查看账户积分和用量
          </Card>
        </CardGroup>
      operationId: GrokImagineVideo15PreviewCreateTask
      tags:
        - docs/zh-CN/Market/Video Models/Grok Imagine
        - generated/grok-imagine-video-1.5-preview
      parameters: []
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                model:
                  type: string
                  description: 用于生成的模型名称。此端点必须使用 `grok-imagine-video-1-5-preview`。
                  enum:
                    - grok-imagine-video-1-5-preview
                  default: grok-imagine-video-1-5-preview
                  x-apidog-enum:
                    - value: grok-imagine-video-1-5-preview
                      name: ''
                      description: ''
                callBackUrl:
                  type: string
                  format: uri
                  description: 可选的回调 URL，用于接收任务完成通知。如果提供，系统将在任务完成时向此 URL 发送 POST 请求。
                input:
                  type: object
                  description: 生成任务的输入参数。
                  additionalProperties: false
                  properties:
                    prompt:
                      type: string
                      description: 视频生成的提示词。最大长度：4096 个字符。
                      maxLength: 4096
                    image_urls:
                      description: >-
                        上传用作 API
                        输入的图像文件。支持的文件类型：image/jpeg、image/png、image/webp、image/jpg。最大文件大小：20MB。支持多文件上传，最多
                        1 个文件。
                      type: array
                      items:
                        type: string
                        format: uri
                      maxItems: 1
                    aspect_ratio:
                      type: string
                      description: 视频生成的宽高比。
                      enum:
                        - '1:1'
                        - '16:9'
                        - '9:16'
                        - '3:2'
                        - '2:3'
                        - auto
                      x-apidog-enum:
                        - value: '1:1'
                          name: ''
                          description: ''
                        - value: '16:9'
                          name: ''
                          description: ''
                        - value: '9:16'
                          name: ''
                          description: ''
                        - value: '3:2'
                          name: ''
                          description: ''
                        - value: '2:3'
                          name: ''
                          description: ''
                        - value: auto
                          name: ''
                          description: ''
                      default: auto
                      examples:
                        - auto
                    resolution:
                      description: 视频生成的分辨率。
                      type: string
                      enum:
                        - 480p
                        - 720p
                      default: 480p
                    duration:
                      description: 视频时长（秒）。范围：[1, 15]。默认值：8。最小值：1。最大值：15。步长：1。
                      type: integer
                      minimum: 1
                      maximum: 15
                      multipleOf: 1
                      default: 8
                    nsfw_checker:
                      type: boolean
                      description: >-
                        默认值为 false。您可以根据需要将其设置为 false。如果设置为
                        false，我们的内容过滤功能将被禁用，所有结果将由模型直接返回。
                  x-apidog-orders:
                    - prompt
                    - image_urls
                    - aspect_ratio
                    - resolution
                    - duration
                    - nsfw_checker
                  x-apidog-ignore-properties: []
              x-apidog-refs: {}
              x-apidog-orders:
                - model
                - callBackUrl
                - input
              required:
                - model
                - input
              x-apidog-ignore-properties: []
            examples:
              default:
                value:
                  model: grok-imagine-video-1-5-preview
                  input:
                    prompt: Describe the scene you want to generate.
                    image_urls:
                      - https://your-domain.com/image/example.png
                    aspect_ratio: '16:9'
                    resolution: 480p
                    duration: 8
                  callBackUrl: https://your-domain.com/api/callback
                summary: 请求示例
      responses:
        '200':
          description: 请求成功。
          content:
            application/json:
              schema:
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
                      455: 服务不可用 - 系统目前正在维护中
                      500: 服务器错误 - 处理请求时发生了意外错误
                      501: 生成失败 - 内容生成任务失败
                      505: 功能禁用 - 请求的功能目前已禁用
                  msg:
                    type: string
                    description: 响应消息，失败时的错误描述
                  data:
                    type: object
                    properties:
                      taskId:
                        type: string
                        description: 任务 ID 可与“获取任务详细信息”端点一起使用，以查询任务状态
                      recordId:
                        type: string
                    x-apidog-orders:
                      - taskId
                      - recordId
                    required:
                      - taskId
                      - recordId
                    x-apidog-ignore-properties: []
                x-apidog-refs:
                  01KT1GXT891A12PYF4HGDNE3G1:
                    $ref: '#/components/schemas/ApiResponseWithRecordId'
                x-apidog-orders:
                  - 01KT1GXT891A12PYF4HGDNE3G1
                required:
                  - code
                  - msg
                  - data
                x-apidog-ignore-properties:
                  - code
                  - msg
                  - data
              examples:
                success:
                  summary: 成功响应
                  value:
                    code: 200
                    msg: success
                    data:
                      taskId: task_grok-imagine-video-1.5-preview_1234567890
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
      x-apidog-folder: docs/zh-CN/Market/Video Models/Grok Imagine
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-36941216-run
components:
  schemas:
    ApiResponseWithRecordId:
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
            455: 服务不可用 - 系统目前正在维护中
            500: 服务器错误 - 处理请求时发生了意外错误
            501: 生成失败 - 内容生成任务失败
            505: 功能禁用 - 请求的功能目前已禁用
        msg:
          type: string
          description: 响应消息，失败时的错误描述
        data:
          type: object
          properties:
            taskId:
              type: string
              description: 任务 ID 可与“获取任务详细信息”端点一起使用，以查询任务状态
            recordId:
              type: string
          x-apidog-orders:
            - taskId
            - recordId
          required:
            - taskId
            - recordId
          x-apidog-ignore-properties: []
      x-apidog-orders:
        - code
        - msg
        - data
      required:
        - code
        - msg
        - data
      title: response with recordId
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
