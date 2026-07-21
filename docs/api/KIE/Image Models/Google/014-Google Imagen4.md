# Google Imagen4

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
      summary: Google Imagen4
      deprecated: false
      description: >-
        基于 Google imagen4 模型实现图像生成


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
      operationId: google-imagen4
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
                    - google/imagen4
                  default: google/imagen4
                  description: |-
                    用于生成任务的模型名称。必填字段。

                    - 该端点必须使用 `google/imagen4` 模型
                  examples:
                    - google/imagen4
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
                    prompt:
                      description: 用于描述生成图像内容的文本提示词（最大长度：5000 字符）
                      type: string
                      maxLength: 5000
                      examples:
                        - >-
                          一幅生动的漫画场景，画面设定在办公室内，两名同事正在对话。第一个人问道：“你听说过 Google
                          Imagen 4 Ultra
                          吗？”第二个人兴奋地回应：“这是目前最好的文生图工具！”第一个人又问：“你知道哪里能获取这个 API
                          吗？”第二个人笑着说：“Kie.ai 上就有！”最后一个画面格中，两人正看着屏幕，屏幕上显示 Kie.ai
                          的界面，带有 API 选项，整体采用色彩鲜艳明快的漫画风格绘制。
                    negative_prompt:
                      description: 用于描述生成图像中需要规避的元素的文本（最大长度：5000 字符）
                      type: string
                      maxLength: 5000
                      examples:
                        - ''
                    aspect_ratio:
                      type: string
                      description: 生成图像的宽高比
                      enum:
                        - '1:1'
                        - '16:9'
                        - '9:16'
                        - '3:4'
                        - '4:3'
                        - auto
                      default: '1:1'
                      examples:
                        - '1:1'
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
                        - value: '3:4'
                          name: ''
                          description: ''
                        - value: '4:3'
                          name: ''
                          description: ''
                        - value: auto
                          name: ''
                          description: ''
                    seed:
                      description: 用于生成结果可复现的随机种子值（最大长度：500 字符）
                      type: string
                      maxLength: 500
                      examples:
                        - ''
                  required:
                    - prompt
                  x-apidog-orders:
                    - prompt
                    - negative_prompt
                    - aspect_ratio
                    - seed
                  x-apidog-ignore-properties: []
              x-apidog-orders:
                - model
                - callBackUrl
                - input
              x-apidog-ignore-properties: []
            example:
              model: google/imagen4
              callBackUrl: https://your-domain.com/api/callback
              input:
                prompt: >-
                  一幅生动的漫画场景，画面设定在办公室内，两名同事正在对话。第一个人问道：“你听说过 Google Imagen 4
                  Ultra 吗？”第二个人兴奋地回应：“这是目前最好的文生图工具！”第一个人又问：“你知道哪里能获取这个 API
                  吗？”第二个人笑着说：“Kie.ai 上就有！”最后一个画面格中，两人正看着屏幕，屏幕上显示 Kie.ai 的界面，带有
                  API 选项，整体采用色彩鲜艳明快的漫画风格绘制。
                negative_prompt: ''
                aspect_ratio: '1:1'
                seed: ''
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
                  taskId: task_google_1765172350621
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
      x-apidog-folder: docs/zh-CN/Market/Image    Models/Google
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-28506633-run
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
