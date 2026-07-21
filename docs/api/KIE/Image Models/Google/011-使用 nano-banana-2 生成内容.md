# 使用 nano-banana-2 生成内容

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
      summary: 使用 nano-banana-2 生成内容
      deprecated: false
      description: >-
        基于 Nano Banana 2 模型实现图像生成


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
      operationId: nano-banana-2
      tags:
        - docs/zh-CN/Market/Image    Models/Google
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
                    - nano-banana-2
                  default: nano-banana-2
                  description: |-
                    用于生成任务的模型名称。必填字段。

                    - 该端点必须使用 `nano-banana-2` 模型
                  examples:
                    - nano-banana-2
                callBackUrl:
                  type: string
                  format: uri
                  description: >-
                    接收生成任务完成通知的回调 URL。可选配置，建议在生产环境中使用。


                    - 任务生成完成后，系统会向该 URL POST 任务状态与结果

                    - 回调内容包含生成的资源 URL 与任务相关信息

                    - 您的回调端点需要支持接收带 JSON 负载的 POST 请求

                    - 也可以选择调用任务详情端点，主动轮询任务状态

                    - 为确保回调安全性，请参阅 [Webhook
                    校验指南](/cn/common-api/webhook-verification) 了解签名验证实现方法
                  examples:
                    - https://your-domain.com/api/callback
                input:
                  type: object
                  description: 生成任务的输入参数
                  properties:
                    aspect_ratio:
                      description: 生成图像的宽高比
                      type: string
                      enum:
                        - auto
                        - '1:1'
                        - '1:4'
                        - '16:9'
                        - '1:8'
                        - '21:9'
                        - '2:3'
                        - '3:2'
                        - '3:4'
                        - '4:1'
                        - '4:3'
                        - '4:5'
                        - '5:4'
                        - '8:1'
                        - '9:16'
                      default: auto
                      examples:
                        - auto
                    image_input:
                      description: >-
                        用于图像变换或作为参考的输入图像（最多支持 14 张图片）（为上传后的文件
                        URL，非文件内容；支持的类型：image/jpeg、image/png、image/webp；最大文件大小：30.0MB）
                      type: array
                      items:
                        type: string
                        format: uri
                      maxItems: 14
                      examples:
                        - []
                    output_format:
                      description: 生成图像的输出格式
                      type: string
                      enum:
                        - jpg
                        - png
                      default: jpg
                      examples:
                        - jpg
                    prompt:
                      description: 用于描述待生成图像的文本提示词（最大长度：20000 字符）
                      type: string
                      maxLength: 20000
                      examples:
                        - 一幅高度细致的插画：香蕉造型的未来飞船在夜晚的霓虹城市上空飞行，光影真实、具有电影感效果、4K 质量。
                    resolution:
                      description: 生成图像的分辨率
                      type: string
                      enum:
                        - 1K
                        - 2K
                        - 4K
                      default: 1K
                      examples:
                        - 1K
                  required:
                    - prompt
                  x-apidog-orders:
                    - aspect_ratio
                    - image_input
                    - output_format
                    - prompt
                    - resolution
                  x-apidog-ignore-properties: []
              x-apidog-orders:
                - model
                - callBackUrl
                - input
              x-apidog-ignore-properties: []
            example:
              model: nano-banana-2
              callBackUrl: https://your-domain.com/api/callback
              input:
                prompt: 一幅高度细致的插画：香蕉造型的未来飞船在夜晚的霓虹城市上空飞行，光影真实、具有电影感效果、4K 质量。
                aspect_ratio: auto
                resolution: 2K
                output_format: jpg
                image_input: []
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
                        description: >-
                          Response status code


                          - **200**: Success - Request has been processed
                          successfully

                          - **401**: Unauthorized - Authentication credentials
                          are missing or invalid

                          - **402**: Insufficient Credits - Account does not
                          have enough credits to perform the operation

                          - **404**: Not Found - The requested resource or
                          endpoint does not exist

                          - **422**: Validation Error - The request parameters
                          failed validation checks

                          - **429**: Rate Limited - Request limit has been
                          exceeded for this resource

                          - **433**: Request Limit - Sub-key Usage Exceeds Limit

                          - **455**: Service Unavailable - System is currently
                          undergoing maintenance

                          - **500**: Server Error - An unexpected error occurred
                          while processing the request

                          - **501**: Generation Failed - Content generation task
                          failed

                          - **505**: Feature Disabled - The requested feature is
                          currently disabled
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
                              Task ID, can be used with Get Task Details
                              endpoint to query task status
                        x-apidog-orders:
                          - taskId
                        required:
                          - taskId
                        x-apidog-ignore-properties: []
                    x-apidog-orders:
                      - 01KJP94Z37NRRXMEZHZ7W59PF4
                    required:
                      - data
                    x-apidog-refs:
                      01KJP94Z37NRRXMEZHZ7W59PF4:
                        $ref: '#/components/schemas/ApiResponse'
                    x-apidog-ignore-properties:
                      - code
                      - msg
                      - data
              example:
                code: 200
                msg: success
                data:
                  taskId: task_nano-banana-2_1765178625768
          headers: {}
          x-apidog-name: ''
      security: []
      x-apidog-folder: docs/zh-CN/Market/Image    Models/Google
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-28805224-run
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
