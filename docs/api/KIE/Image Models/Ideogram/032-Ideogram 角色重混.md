# Ideogram 角色重混

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
      summary: Ideogram 角色重混
      deprecated: false
      description: >-
        基于 ideogram/character-remix 模型实现图像生成


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
      operationId: ideogram-character-remix
      tags:
        - docs/zh-CN/Market/Image    Models/Ideogram
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
                    - ideogram/character-remix
                  default: ideogram/character-remix
                  description: |-
                    用于生成任务的模型名称。必填字段。

                    - 该端点必须使用 `ideogram/character-remix` 模型
                  examples:
                    - ideogram/character-remix
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
                      description: 用于图像重混创作的文本提示词（最大长度：5000 字符）
                      type: string
                      maxLength: 5000
                      examples:
                        - >-
                          鱼眼镜头自拍照片，拍摄于夜晚的城市街道。画面为圆形，带有黑色边框，画面中人物佩戴深色墨镜、身穿黑色夹克，手持银色数码相机举到面前拍摄倒影。背景可见一排关闭的店面卷帘门，上方有红色霓虹灯光。街道空无一人、光线昏暗，路灯在人行道上投射出暖光。鱼眼效果形成弯曲的畸变视角，让街道和建筑的直线呈现弧度。画面以红色和深色调为主，营造出氛围感拉满的都市情绪。人物倒影露出深色长发，位于圆形画面正中央。背景中多扇店面卷帘门形成重复的水平线条纹理。整体构图具有电影质感，昏暗街道与上方亮灯的店面形成强烈对比。
                    image_url:
                      description: >-
                        待重混创作的基础图像 URL。（为上传后的文件
                        URL，非文件内容；支持的类型：image/jpeg、image/png、image/webp；最大文件大小：10.0MB）
                      type: string
                      examples:
                        - >-
                          https://file.aiquickdraw.com/custom-page/akr/section-images/1755768466167d0tiuc6e.webp
                    reference_image_urls:
                      description: >-
                        作为人物参考的图像集合。目前仅支持 1 张图像，其余图像将被忽略。（所有参考图像总大小不超过
                        10MB）。图像格式需为 JPEG、PNG 或 WebP（为上传后的文件
                        URL，非文件内容；支持的类型：image/jpeg、image/png、image/webp；最大文件大小：10.0MB）
                      type: array
                      items:
                        type: string
                        format: uri
                      examples:
                        - - >-
                            https://file.aiquickdraw.com/custom-page/akr/section-images/1755768479029sugx0g6f.webp
                    rendering_speed:
                      description: 渲染速度。默认值："BALANCED"
                      type: string
                      enum:
                        - TURBO
                        - BALANCED
                        - QUALITY
                      default: BALANCED
                      examples:
                        - BALANCED
                    style:
                      description: 生成图像的风格类型。不可与 style_codes 同时使用。默认值："AUTO"
                      type: string
                      enum:
                        - AUTO
                        - REALISTIC
                        - FICTION
                      default: AUTO
                      examples:
                        - AUTO
                    expand_prompt:
                      description: 是否启用 MagicPrompt 功能优化生成请求。默认值：true（布尔值：true/false）
                      type: boolean
                      examples:
                        - true
                    image_size:
                      description: 生成图像尺寸规格
                      type: string
                      enum:
                        - square
                        - square_hd
                        - portrait_4_3
                        - portrait_16_9
                        - landscape_4_3
                        - landscape_16_9
                      default: square_hd
                      examples:
                        - square_hd
                    num_images:
                      description: 生成图像数量
                      type: string
                      enum:
                        - '1'
                        - '2'
                        - '3'
                        - '4'
                      default: '1'
                      examples:
                        - '1'
                    seed:
                      description: 随机数生成器的种子值
                      type: integer
                    strength:
                      description: 基础图像在重混创作中的影响力权重。默认值：0.8（最小值：0.1，最大值：1，步长：0.1）
                      type: number
                      minimum: 0.1
                      maximum: 1
                      default: 0.8
                      examples:
                        - 0.8
                    negative_prompt:
                      description: 需从生成图像中排除的内容描述。提示词中的描述优先级高于反向提示词。默认值：""（最大长度：500 字符）
                      type: string
                      maxLength: 500
                      examples:
                        - ''
                    image_urls:
                      description: >-
                        作为风格参考的图像集合（所有风格参考图像总大小不超过 10MB）。图像格式需为 JPEG、PNG 或
                        WebP（为上传后的文件
                        URL，非文件内容；支持的类型：image/jpeg、image/png、image/webp；最大文件大小：10.0MB）
                      type: array
                      items:
                        type: string
                        format: uri
                      examples:
                        - []
                    reference_mask_urls:
                      description: >-
                        应用于人物参考图像的蒙版集合。目前仅支持 1 张蒙版，其余蒙版将被忽略。（所有人物参考蒙版总大小不超过
                        10MB）。蒙版格式需为 JPEG、PNG 或 WebP（为上传后的文件
                        URL，非文件内容；支持的类型：image/jpeg、image/png、image/webp；最大文件大小：10.0MB）
                      type: string
                      examples:
                        - ''
                  required:
                    - prompt
                    - image_url
                    - reference_image_urls
                  x-apidog-orders:
                    - prompt
                    - image_url
                    - reference_image_urls
                    - rendering_speed
                    - style
                    - expand_prompt
                    - image_size
                    - num_images
                    - seed
                    - strength
                    - negative_prompt
                    - image_urls
                    - reference_mask_urls
                  x-apidog-ignore-properties: []
              x-apidog-orders:
                - model
                - callBackUrl
                - input
              x-apidog-ignore-properties: []
            example:
              model: ideogram/character-remix
              callBackUrl: https://your-domain.com/api/callback
              input:
                prompt: >-
                  鱼眼镜头自拍照片，拍摄于夜晚的城市街道。画面为圆形，带有黑色边框，画面中人物佩戴深色墨镜、身穿黑色夹克，手持银色数码相机举到面前拍摄倒影。背景可见一排关闭的店面卷帘门，上方有红色霓虹灯光。街道空无一人、光线昏暗，路灯在人行道上投射出暖光。鱼眼效果形成弯曲的畸变视角，让街道和建筑的直线呈现弧度。画面以红色和深色调为主，营造出氛围感拉满的都市情绪。人物倒影露出深色长发，位于圆形画面正中央。背景中多扇店面卷帘门形成重复的水平线条纹理。整体构图具有电影质感，昏暗街道与上方亮灯的店面形成强烈对比。
                image_url: >-
                  https://file.aiquickdraw.com/custom-page/akr/section-images/1755768466167d0tiuc6e.webp
                reference_image_urls:
                  - >-
                    https://file.aiquickdraw.com/custom-page/akr/section-images/1755768479029sugx0g6f.webp
                rendering_speed: BALANCED
                style: AUTO
                expand_prompt: true
                image_size: square_hd
                num_images: '1'
                strength: 0.8
                negative_prompt: ''
                image_urls: []
                reference_mask_urls: ''
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
                  taskId: task_ideogram_1765179916266
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
      x-apidog-folder: docs/zh-CN/Market/Image    Models/Ideogram
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-28506651-run
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
