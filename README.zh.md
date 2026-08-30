# dsh-win-toolkit

**面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) 的 Windows 原生能力包。**

给 dsh 里的 agent 装上真正的 Windows 技能——剪贴板、系统通知、hosts 文件查看、网络诊断，全部通过安全参数化的 PowerShell 实现。无需额外安装，当前工具集无需管理员权限。

> English docs: [README.md](README.md).

## 工具

| 工具 | 功能 |
|---|---|
| `win_clipboard_read` | 读取剪贴板文本 |
| `win_clipboard_write` | 写入剪贴板 |
| `win_notify` | 系统弹窗通知（自动关闭） |
| `win_hosts_list` | 查看 Windows hosts 文件 |
| `win_netdiag` | 任意主机的 DNS 解析 + TCP 端口测试 |

## 安装

```sh
dsh plugin --profile web add dsh-win-toolkit
dsh web   # 重启
```

装完直接问 agent，例如：
- 「检查 github.com:443 通不通」→ `win_netdiag`
- 「把这句放到剪贴板」→ `win_clipboard_write`
- 「完成时通知我」→ `win_notify`

## 工作原理

每个工具通过 `powershell.exe -NoProfile -NonInteractive` 执行一段简短 PowerShell 脚本。**所有用户输入以 Base64 形式跨脚本边界**——绝不做字符串拼接，从结构上杜绝注入。

- 配置：`psTimeoutMs`（默认 20000）——单次 PowerShell 调用超时，可在 profile 的 `cordis.patch.yml` 的 `win-toolkit` 条目下设置。
- 仅 Windows：非 Windows 平台工具会明确报错（条目本身是空操作）。

## 路线图

- `win_hosts_edit`（管理员门禁的 hosts 增删）、`win_env`、`win_service`、`win_window`、`win_task`、`win_netdiag` 深度模式（代理检查、DNS 服务器、traceroute）。

## 排错

- 工具报 "PowerShell failed"：多半是杀软或执行策略问题——插件已用 `-NoProfile -NonInteractive`，但策略仍会生效。可查 `Get-ExecutionPolicy`；插件不要求 RemoteSigned。
- 想看具体执行了什么？PowerShell 片段简短可读，都在 `src/index.ts` 里。

## 链接

- npm: <https://www.npmjs.com/package/dsh-win-toolkit>
- GitHub: <https://github.com/Edge-Echo/dsh-win-toolkit>
- License: MIT
