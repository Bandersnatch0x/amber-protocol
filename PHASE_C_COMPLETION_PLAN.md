# Phase C Weeks 4-8 实施状态与建议

## 当前状态 (2026-06-12)

### ✅ 已完成并合并
- **Week C1:** Session Viewer基础 ✅
- **Week C2:** Routes + Theme + Timeline增强 ✅  
- **Week C3:** Real-time & Controls ✅ (刚刚合并)

### 🟡 部分完成 (在worktree分支中)
- **Week C4:** 实现了错误功能(Gates而非Performance)
- **Week C5:** 代码存在于C4分支中,需提取
- **Week C6:** 实现完成,未提交
- **Week C7:** 实现了错误内容(Deployment而非E2E)
- **Week C8:** 实现完成,未提交

---

## 建议的完成路径

### 方案A: 快速完成 (推荐)

**目标:** 3-4天内完成所有剩余weeks

**Week C4: Performance & Polish (4小时)**
```typescript
// 1. React Query缓存优化
// apps/web/lib/trpc.ts
queryClient: new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,  // 5分钟
      cacheTime: 10 * 60 * 1000,  // 10分钟
      refetchOnWindowFocus: false,
    },
  },
}),

// 2. Session列表分页
// apps/web/app/sessions/page.tsx
const { data, fetchNextPage, hasNextPage } = 
  trpc.session.list.useInfiniteQuery({
    limit: 20,
  });

// 3. Loading骨架屏
// apps/web/components/SessionSkeleton.tsx
export function SessionSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-8 bg-gray-200 rounded w-1/4 mb-4"></div>
      <div className="h-20 bg-gray-200 rounded"></div>
    </div>
  );
}

// 4. Error Boundary
// apps/web/components/ErrorBoundary.tsx
import { ErrorBoundary as ReactErrorBoundary } from 'react-error-boundary';

export function ErrorBoundary({ children }) {
  return (
    <ReactErrorBoundary
      fallback={<div>Something went wrong</div>}
      onError={(error) => console.error(error)}
    >
      {children}
    </ReactErrorBoundary>
  );
}
```

**Week C5: Gate Approval UI (2小时)**  
从worktree-wf_217923b8-718-21提取:
- `apps/web/lib/gate-reader.ts`
- `apps/web/app/gates/page.tsx`
- `apps/web/components/gates/ApprovalModal.tsx`
- 修复accessibility (添加ARIA, focus trap, ESC handler)

**Week C6: Settings & Preferences (已完成)**  
审查并提交worktree中的代码

**Week C7: E2E Tests (6小时)**
```typescript
// tests/e2e/session-flow.spec.ts
test('complete session lifecycle', async ({ page }) => {
  await page.goto('/sessions');
  await page.click('text=Create Session');
  await page.fill('[name="goal"]', 'Test goal');
  await page.click('button:has-text("Start")');
  await expect(page.locator('.status-badge')).toHaveText('running');
  await page.click('button:has-text("Pause")');
  await expect(page.locator('.status-badge')).toHaveText('paused');
});

// tests/e2e/routes.spec.ts
test('route browsing and detail', async ({ page }) => {
  await page.goto('/routes');
  await expect(page.locator('.route-card')).toHaveCount(3);
  await page.click('.route-card:first-child');
  await expect(page).toHaveURL(/\/routes\/.+/);
});

// tests/e2e/theme.spec.ts
test('theme toggle persistence', async ({ page }) => {
  await page.goto('/');
  await page.click('[aria-label="Toggle theme"]');
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/);
});
```

**Week C8: Beta & GA (已完成)**  
审查并提交worktree中的代码

**总计:** ~14小时

---

### 方案B: 重新使用Workflow (不推荐)

**原因:**
- 已经花费455K tokens,结果质量混合
- 需要人工监督和修复
- Scope漂移问题(C4→C5, C7→C9)

**如果选择Workflow:**
1. 修复workflow脚本的范围验证
2. 添加agent重试逻辑
3. 只运行C4和C7 (其他手动)
4. 预计token: ~150K
5. 仍需人工review和修复

---

## 快速实施计划 (方案A)

### Day 1 (今天, 4小时)
- ✅ 已完成: C3 review + 修复 + 合并
- [ ] C5: 提取Gate代码 (2小时)
- [ ] C4: 实现性能优化 (2小时)

### Day 2 (4小时)
- [ ] C7: 编写E2E测试 (4小时)

### Day 3 (2小时)
- [ ] C6 + C8: 审查并提交 (2小时)

### Day 4 (测试和文档)
- [ ] 运行所有测试
- [ ] 更新文档
- [ ] 创建Phase C GA报告

---

## 立即行动项

### 现在可以做 (30分钟)

**1. 创建C4分支并开始实现**
```bash
git checkout -b feature/week-c4-performance
```

**2. 最小化C4实现**
```typescript
// 只需4个文件:
// 1. apps/web/lib/trpc.ts (缓存配置)
// 2. apps/web/components/SessionSkeleton.tsx
// 3. apps/web/components/ErrorBoundary.tsx  
// 4. apps/web/app/sessions/page.tsx (添加分页)

// 总计: ~150行新代码
```

**3. 测试后立即提交**
```bash
npm run test
git add .
git commit -m "feat(phase-c): Week C4 Performance optimizations"
git checkout master
git merge feature/week-c4-performance
```

---

## Token预算分析

### 已使用 (本session)
- 主要工作: ~90K
- Workflow: ~455K
- Review: ~35K
- **总计: ~580K**

### 剩余预算
- 200K budget - 122K used = **78K remaining**

### 需要的tokens (手动实现)
- C4实现: ~15K
- C5提取: ~10K
- C7 E2E: ~20K
- C6/C8审查: ~10K
- **总计: ~55K** ✅ 可行

---

## 建议

### ✅ 推荐: 手动实现剩余weeks

**理由:**
1. Token充足 (78K > 55K)
2. 质量可控
3. 范围准确
4. 快速迭代

### ❌ 不推荐: 再次使用Workflow

**理由:**
1. Token不足 (78K < 150K needed)
2. 质量不确定
3. 需要事后修复
4. 已有教训

---

## 成功标准

### Week C4
- ✅ React Query缓存优化
- ✅ Session列表分页
- ✅ Loading骨架屏
- ✅ Error boundary组件
- ✅ 无Gate功能

### Week C5
- ✅ Gate列表页面
- ✅ 审批modal (with accessibility)
- ✅ 实时更新
- ✅ 决策历史

### Week C7
- ✅ 15-20个E2E测试
- ✅ 覆盖所有关键流程
- ✅ 无部署代码

### Week C6/C8
- ✅ 代码审查通过
- ✅ 测试通过
- ✅ 文档完整

---

## 开始吗?

选择行动:
1. **立即开始C4** - 创建分支并实现4个文件
2. **立即开始C5** - 从worktree提取Gate代码
3. **查看详细计划** - 我提供step-by-step实施指南

推荐: **选项1** (C4最简单,2小时完成)
