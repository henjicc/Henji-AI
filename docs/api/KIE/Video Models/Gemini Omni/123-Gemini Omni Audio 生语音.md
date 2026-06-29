# Gemini Omni Audio 生语音

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /api/v1/omni/audio/create:
    post:
      summary: Gemini Omni Audio 生语音
      deprecated: false
      description: |-
        ## 创建任务

        调用该接口可创建一个新的语音

        ## 相关资源

        <CardGroup cols={2}>
          <Card title="模型市场" icon="lucide-store" href="/market/quickstart">
            浏览全部可用模型与能力
          </Card>
          <Card title="通用 API" icon="lucide-cog" href="/common-api/get-account-credits">
            查看账户积分与调用情况
          </Card>
        </CardGroup>
      operationId: gemini-omni-audio-zh
      tags:
        - docs/zh-CN/Market/Video Models/Gemini Omni
      parameters: []
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required:
                - audio_id
                - name
              properties:
                audio_id:
                  type: string
                  description: |-
                    枚举语音ID，用于选择预设语音角色。
                     achernar - 女声，柔和，高音调 
                     achird - 男声，友好，中音调 
                     
                      algenib - 男声，沙哑，低音调 
                     algieba - 男声，随和，中低音调 
                     alnilam - 男声，沉稳，中低音调 
                     aoede - 女声，轻快，中音调 
                     autonoe - 女声，明亮，中音调 
                     callirrhoe - 女声，随和，中音调 
                     charon - 男声，知性，低音调 
                     
                      despina - 女声，流畅，中音调 
                     enceladus - 男声，气声，低音调 
                     erinome - 女声，清晰，中音调 
                     fenrir -  男声，活泼，偏年轻音调 
                     gacrux - 女声，成熟，中音调 
                     iapetus - 男声，清晰，中低音调 
                     kore - 女声，干练，中音调 
                      laomedeia - 女声，欢快，中高音调 
                     leda - 女声，年轻，中高音调 
                     orus - 男声，沉稳，中低音调 
                     puck - 男声，欢快，中音调 
                     pulcherrima - 无性别，前置感，中高音调 
                     rasalgethi - 男声，知性，中音调 
                     sadachbia -  男声，生动，低音调 
                     sadaltager - 男声，博学，中音调 
                     schedar - 男声，平稳，中低音调 
                     sulafat - 女声，温暖，中音调
                      
                     umbriel - 男声，流畅，低音调 
                     vindemiatrix - 女声，温柔，中音调 
                     zephyr - 女声，明亮，中高音调 
                     zubenelgenubi -   男声，随性，中低音调
                  examples:
                    - achernar
                    - achird
                    - algenib
                    - algieba
                    - alnilam
                    - aoede
                    - autonoe
                    - callirrhoe
                    - charon
                    - despina
                    - enceladus
                    - erinome
                    - fenrir
                    - gacrux
                    - iapetus
                    - kore
                    - laomedeia
                    - leda
                    - orus
                    - puck
                    - pulcherrima
                    - rasalgethi
                    - sadachbia
                    - sadaltager
                    - schedar
                    - sulafat
                    - umbriel
                    - vindemiatrix
                    - zephyr
                    - zubenelgenubi
                name:
                  type: string
                  maxLength: 210
                  description: 语音名称，最大长度为 `210` 字符。
                  examples:
                    - Adam Narrator
                voice_description:
                  type: string
                  maxLength: 20000
                  description: 语音特征描述，用于定义声音的音色、风格、语速、情绪等，最大长度为 `20000` 字符。
                  examples:
                    - 一个沉稳、清晰、富有亲和力的男性声音，适合科技产品讲解与日常对话。
                example_dialogue:
                  type: string
                  maxLength: 120
                  description: 对话示例，例如“你好,我是Adam”，最大长度为 `120` 字符。
                  examples:
                    - 你好,我是Adam
              x-apidog-orders:
                - audio_id
                - name
                - voice_description
                - example_dialogue
            example:
              audio_id: achernar
              name: achernar Narrator
              voice_description: 一个沉稳、清晰、富有亲和力的男性声音，适合科技产品讲解与日常对话。
              example_dialogue: 你好,我是achernar
      responses:
        '200':
          description: 请求成功
          content:
            application/json:
              schema:
                allOf:
                  - type: object
                    properties:
                      data:
                        type: object
                        properties:
                          kieAudioId:
                            type: string
                          name:
                            type: string
                        x-apidog-orders:
                          - kieAudioId
                          - name
                      msg:
                        type: string
                    x-apidog-orders:
                      - data
                      - msg
              example:
                code: 200
                msg: success
                data:
                  kieAudioId: a8f1c2d3e4f5...
                  name: 温柔女声
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
      x-apidog-folder: docs/zh-CN/Market/Video Models/Gemini Omni
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-36214043-run
components:
  schemas: {}
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
