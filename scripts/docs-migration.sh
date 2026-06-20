#!/usr/bin/env bash
set -euo pipefail

echo "📦 Starting document reorganization..."

# 创建目标目录
mkdir -p docs/guides docs/architecture docs/superpowers/plans/handoffs

# 使用 git mv 保留历史
if [ -f docs/phase-c-beta-guide.md ]; then
  git mv docs/phase-c-beta-guide.md docs/guides/getting-started.md
  echo "✓ Moved phase-c-beta-guide.md -> guides/getting-started.md"
fi

if [ -f docs/phase-c-ga-checklist.md ]; then
  git mv docs/phase-c-ga-checklist.md docs/superpowers/plans/phase-c-ga-checklist.md
  echo "✓ Moved phase-c-ga-checklist.md -> superpowers/plans/"
fi

# 移动 handoff 文档
for file in docs/handoff-*.md; do
  if [ -f "$file" ]; then
    git mv "$file" docs/superpowers/plans/handoffs/
    echo "✓ Moved $(basename $file) -> superpowers/plans/handoffs/"
  fi
done

# 自动修复链接
echo "🔗 Fixing internal links..."
find docs -name '*.md' -type f -exec sed -i 's|phase-c-beta-guide\.md|guides/getting-started.md|g' {} +
find docs -name '*.md' -type f -exec sed -i 's|phase-c-ga-checklist\.md|superpowers/plans/phase-c-ga-checklist.md|g' {} +

# 验证链接
echo "✅ Validating links..."
if command -v node &> /dev/null && [ -f scripts/check-broken-links.js ]; then
  node scripts/check-broken-links.js
else
  echo "⚠️  Link checker not available yet, skipping validation"
fi

echo "✅ Document migration complete"
