# Seedream5.0 Lite 文生图

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
      summary: Seedream5.0 Lite 文生图
      deprecated: false
      description: >-
        基于 Seedream 先进 AI 模型的高质量写实风格图像生成


        ## 查询任务状态


        提交任务后，可通过统一的查询端点查看任务进度并获取生成结果：


        <Card title="获取任务详情" icon="lucide-search"
        href="/cn/market/common/get-task-detail">
          了解如何查询任务状态并获取生成结果
        </Card>


        ::: tip[]

        生产环境中，建议使用 `callBackUrl` 参数接收生成完成的自动通知，而非轮询状态端点。

        :::


        ## 相关资源


        <CardGroup cols={2}>
          <Card title="市场概览" icon="lucide-store" href="/cn/market/quickstart">
            浏览所有可用模型
          </Card>
          <Card title="通用 API" icon="lucide-cog" href="/cn/common-api/get-account-credits">
            查看账户积分与使用情况
          </Card>
        </CardGroup>
      operationId: seedream-5-lite-text-to-image
      tags:
        - docs/zh-CN/Market/Image    Models/Seedream
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
                    - seedream/5-lite-text-to-image
                  default: seedream/5-lite-text-to-image
                  description: |-
                    用于生成的模型名称。必填字段。

                    - 此端点必须使用 `seedream/5-lite-text-to-image`
                  examples:
                    - seedream/5-lite-text-to-image
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
                    prompt:
                      description: 您想要生成的图像的文本描述（最大长度：3-3000 字符）
                      type: string
                      maxLength: 3000
                      examples:
                        - >-
                          A full-process cafe design tool for entrepreneurs and
                          designers. It covers core needs including store
                          layout, functional zoning, decoration style, equipment
                          selection, and customer group adaptation, supporting
                          integrated planning of "commercial attributes +
                          aesthetic design." Suitable as a promotional image for
                          a cafe design SaaS product, with a 16:9 aspect ratio.
                    aspect_ratio:
                      description: 图像的宽高比，决定其视觉形态。
                      type: string
                      enum:
                        - '1:1'
                        - '4:3'
                        - '3:4'
                        - '16:9'
                        - '9:16'
                        - '2:3'
                        - '3:2'
                        - '21:9'
                      default: '1:1'
                      examples:
                        - '1:1'
                    quality:
                      description: 基础质量输出 2K 图像，高质量输出 3K 图像。
                      type: string
                      enum:
                        - basic
                        - high
                      default: basic
                      examples:
                        - basic
                    nsfw_checker:
                      type: boolean
                      description: Playground 中默认启用。对于 API 调用，您可以根据需要启用或禁用此功能。
                  required:
                    - prompt
                    - aspect_ratio
                    - quality
                  x-apidog-orders:
                    - prompt
                    - aspect_ratio
                    - quality
                    - nsfw_checker
                  x-apidog-ignore-properties: []
              x-apidog-orders:
                - model
                - callBackUrl
                - input
              x-apidog-ignore-properties: []
            example:
              model: seedream/5-lite-text-to-image
              callBackUrl: https://your-domain.com/api/callback
              input:
                prompt: >-
                  A full-process cafe design tool for entrepreneurs and
                  designers. It covers core needs including store layout,
                  functional zoning, decoration style, equipment selection, and
                  customer group adaptation, supporting integrated planning of
                  "commercial attributes + aesthetic design." Suitable as a
                  promotional image for a cafe design SaaS product, with a 16:9
                  aspect ratio.
                aspect_ratio: '1:1'
                quality: basic
                nsfw_checker: false
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/ApiResponseWithRecordId'
              example:
                code: 200
                msg: success
                data:
                  taskId: task_seedream_1765166238716
          headers: {}
          x-apidog-name: 成功
        '500':
          description: request failed
          content:
            application/json:
              schema:
                type: object
                properties:
                  code:
                    type: integer
                    description: >-
                      Response status code


                      - **200**: Success - Request has been processed
                      successfully

                      - **401**: Unauthorized - Authentication credentials are
                      missing or invalid

                      - **402**: Insufficient Credits - Account does not have
                      enough credits to perform the operation

                      - **404**: Not Found - The requested resource or endpoint
                      does not exist

                      - **408**: Upstream is currently experiencing service
                      issues. No result has been returned for over 10 minutes.

                      - **422**: Validation Error - The request parameters
                      failed validation checks

                      - **429**: Rate Limited - Request limit has been exceeded
                      for this resource

                      - **455**: Service Unavailable - System is currently
                      undergoing maintenance

                      - **500**: Server Error - An unexpected error occurred
                      while processing the request

                      - **501**: Generation Failed - Content generation task
                      failed

                      - **505**: Feature Disabled - The requested feature is
                      currently disabled
                  msg:
                    type: string
                    description: Response message, error description when failed
                  data:
                    type: object
                    properties: {}
                    x-apidog-orders: []
                    x-apidog-ignore-properties: []
                x-apidog-orders:
                  - code
                  - msg
                  - data
                required:
                  - code
                  - msg
                  - data
                x-apidog-ignore-properties: []
              example:
                code: 500
                msg: >-
                  Server Error - An unexpected error occurred while processing
                  the request
                data: null
          headers: {}
          x-apidog-name: 'Error '
      security: []
      x-apidog-folder: docs/zh-CN/Market/Image    Models/Seedream
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-30846957-run
components:
  schemas:
    ApiResponseWithRecordId:
      type: object
      properties:
        code:
          type: integer
          enum:
            - 200
            - 401
            - 402
            - 404
            - 422
            - 429
            - 455
            - 500
            - 501
            - 505
          description: >-
            Response status code


            - **200**: Success - Request has been processed successfully

            - **401**: Unauthorized - Authentication credentials are missing or
            invalid

            - **402**: Insufficient Credits - Account does not have enough
            credits to perform the operation

            - **404**: Not Found - The requested resource or endpoint does not
            exist

            - **422**: Validation Error - The request parameters failed
            validation checks

            - **429**: Rate Limited - Request limit has been exceeded for this
            resource

            - **455**: Service Unavailable - System is currently undergoing
            maintenance

            - **500**: Server Error - An unexpected error occurred while
            processing the request

            - **501**: Generation Failed - Content generation task failed

            - **505**: Feature Disabled - The requested feature is currently
            disabled
        msg:
          type: string
          description: Response message, error description when failed
          examples:
            - success
        data:
          type: object
          properties:
            taskId:
              type: string
              description: >-
                Task ID, can be used with Get Task Details endpoint to query
                task status
            recordId:
              type: string
              description: Record ID, can be used to get the record details
          x-apidog-orders:
            - taskId
            - recordId
          x-apidog-ignore-properties: []
      x-apidog-orders:
        - code
        - msg
        - data
      title: response with recordId
      required:
        - data
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
