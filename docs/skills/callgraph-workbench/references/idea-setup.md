# IDEA 本机协议关联（Windows）

平台选择 IDEA 后生成 `idea://open?file=<编码后的绝对路径>&line=<行>&column=<列>`。
Windows 必须知道谁处理该协议。平台支持、系统注册、浏览器允许、IDEA 实际定位是四个不同环节。
只查询使用方法时不要修改注册表；用户要求配置跳转时可完成当前用户关联，无需重复请求同一授权。

## 检查

```powershell
Test-Path Registry::HKEY_CLASSES_ROOT\idea
if (Test-Path Registry::HKEY_CLASSES_ROOT\idea\shell\open\command) {
  (Get-Item Registry::HKEY_CLASSES_ROOT\idea\shell\open\command).GetValue('')
}
Get-Process idea64 -ErrorAction SilentlyContinue | Select-Object Path
```

检查启动命令引用的程序是否存在。优先复用有效关联，不覆盖用户已有配置。
通过运行进程、卸载信息、JetBrains/Toolbox 安装目录寻找 `idea64.exe`；按需缩小文件搜索范围。
读取安装根目录 `product-info.json` 确认真实版本，安装文件夹名称可能没有随升级变化。

## 配置原则

若已有原生处理器，使用其支持的方式。没有时，可安装一个当前用户的 URL 到 CLI 转换脚本：

- 放在稳定的本机应用数据目录，例如 `%LOCALAPPDATA%\CallgraphVisualizer\Open-IdeaLink.ps1`，不放临时目录。
- 校验 scheme/host 为 `idea`/`open`，只接受 file、line、column，拒绝重复、未知参数和无效位置。
- URL 解码文件路径，验证为存在的本地绝对文件；当前本机脚本不支持 UNC 网络路径。
- 使用明确定位的 IDEA 可执行文件，以独立参数传递 `--line`、`--column`、文件路径。不能把 URL 拼成可执行 Shell 代码或使用 Invoke-Expression。
- 提供仅解析的 `-ValidateOnly` 模式，方便先验证而不打开编辑器。
- 注册 `HKCU:\Software\Classes\idea`，默认值为协议说明，添加空字符串 `URL Protocol`。
- `shell\open\command` 指向隐藏窗口的 PowerShell，使用 `-NoProfile -File "<处理脚本>" -Link "%1"`；脚本路径和 `%1` 都加引号。不要把整个 URL 直接传给 IDEA 当文件名。
- 只改当前用户关联，不需要管理员权限。替换已有配置前保留原值，避免破坏其他安装的处理器。

本机已配置的实例（使用前仍须核实）：

| 项目 | 位置/说明 |
| --- | --- |
| 处理脚本 | `%LOCALAPPDATA%\CallgraphVisualizer\Open-IdeaLink.ps1` |
| 注册位置 | `HKCU:\Software\Classes\idea\shell\open\command` |
| IDEA | `D:\JetBrains\IntelliJ IDEA Community Edition 2024.3.1.1\bin\idea64.exe`；配置时 product-info.json 为 2025.3.2 |
| 错误记录 | 脚本同目录 `last-error.txt`；注意修改时间，历史错误不代表本次失败 |

这些路径不是跨机器默认值。迁移或升级导致路径失效时，重新定位安装并更新处理脚本。

## 验证

用用户授权范围内的一个源码文件，构造真实链接：

```powershell
$sourceFile = 'E:\projects\callgraph-visualizer\src\navigation.rs'
$link = 'idea://open?file=' + [Uri]::EscapeDataString($sourceFile) + '&line=22&column=1'
$handler = Join-Path $env:LOCALAPPDATA 'CallgraphVisualizer\Open-IdeaLink.ps1'
& powershell.exe -NoProfile -File $handler -Link $link -ValidateOnly
if ($LASTEXITCODE -ne 0) { throw '链接解析失败，先修复处理脚本' }
Start-Process -FilePath $link
```

该文件与行号仅用于演示，验证时先确认存在。分层记录验证结果：

1. 解析得到正确路径、行列，包含空格/中文/特殊字符的路径编码不破坏参数。
2. 系统协议能够启动 IDEA，启动参数正确；不能仅因注册表存在便宣称配置成功。
3. 在平台选择 IDEA，点击“在编辑器打开”，允许浏览器的外部应用提示。
4. 实际查看 IDEA 是否打开目标文件并定位到指定行；仅观察到进程启动，不应报告已验证行号定位。

浏览器无法可靠探测外部编辑器是否成功打开。没有系统关联、浏览器拒绝唤起、IDEA 启动失败要分别排查。
配置文件与启动参数检查通过但尚未检查编辑器画面时，交付应明确这个验证边界。

参考：[JetBrains URL 定位说明](https://youtrack.jetbrains.com/projects/MPS/articles/SUPPORT-A-2159/How-to-open-a-source-file-with-line-and-column-specified-from-an-URL)、[IDEA 命令行打开文件](https://www.jetbrains.com/help/idea/opening-files-from-command-line.html)。
