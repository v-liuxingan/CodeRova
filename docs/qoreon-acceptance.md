# Qoreon 网络恢复验收

目标：让不熟悉 Qoreon 的开发者理解 CLI 网络故障后发生了什么，并定位源码依据。
固定源码基线为 afaf671f7243dd7453e6826f567e445385d57a2a。本轮在本机 qoreon 工作区核对，
所引 server.py 和三个 runtime 文件与该提交一致；没有修改 Qoreon 的代码或配置。

## 阅读材料

- [独立场景](http://127.0.0.1:4321/scenes/qoreon-network-recovery.html)：角色、重试循环、
  分支与异步调度，关键消息可跳转本页依据。
- [调用图](http://127.0.0.1:4321/?graph=qoreon-network-recovery)：11 个真实函数/方法及
  11 个精确调用点，通过源码工作台核对。
- 输入：scenes/qoreon-network-recovery.mmd 与同名 JSON，graphs/recovery/qoreon-network-recovery.json。
- 指纹：evidence/baselines/qoreon.json，覆盖 32 个引用（含图和场景各自独立的引用）。

边界从 CLI 非零退出后的网络路径开始，到即时成功、停止重试或建立新恢复 run 为止。
正常启动、超时/用户中断、profile 缺失降级、恢复 run 后续执行结果未展开，不能由图推断。
调用图节点数不是验收指标；循环位于 run_cli_exec 内，不为展示而制造循环函数。

## 固定事实清单（评估者使用）

| 维度 | 必须解释的事实 | 核对位置 |
| --- | --- | --- |
| 目标与边界 | 处理失败、尝试恢复；已调度不代表完成，后续 run 结果在范围外 | execution_runtime.py:719–883 |
| 顺序 | 分类 → 即时退避重试 → 失败汇总 → 条件满足时创建新 run → 保存等待状态 → 注册调度 | execution_runtime.py:774–879、335–387 |
| 分支/循环/异步 | 认证错误阻止网络恢复；成功、认证、非网络或超时会退出即时循环；调度器与后台线程是替代路径 | execution_runtime.py:778–829、383–386 |
| 状态变化 | 原 run 仍为 error，新 run 为 retry_waiting；retryOf 和 networkResumeRunId 连接二者；autoResumePrompt 防止继续派生 | network_recovery.py:8–41、execution_runtime.py:342–351 |
| 源码证据 | 能从图定位对应函数或调用点，并解释代码如何支撑自己的判断 | 场景依据表与调用图源码工作台 |

上表 runtime 文件均位于 task_dashboard/runtime/。补充检查两个常见误读：

- network_retry_max=0 关闭即时重试，但仍可能创建延迟恢复 run（execution_runtime.py:851–869）。
- autoResumePrompt 防止新恢复 run 再派生，不禁止它内部即时重试。

## 自动验收

```powershell
npm run check:content -- --project qoreon
python -X utf8 tests/qoreon_acceptance.py
python -X utf8 tests/run_e2e.py
```

源码验收脚本从 Qoreon 原文件提取选定函数，在隔离的存储和调度替身中执行：认证/网络分类、
失败与等待分离、ID/自动恢复门禁、调度器禁用降级。不运行 Qoreon 服务、真实 CLI、会话、
定时器或消息派发；不宣称进行了整个 Qoreon 的端到端运行测试。
可视化 E2E 检查桌面/窄屏完整渲染、证据锚点跳转、进入 Qoreon 调用图和真实源码预览。
源码位置、锚点、指纹匹配只验证对应范围，业务结论来自本次源码核对。

## 十分钟理解测试

给未读过该流程的测试者同一入口和说明：“请解释一次网络失败后的恢复过程，并用源码
证明关键判断。”开始计时后只使用工作台，在十分钟内完成说明与源码定位；可以边读边
解释，不考机械记忆。到时记录当前答案，保持版本、材料、计时和提问一致。

按产品战略的五个维度各打 0–2 分。8/10 且源码证据得 2 分才通过；同时记录首次定位
证据用时、错误推断和无效往返。正式基线至少需要 5 名符合条件的测试者。

| 测试者 | 目标 | 顺序 | 控制流 | 状态 | 证据 | 首次证据用时 | 错误推断 / 迷失 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 待开展 | — | — | — | — | — | — | — |

本轮完成自动和源码验收，尚无真人测试数据；完成率基线和 80% 战略目标均未宣称达成。
下一轮应依据真实复述中的错误调整内容或阅读交互。

2026-09-06 自动验收结果：统一检查覆盖 16 张调用图、3 张场景、671 个源码位置，Qoreon
32 个指纹匹配；历史两个项目未建指纹基线的警告保留。npm ci、正式/Atlas 构建、完整
前端 E2E、Atlas 冒烟、Qoreon 隔离源码验收，以及 Rust 格式、42 项测试和 Clippy 通过。
既有 E2E 截图恢复到本轮前状态，避免把环境产生的图像差异混入功能改动。
