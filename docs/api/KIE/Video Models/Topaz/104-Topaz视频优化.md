# Topaz视频优化

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
      summary: Topaz视频优化
      deprecated: false
      description: >-
        ## 查询任务状态


        提交任务后，可通过统一的查询接口查看任务进度并获取结果：


        <Card title="Get Task Details" icon="magnifying-glass"
        href="/cn/market/common/get-task-detail">
          了解如何查询任务状态并获取处理结果
        </Card>


        ::: tip[]

        生产环境中，建议使用 `callBackUrl` 参数接收处理完成的自动通知，而非轮询状态接口。

        :::


        ## 相关资源


        <CardGroup cols={2}>
          <Card title="Market Overview" icon="store" href="/cn/market/quickstart">
            浏览所有可用模型
          </Card>
          <Card title="Common API" icon="gear" href="/cn/common-api/get-account-credits">
            查看账户积分与使用情况
          </Card>
        </CardGroup>
      operationId: topaz-video-upscale
      tags:
        - docs/zh-CN/Market/Video Models/Topaz
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
                    - topaz/video-upscale
                  default: topaz/video-upscale
                  description: |-
                    用于处理任务的模型名称。必填字段。

                    - 该接口必须使用 `topaz/video-upscale` 模型
                  examples:
                    - topaz/video-upscale
                callBackUrl:
                  type: string
                  format: uri
                  description: >-
                    接收处理任务完成通知的回调 URL。可选配置，生产环境建议使用。


                    - 任务处理完成后，系统会向该 URL 以 POST 方式推送任务状态和结果

                    - 回调内容包含处理后内容的 URL 及任务相关信息

                    - 你的回调接口需支持接收 POST 请求及 JSON 格式的请求体

                    - 也可选择调用任务详情接口，主动轮询任务状态

                    - 为确保回调安全性，请参阅 [Webhook
                    校验指南](/cn/common-api/webhook-verification) 了解签名验证实现方法
                  examples:
                    - https://your-domain.com/api/callback
                input:
                  type: object
                  description: 处理任务的输入参数
                  properties:
                    video_url:
                      description: >-
                        待超分放大的视频 URL（需为上传后的文件
                        URL，而非文件内容；支持的格式：video/mp4、video/quicktime、video/x-matroska；最大文件大小：50.0MB）
                      type: string
                      examples:
                        - >-
                          https://file.aiquickdraw.com/custom-page/akr/section-images/1758166466095hvbwkrpw.mp4
                    upscale_factor:
                      description: 视频超分放大倍数（例如：2.0 表示将视频宽度和高度放大至原尺寸的 2 倍）
                      type: string
                      enum:
                        - '1'
                        - '2'
                        - '4'
                      default: '2'
                      examples:
                        - '2'
                  required:
                    - video_url
                  x-apidog-orders:
                    - video_url
                    - upscale_factor
                  x-apidog-ignore-properties: []
              x-apidog-orders:
                - model
                - callBackUrl
                - input
              x-apidog-ignore-properties: []
            example:
              model: topaz/video-upscale
              callBackUrl: https://your-domain.com/api/callback
              input:
                video_url: >-
                  https://file.aiquickdraw.com/custom-page/akr/section-images/1758166466095hvbwkrpw.mp4
                upscale_factor: '2'
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
                  taskId: task_topaz_1765185786549
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
      x-apidog-folder: docs/zh-CN/Market/Video Models/Topaz
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-28506697-run
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
