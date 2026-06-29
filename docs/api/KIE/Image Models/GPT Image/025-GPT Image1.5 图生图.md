# GPT Image1.5 图生图

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
      summary: GPT Image1.5 图生图
      deprecated: false
      description: >-
        ## 概述


        使用 GPT Image 1.5
        图生图模型从输入图像生成图像。此模型允许您使用文本提示编辑或修改现有图像。该过程包含两个步骤：创建生成任务和查询任务状态及结果。


        ## 文件上传要求


        在使用此 API 之前，您需要上传图像文件：


        <Steps>

        <Step title="上传图像">
          使用文件上传 API 上传您的源图像。

          <Card title="文件上传 API" icon="lucide-upload" href="/cn/file-upload-api/quickstart">
            了解如何上传图像并获取文件 URL
          </Card>
        </Step>


        <Step title="获取文件 URL">
          上传完成后，您将获得可在 `input_urls` 参数中使用的文件 URL。
        </Step>

        </Steps>


        ::: warning[]

        - 支持格式：JPEG、PNG、WebP

        - 最大文件大小：10MB

        - 每个请求最多16个输入 URL

        - 图像内容应适当并遵循使用指南

        :::


        ## 查询任务状态


        提交任务后，使用统一的查询端点检查进度并检索结果：


        <Card title="获取任务详情" icon="lucide-search"
        href="/cn/market/common/get-task-detail">
          了解如何查询任务状态和检索生成结果
        </Card>


        ::: tip[]

        对于生产使用，我们建议使用 `callBackUrl` 参数接收生成完成时的自动通知，而不是轮询状态端点。

        :::


        ## 相关资源


        <CardGroup cols={2}>
          <Card title="市场概览" icon="lucide-store" href="/cn/market/quickstart">
            探索所有可用模型
          </Card>
          <Card title="通用 API" icon="lucide-cog" href="/cn/common-api/get-account-credits">
            检查积分和账户使用情况
          </Card>
        </CardGroup>
      operationId: gpt-image-1-5-image-to-image
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
              properties:
                model:
                  type: string
                  enum:
                    - gpt-image/1.5-image-to-image
                  default: gpt-image/1.5-image-to-image
                  description: |-
                    用于生成的模型名称。必填字段。

                    - 此端点必须使用 `gpt-image/1.5-image-to-image`
                  examples:
                    - gpt-image/1.5-image-to-image
                callBackUrl:
                  type: string
                  format: uri
                  description: >-
                    接收生成任务完成更新的 URL。可选但建议在生产环境中使用。


                    - 当生成完成时，系统将向此 URL POST 任务状态和结果

                    - 回调包含生成的内容 URL 和任务信息

                    - 您的回调端点应接受包含结果的 JSON 负载的 POST 请求

                    - 或者，使用获取任务详情端点轮询任务状态

                    - 为确保回调安全性，请参阅 [Webhook
                    校验指南](/cn/common-api/webhook-verification) 了解签名验证实现方法
                  examples:
                    - https://your-domain.com/api/callback
                input:
                  type: object
                  description: 生成任务的输入参数
                  properties:
                    input_urls:
                      description: >-
                        上传图像文件作为 API 的输入（上传后的文件
                        URL，不是文件内容；接受类型：image/jpeg、image/png、image/webp；最大大小：10.0MB）
                      type: array
                      items:
                        type: string
                        format: uri
                      maxItems: 16
                      examples:
                        - - >-
                            https://static.aiquickdraw.com/tools/example/1765962794374_GhtqB9oX.webp
                    prompt:
                      description: 描述您想要生成的图像的文本提示
                      type: string
                      examples:
                        - >-
                          Edit the image to dress the woman using the provided
                          clothing images. Preserve her exact likeness,
                          expression, hairstyle, and proportions. Replace only
                          the clothing, fitting the garments naturally to her
                          existing pose and body geometry with realistic fabric
                          behavior. Match lighting, shadows, and color
                          temperature to the original photo so the outfit
                          integrates photorealistically, without looking pasted
                          on.
                    aspect_ratio:
                      description: 图像的宽高比，决定其视觉形式。
                      type: string
                      enum:
                        - '1:1'
                        - '2:3'
                        - '3:2'
                      default: '3:2'
                      examples:
                        - '3:2'
                    quality:
                      description: 质量：medium=平衡，high=慢速/详细。
                      type: string
                      enum:
                        - medium
                        - high
                      default: medium
                      examples:
                        - medium
                  required:
                    - input_urls
                    - prompt
                    - aspect_ratio
                    - quality
                  x-apidog-orders:
                    - input_urls
                    - prompt
                    - aspect_ratio
                    - quality
                  x-apidog-ignore-properties: []
              x-apidog-orders:
                - model
                - callBackUrl
                - input
              x-apidog-ignore-properties: []
            example:
              model: gpt-image/1.5-image-to-image
              callBackUrl: https://your-domain.com/api/callback
              input:
                input_urls:
                  - >-
                    https://static.aiquickdraw.com/tools/example/1765962794374_GhtqB9oX.webp
                prompt: >-
                  Edit the image to dress the woman using the provided clothing
                  images. Preserve her exact likeness, expression, hairstyle,
                  and proportions. Replace only the clothing, fitting the
                  garments naturally to her existing pose and body geometry with
                  realistic fabric behavior. Match lighting, shadows, and color
                  temperature to the original photo so the outfit integrates
                  photorealistically, without looking pasted on.
                aspect_ratio: '3:2'
                quality: medium
      responses:
        '200':
          description: 请求成功
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/ApiResponse'
              example:
                code: 200
                msg: success
                data:
                  taskId: task_gpt-image_1765968156336
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
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-28506645-run
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
