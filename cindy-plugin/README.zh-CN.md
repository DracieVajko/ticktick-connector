# TickTick for Cindy

在 Cindy 中管理 TickTick 的任务、清单、标签和评论。

## 设置

1. 在 Cindy 中打开本插件设置。
2. 打开 TickTick 登录链接，在浏览器中授权。
3. 浏览器随后会跳到 `127.0.0.1` 并显示“无法访问”，这是正常的：复制整条地址粘回插件设置并保存。

不需要手动复制 API 令牌，重启也不会失效。插件自己完成授权码交换，把访问令牌交给 Cindy 的加密保险库，由主机在每次请求时注入。TickTick 不发放刷新令牌，因此设置页会显示令牌的到期时间（约 180 天），到期后按提示重新授权即可。

## 试试

```text
$ticktick 列出我未完成的任务
$ticktick 在“工作”清单里新建任务“发送季度报告”，周五截止，高优先级
$ticktick 这周有什么到期？
$ticktick 把“发送季度报告”标记为完成
```

也可以直接用自然语言提到 TickTick、任务、清单、标签、截止日期或日程。

## 说明

- 任务和清单 ID 来自列表工具；助手会先把名称解析成 ID 再写入。
- `list_projects` 会把收集箱作为 `projectId: "inbox"` 返回。
- 日期支持 `YYYY-MM-DD` 或 ISO 8601。
- 删除任务、清单或评论需要明确确认。
- v1 覆盖任务、清单、标签和评论；暂不含习惯、专注和倒计时。

本插件与 TickTick 官方无关。TickTick 及其图标归其所有者所有；图标来自 TickTick 官网。

完整文档、Claude/Codex/Cursor 的 MCP 配置和源码：[github.com/DracieVajko/ticktick-connector](https://github.com/DracieVajko/ticktick-connector)。
