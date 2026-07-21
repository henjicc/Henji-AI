# GPT Image1.5 文生图

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
      summary: GPT Image1.5 文生图
      deprecated: false
      description: >-
        ## 概述


        使用 GPT Image 1.5 文本转图像模型生成内容。该过程包含两个步骤：创建生成任务和查询任务状态及结果。


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
      operationId: gpt-image-1-5-text-to-image
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
                    - gpt-image/1.5-text-to-image
                  default: gpt-image/1.5-text-to-image
                  description: |-
                    用于生成的模型名称。必填字段。

                    - 此端点必须使用 `gpt-image/1.5-text-to-image`
                  examples:
                    - gpt-image/1.5-text-to-image
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
                      description: 描述您想要生成的图像的文本提示
                      type: string
                      examples:
                        - >-
                          Create a photorealistic candid photograph of an
                          elderly sailor standing on a small fishing boat.  He
                          has weathered skin with visible wrinkles, pores, and
                          sun texture, and a few faded traditional sailor
                          tattoos on his arms. He is calmly adjusting a net
                          while his dog sits nearby on the deck. Shot like a
                          35mm film photograph, medium close-up at eye level,
                          using a 50mm lens. The image should feel honest and
                          unposed, with real skin texture, worn materials, and
                          everyday detail. No glamorization, no heavy
                          retouching. 
                    aspect_ratio:
                      description: 图像的宽高比，决定其视觉形式。
                      type: string
                      enum:
                        - '1:1'
                        - '2:3'
                        - '3:2'
                      default: '1:1'
                      examples:
                        - '1:1'
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
                    - prompt
                    - aspect_ratio
                    - quality
                  x-apidog-orders:
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
              model: gpt-image/1.5-text-to-image
              callBackUrl: https://your-domain.com/api/callback
              input:
                prompt: >-
                  Create a photorealistic candid photograph of an elderly sailor
                  standing on a small fishing boat.  He has weathered skin with
                  visible wrinkles, pores, and sun texture, and a few faded
                  traditional sailor tattoos on his arms. He is calmly adjusting
                  a net while his dog sits nearby on the deck. Shot like a 35mm
                  film photograph, medium close-up at eye level, using a 50mm
                  lens. The image should feel honest and unposed, with real skin
                  texture, worn materials, and everyday detail. No
                  glamorization, no heavy retouching. 
                aspect_ratio: '1:1'
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
                  taskId: task_gpt-image_1765968190655
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
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-28506644-run
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
