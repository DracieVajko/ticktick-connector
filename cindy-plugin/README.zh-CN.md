# TickTick for Cindy

在 Cindy 中管理 TickTick 的任务、清单、标签和评论。

## 设置

1. 在 Cindy 中打开本插件设置。
2. 点击 **Connect TickTick**。
3. 在浏览器中登录 TickTick 并授权。

不需要复制 API 令牌。Cindy 会把 OAuth 令牌保存在加密保险库中，并自动刷新。

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
