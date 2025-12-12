# API 鉴权方式

PPIO 派欧云平台 API 使用请求头中的 `Authorization` 字段携带 API 密钥进行身份认证。您可以在 [API 密钥管理页面](https://ppio.com/settings/key-management) 查看和管理您的 API 密钥。

在请求头中添加以下字段：

```json
{
  "Authorization": "Bearer {{API 密钥}}"
}
```

> 有关 API 错误码的说明，请参阅 [API 错误码说明](/docs/models/reference-error-code)。