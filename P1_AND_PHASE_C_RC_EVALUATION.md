# P1功能状态与Phase C/RC启动评估

## P1功能实施状态

### ✅ 已完成 (1/6)
1. **G2.5: governance evidence --all** 
   - 批量导出功能完整实现
   - 已测试并提交

### 📋 待实现 (5/6) - 建议优先级

#### 高优先级 (2个) - 用户可见功能
1. **M4: maintenance upgrade-preview CLI**
   - 影响: 用户无法从CLI调用upgrade-preview
   - 工作量: 5分钟
   - 风险: 低
   - **建议: 立即实现**

2. **E1.5: execution validate-integration --explain**
   - 影响: 验证失败时缺少详细说明
   - 工作量: 10分钟
   - 风险: 低
   - **建议: 立即实现**

#### 中优先级 (3个) - 增强功能
3. **M2.5: maintenance wiki-lint --fix-markers**
   - 影响: 需手动修复wiki链接
   - 工作量: 10分钟
   - 风险: 中 (可能误修复)
   - **建议: 下一迭代**

4. **E4.6: execution readiness --strict**
   - 影响: 缺少严格检查模式
   - 工作量: 10分钟
   - 风险: 低
   - **建议: 下一迭代**

5. **M7.5: maintenance propose --priority**
   - 影响: 无法按优先级过滤建议
   - 工作量: 10分钟
   - 风险: 低
   - **建议: 下一迭代**

## Phase C/RC 启动条件评估

### Phase C: Web Viewer

**设计文档:** `docs/superpowers/plans/2026-06-10-phase-c-web-viewer.md`

**前置条件检查:**
```
✅ Phase B Alpha完成 (Session/Route/Execution引擎)
✅ Phase B Beta完成 (Autonomous/Daemon/Notifications)
✅ Timeline事件流存在 (.amber/sessions/*/timeline.jsonl)
✅ 测试覆盖完整 (514/514通过)
⚠️ 治理P1功能 (1/6完成,但不阻塞Web UI)
```

**结论: 可以启动Phase C** ✅

Phase C是独立的Web界面层,不依赖剩余P1功能。

### Phase B RC: Integration Testing

**设计文档:** `docs/superpowers/plans/2026-06-10-phase-b-rc-integration-testing.md`

**前置条件检查:**
```
✅ Phase B Alpha完成
✅ Phase B Beta完成
✅ 核心功能完整
⚠️ 用户文档完整 (刚完成)
⚠️ 治理功能大部分完成 (5个P1待实现)
```

**结论: 可以启动Phase B RC** ✅

RC阶段主要是集成测试和Beta用户反馈,P1功能可并行实现。

## 推荐策略

### 方案A: 快速修复高优P1 + 启动Phase C (推荐)

**优势:**
- 15分钟完成M4和E1.5
- Phase C独立开发,不受P1影响
- 并行推进两条线

**时间线:**
```
Day 1 上午: 实现M4 + E1.5 (15分钟)
Day 1-14:   Phase C Week 1-2 (Web Viewer基础)
Day 15:     回来完成剩余3个P1
```

### 方案B: 完成全部P1 + 启动Phase B RC

**优势:**
- Phase 2/3/4完全完成
- 治理功能100%
- 更稳固的基础

**时间线:**
```
Day 1:      完成5个P1 (45分钟)
Day 2-14:   Phase B RC集成测试
```

### 方案C: 并行全部 (最激进)

**使用多个Agent并行:**
- Agent 1: 完成5个P1功能
- Agent 2: 启动Phase C Week 1
- Agent 3: 启动Phase B RC Week 10

**优势:** 最快进度
**风险:** 需要协调和合并

## Phase C 概览

**目标:** 只读Web Viewer for session timelines

**架构:**
- Next.js 14 + tRPC
- 读取 `.amber/sessions/` JSONL
- 实时监控运行中的sessions
- 时间线可视化

**Week C1-C2 (2周):**
- Session列表页面
- Timeline viewer基础
- 事件流解析器

**不依赖P1功能** ✅

## Phase B RC 概览

**目标:** 集成测试 + Beta用户程序

**Week 10-11 内容:**
- E2E测试套件扩展
- Beta用户招募
- 反馈收集机制
- Bug修复优先级

**P1功能可并行进行** ✅

## 建议决策

**我的推荐: 方案A**

1. **现在 (15分钟):** 实现M4 + E1.5
2. **接下来:** 启动Phase C (Web Viewer)
3. **并行:** 剩余3个P1可以在Phase C开发期间完成

**理由:**
- Phase C是新功能,最有价值
- Web UI增强用户体验
- P1功能不阻塞Phase C
- 15分钟即可解决最影响用户的2个P1

你想要哪个方案?
