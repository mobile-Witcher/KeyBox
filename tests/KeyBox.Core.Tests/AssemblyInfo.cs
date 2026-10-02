using Xunit;

// MasterKeySession 是进程级单例（解锁后写、测试间 Clear），
// 多个测试类并行时会互相覆盖导致偶发失败 → 关闭测试类并行（串行执行）。
[assembly: CollectionBehavior(DisableTestParallelization = true)]
