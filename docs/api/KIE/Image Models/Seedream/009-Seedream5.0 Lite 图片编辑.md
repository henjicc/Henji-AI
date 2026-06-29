# Seedream5.0 Lite 图片编辑

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
      summary: Seedream5.0 Lite 图片编辑
      deprecated: false
      description: >-
        使用 Seedream5.0 Lite 进行图片编辑


        ## 查询任务状态

        提交任务后，可通过统一的查询端点查看任务进度并获取处理结果：


        <Card title="获取任务详情" icon="lucide-search"
        href="/cn/market/common/get-task-detail">
          了解如何查询任务状态并获取编辑结果
        </Card>


        ::: tip[]

        生产环境中，建议使用 `callBackUrl` 参数在生成完成时接收自动通知，而非轮询状态端点。

        :::


        ## 相关资源


        <CardGroup cols={2}>
          <Card title="市场概览" icon="lucide-store" href="/cn/market/quickstart">
            探索所有可用模型
          </Card>
          <Card title="通用 API" icon="lucide-cog" href="/cn/common-api/get-account-credits">
            查看积分与账户使用情况
          </Card>
        </CardGroup>
      operationId: seedream-5-lite-image-to-image
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
                    - seedream/5-lite-image-to-image
                  default: seedream/5-lite-image-to-image
                  description: |-
                    用于生成的模型名称。必填字段。

                    - 此端点必须使用 `seedream/5-lite-image-to-image`
                  examples:
                    - seedream/5-lite-image-to-image
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
                      type: string
                      description: 您想要生成的图像的文本描述（最大长度：3-3000 字符）
                      maxLength: 3000
                      examples:
                        - >-
                          Keep the model's pose and the flowing shape of the
                          liquid dress unchanged. Change the clothing material
                          from silver metal to completely transparent clear
                          water (or glass). Through the liquid water, the
                          model's skin details are visible. Lighting changes
                          from reflection to refraction.
                      minLength: 3
                    image_urls:
                      description: >-
                        上传图像文件作为 API 的输入（上传后的文件
                        URL，非文件内容；支持类型：image/jpeg、image/png、image/webp；最大大小：10.0MB)
                      type: array
                      items:
                        type: string
                        format: uri
                      maxItems: 14
                      examples:
                        - - >-
                            https://static.aiquickdraw.com/tools/example/1764851484363_ScV1s2aq.webp
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
                      description: 基础质量输出 2K 图像，高质量输出 4K 图像。
                      type: string
                      enum:
                        - basic
                        - high
                      default: basic
                      examples:
                        - basic
                    nsfw_checker:
                      type: boolean
                      description: >-
                        默认值为 false。您可以根据需要将其设置为 false。如果设置为
                        false，内容过滤功能将被禁用，所有结果将由模型直接返回。
                  required:
                    - prompt
                    - image_urls
                    - aspect_ratio
                    - quality
                  x-apidog-orders:
                    - prompt
                    - image_urls
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
              model: seedream/5-lite-image-to-image
              callBackUrl: https://your-domain.com/api/callback
              input:
                prompt: >-
                  Keep the model's pose and the flowing shape of the liquid
                  dress unchanged. Change the clothing material from silver
                  metal to completely transparent clear water (or glass).
                  Through the liquid water, the model's skin details are
                  visible. Lighting changes from reflection to refraction.
                image_urls:
                  - >-
                    https://static.aiquickdraw.com/tools/example/1764851484363_ScV1s2aq.webp
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
                  - $ref: '#/components/schemas/ApiResponse'
              example:
                code: 200
                msg: success
                data:
                  taskId: task_seedream_1765172101886
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
      x-apidog-folder: docs/zh-CN/Market/Image    Models/Seedream
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-30846961-run
components:
  schemas:
    ApiResponse:
      type: object
      properties:
        code:
          type: integer
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

            - **433**: Request Limit - Sub-key Usage Exceeds Limit

            - **455**: Service Unavailable - System is currently undergoing
            maintenance

            - **500**: Server Error - An unexpected error occurred while
            processing the request

            - **501**: Generation Failed - Content generation task failed

            - **505**: Feature Disabled - The requested feature is currently
            disabled
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
          x-apidog-orders:
            - taskId
          required:
            - taskId
          x-apidog-ignore-properties: []
      x-apidog-orders:
        - code
        - msg
        - data
      title: response not with recordId
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
