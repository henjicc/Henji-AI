# Kling V2.1 Standard

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
      summary: Kling V2.1 Standard
      deprecated: false
      description: >-
        ## 查询任务状态


        提交任务后，可通过统一的查询接口查看任务进度并获取结果：


        <Card title="Get Task Details" icon="magnifying-glass"
        href="/cn/market/common/get-task-detail">
          了解如何查询任务状态并获取生成结果
        </Card>


        ::: tip[]

        生产环境中，建议使用 `callBackUrl` 参数接收生成完成的自动通知，而非轮询状态接口。

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
      operationId: kling-v2-1-standard
      tags:
        - docs/zh-CN/Market/Video Models/Kling
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
                    - kling/v2-1-standard
                  default: kling/v2-1-standard
                  description: |-
                    用于生成任务的模型名称。必填字段。

                    - 该接口必须使用 `kling/v2-1-standard` 模型
                  examples:
                    - kling/v2-1-standard
                callBackUrl:
                  type: string
                  format: uri
                  description: |-
                    接收生成任务完成通知的回调 URL。可选配置，生产环境建议使用。

                    - 任务生成完成后，系统会向该 URL 以 POST 方式推送任务状态和结果
                    - 回调内容包含生成内容的 URL 及任务相关信息
                    - 你的回调接口需支持接收 POST 请求及 JSON 格式的请求体
                    - 也可选择调用任务详情接口，主动轮询任务状态
                  examples:
                    - https://your-domain.com/api/callback
                input:
                  type: object
                  description: 生成任务的输入参数
                  properties:
                    prompt:
                      description: 描述期望生成视频内容的文本提示词（最大长度：5000 字符）
                      type: string
                      maxLength: 5000
                      examples:
                        - >-
                          以上传的图片作为视频首帧。逐步让场景动起来：蒸汽从火车中升腾并向上飘散；灯笼灯光微微闪烁；身披斗篷的人物开始缓慢移动——行走、转身、整理随身物品。漂浮的尘埃或魔法粒子在光线下显现。文字“KLING
                          2.1 STANDARD API — Now on
                          Kie.ai”泛着金色光芒柔和闪烁。镜头微微前推，随后缓缓淡出至黑屏。
                    image_url:
                      description: >-
                        用于生成视频的图片 URL（需为上传后的文件
                        URL，而非文件内容；支持的格式：image/jpeg、image/png；最大文件大小：10.0MB）
                      type: string
                      examples:
                        - >-
                          https://file.aiquickdraw.com/custom-page/akr/section-images/1755256596169mkkwr2ag.webp
                    duration:
                      description: 生成视频的时长（单位：秒）
                      type: string
                      enum:
                        - '5'
                        - '10'
                      default: '5'
                      examples:
                        - '5'
                    negative_prompt:
                      description: 生成视频中需要规避的元素描述（最大长度：500 字符）
                      type: string
                      maxLength: 500
                      examples:
                        - 模糊、畸变、低画质
                    cfg_scale:
                      description: CFG（无分类器引导）系数，用于控制模型贴合提示词的程度（最小值：0，最大值：1，步长：0.1）
                      type: number
                      minimum: 0
                      maximum: 1
                      default: 0.5
                      examples:
                        - 0.5
                  required:
                    - prompt
                    - image_url
                  x-apidog-orders:
                    - prompt
                    - image_url
                    - duration
                    - negative_prompt
                    - cfg_scale
                  x-apidog-ignore-properties: []
              x-apidog-orders:
                - model
                - callBackUrl
                - input
              x-apidog-ignore-properties: []
            example:
              model: kling/v2-1-standard
              callBackUrl: https://your-domain.com/api/callback
              input:
                prompt: >-
                  以上传的图片作为视频首帧。逐步让场景动起来：蒸汽从火车中升腾并向上飘散；灯笼灯光微微闪烁；身披斗篷的人物开始缓慢移动——行走、转身、整理随身物品。漂浮的尘埃或魔法粒子在光线下显现。文字“KLING
                  2.1 STANDARD API — Now on Kie.ai”泛着金色光芒柔和闪烁。镜头微微前推，随后缓缓淡出至黑屏。
                image_url: >-
                  https://file.aiquickdraw.com/custom-page/akr/section-images/1755256596169mkkwr2ag.png
                duration: '5'
                negative_prompt: 模糊、畸变、低画质
                cfg_scale: 0.5
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
                  taskId: task_kling_1765187766581
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
      x-apidog-folder: docs/zh-CN/Market/Video Models/Kling
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-28506667-run
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
