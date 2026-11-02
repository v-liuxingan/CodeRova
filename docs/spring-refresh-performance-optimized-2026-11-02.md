# Spring refresh 优化后完整预算采集对照（2026-11-02）

代码提交 ce706f2；debug 构建，隔离服务和图目录。入口和文件 SHA-256 与前次相同：
AbstractApplicationContext.refresh，581 行；Spring Framework 7.0.10。
新 JDT 进程，复用已有磁盘索引；并发4、单次超时15秒、最多额外重试3次。
沿用页面 HTTP 草稿流程，预算1000、不加额外排除、不限制CLI层数。
“完整”指执行完整轮预算测试，不能解释为调用链已经全部收敛。

| 指标 | 旧版 | 本轮 |
| --- | ---: | ---: |
| 全流程墙钟秒 | 1137.948 | 417.167 |
| 首次入口校验秒 | 37.302 | 4.630 |
| 额外热校验秒 | 1.565 | 1.141 |
| 采集阶段墙钟秒 | 1098.283 | 410.797 |
| 后端内部采集秒 | 1097.515 | 409.948 |
| 校验累计秒 | 46.258 | 51.788 |
| 检查点累计秒 | 77.749 | 5.714 |
| 节点 | 2595 | 2625 |
| 边 | 3786 | 3800 |
| queriedNodes | 998 | 992 |
| pendingNodes | 1597 | 1633 |

总耗时减少63.3%，约2.73倍；采集阶段减少62.6%。检查点减少92.7%，校验仍很重。
本轮1000个完成结果形成969批，最大批3个，只省31次结果检查点；主要收益不能全归于批处理。
RPC累计：outgoingCalls 1021次/900.196秒（含重试），implementation 607次/266.867秒，
prepare 2737次/10.222秒，documentSymbol 796次/7.871秒。共52次重试。
并发后RPC累计等待可大于墙钟时间，不应相加计算阶段占比或称服务器计算减少。

## 质量与比较限制

- 独立校验 valid=true，0错误、0警告；源码位置校验不证明语义完整。
- 新旧共享2584节点、3751边；旧版独有11节点35边，新版独有41节点49边。
  遍历顺序、失败处理和限时不同，两次预算选点并非完全相同。
- 107条issue中91条预算说明；16条其他问题对应8个未完整处理节点。
- 保留2个JDT排序异常；ReflectionUtils两个回调方法的实现定位失败逐项报告，
  已成功实现保留，不误判剩余实现为唯一实现。
- 两个出向查询最终超时：ConcurrentReferenceHashMap.Reference.get、Expression.getValue。
- BeanUtils.instantiateClass出现身份校验拒绝；getObjectForBeanInstance出现调用范围拒绝。
  可能与服务器共享状态、索引或并发有关，目前只有拒绝日志，没有线程级归因证据。
  这些节点保持未完成，未采纳可疑调用，不应声称质量完全不受影响。
- 旧版998与本轮992 queried 的口径也受完整性判断修复影响，不能用新增节点数证明覆盖率提高。
- 首次入口更快可能受磁盘/OS缓存变化影响；只有单次前后实验，无稳定百分位或纯变量控制。

## 结论

整体等待明显降低，当前瓶颈仍是服务器慢查询与重复校验。更短超时会截断部分慢分支；
后续应优先定位并发下身份/调用范围问题、量化校验开销，并在同一选点集合上补充对照，
不能只追求更大并发或更少耗时。

原始证据：target/spring-refresh-optimized-20261102/ 内 run.py、lsp.json、server.log、
metrics.json、summary.json、issues-summary.json、validation.json、spring-refresh-lsp.json。
未覆盖用户图，结果为独立导出；隔离服务与其进程树已由脚本结束。


## 后续定向排查

分别以 BeanUtils.instantiateClass（131行）和 AbstractAutowireCapableBeanFactory.
getObjectForBeanInstance（1292行）作为入口，独立 JDT 进程、查询预算1、展示采集深度1，
均成功解析出向调用。该实验不包含原并发上下文，不能据此认定问题已修复。
证据 target/spring-identity-investigation-diagnostics/。

新增诊断记录声明身份的 expected/actual 名称、URI、selectionRange，以及越界调用的
声明范围和调用点范围，不记录整个 opaque data。现有拒绝策略保持，尚未确认是
服务器共享状态、并发还是上下文相关语义解析造成。

公共校验优化：成功读取文件时避免先调用 is_file；失败才补查存在状态，保留文件缺失、
目录和非法UTF-8诊断。Spring图完整校验输出前后一致。5次CLI计时中位数约0.222→0.214秒，
新版本首轮0.836秒有明显离群，样本不足以证明稳定提速，不能推算整轮节省。
证据 target/validation-read-first/。这是文件系统访问优化，不是LSP协议特性。
