---
name: validate-amber-setup
description: Run full Amber Protocol validation suite
disable-model-invocation: true
---

# Amber Setup Validator

运行完整的 Amber Protocol 验证套件，检查仓库健康状态。

## 执行内容

1. `npm run doctor` - 仓库健康检查
2. `npm run manifests` - Schema 验证
3. `npm test` - 单元测试
4. 汇总所有验证结果

## 使用方式

调用: `/validate-amber-setup`
