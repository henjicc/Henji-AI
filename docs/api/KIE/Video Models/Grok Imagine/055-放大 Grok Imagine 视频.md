# 放大 Grok Imagine 视频

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
      summary: 放大 Grok Imagine 视频
      deprecated: false
      description: >
        ## 任务ID来源


        `task_id` 参数应从之前生成的视频任务中获取。您可以放大使用以下方式创建的视频：


        <Card title="先生成视频" icon="lucide-video"
        href="/cn/market/grok-imagine/text-to-video">
          使用文本生成视频模型创建视频以获取可放大的任务ID
        </Card>


        **如何获取任务ID：**

        1. 使用[文本生成视频API](/cn/market/grok-imagine/text-to-video)生成视频

        2. 从API响应中提取 `taskId`

        3. 将该 `taskId` 作为放大请求中的 `task_id` 参数使用


        ::: info[]

        只能放大由Kie AI模型生成的视频。不支持外部视频。

        :::


        ## 查询任务状态


        提交放大任务后，使用统一的查询端点检查进度并获取结果：


        <Card title="获取任务详情" icon="lucide-search"
        href="/cn/market/common/get-task-detail">
          了解如何查询任务状态并获取生成结果
        </Card>


        ::: tip[]

        对于生产环境，我们建议使用 `callBackUrl` 参数接收自动通知，而不是轮询状态端点。

        :::


        ## 相关资源


        <CardGroup cols={2}>
          <Card title="市场概览" icon="lucide-store" href="/cn/market/quickstart">
            探索所有可用模型
          </Card>
          <Card title="通用API" icon="lucide-cog" href="/cn/common-api/get-account-credits">
            查看积分和账户使用情况
          </Card>
        </CardGroup>
      operationId: grok-imagine-upscale
      tags:
        - docs/zh-CN/Market/Video Models/Grok Imagine
      parameters: []
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                model:
                  type: string
                  enum:
                    - grok-imagine/upscale
                  default: grok-imagine/upscale
                  description: |-
                    用于生成的模型名称。必填字段。

                    - 此端点必须使用 `grok-imagine/upscale`
                  examples:
                    - grok-imagine/upscale
                callBackUrl:
                  type: string
                  format: uri
                  description: >-
                    接收视频放大任务完成更新的 URL。可选但建议在生产环境中使用。


                    - 当视频放大完成时，系统将向此 URL POST 任务状态和结果

                    - 回调包含生成的放大视频 URL 和任务信息

                    - 您的回调端点应接受包含视频结果的 JSON 负载的 POST 请求

                    - 或者，使用获取任务详情端点轮询任务状态

                    - 为确保回调安全性，请参阅 [Webhook
                    校验指南](/cn/common-api/webhook-verification) 了解签名验证实现方法
                  examples:
                    - https://your-domain.com/api/callback
                input:
                  type: object
                  description: 视频放大任务的输入参数
                  properties:
                    task_id:
                      type: string
                      description: |-
                        之前成功的图像生成任务的任务 ID。必填字段。

                        - 必须来自 Kie AI 图像生成模型（例如 grok-imagine/text-to-image）
                        - 原始图像生成必须成功完成
                        - 最大长度：100 字符
                        - 仅支持 Kie AI 生成的任务 ID
                      maxLength: 100
                      examples:
                        - task_grok_12345678
                  required:
                    - task_id
                  x-apidog-orders:
                    - task_id
                  x-apidog-ignore-properties: []
              required:
                - model
                - input
              x-apidog-orders:
                - model
                - callBackUrl
                - input
              examples:
                - model: grok-imagine/upscale
                  callBackUrl: https://your-domain.com/api/callback
                  input:
                    task_id: task_grok_12345678
              x-apidog-ignore-properties: []
            example:
              model: grok-imagine/upscale
              callBackUrl: https://your-domain.com/api/callback
              input:
                task_id: task_grok_12345678
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
                  taskId: 281e5b0*********************f39b9
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
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-28506643-run
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
