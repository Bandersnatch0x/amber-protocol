#!/usr/bin/env bash
# Amber Acceptance Demo — exercises the full closed-loop lifecycle.
# Usage: bash scripts/demo/acceptance-demo.sh   (run from repo root)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AMBER=("node" "$SCRIPT_DIR/../amber.js")
WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT
cd "$WORKDIR"

echo "━━━ Amber Acceptance Demo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Target: $WORKDIR"
echo ""

step() { echo "▸ $*"; }
ok()   { echo "  ✔ $*"; }

# 1. audit
step 1/11 audit
"${AMBER[@]}" audit --target . --json > /dev/null 2>&1
ok audit

# 2. init (seeds F001)
step 2/11 init
"${AMBER[@]}" init --target . > /dev/null 2>&1
ok init

# Seed package.json so `npm test` works for verify --execute
cat > package.json << 'EOF'
{"scripts":{"test":"node -e \"console.log('ok')\""}}
EOF
ok package.json

# 3. feature add (F002 — F001 already seeded by init)
step 3/11 feature add
"${AMBER[@]}" feature add --target . --id F002 --title "Acceptance demo" --priority 1 --area demo > /dev/null 2>&1
ok "feature F002"

# 4. plan
step 4/11 plan
"${AMBER[@]}" plan --target . --feature F002 --title "Demo plan" > /dev/null 2>&1
PLAN=$(ls docs/plans/*.md | head -1)
PLAN_REL="docs/plans/$(basename "$PLAN")"
ok "$PLAN_REL"

# Fill the Verification section (required for reviewPlan)
node -e "
const fs=require('fs');
let c=fs.readFileSync('$PLAN','utf8');
c=c.replace('## Verification\n\n\n','## Verification\n\n- Run npm test.\n\n');
fs.writeFileSync('$PLAN',c);
"
ok "verification section"

# 5. gate
step 5/11 gate
"${AMBER[@]}" gate --confirm --target . --plan "$PLAN_REL" > /dev/null 2>&1
ok "plan confirmed"

# 6. session start (bound to F002)
step 6/11 session start
SID=$("${AMBER[@]}" session start --target . --goal "verify lifecycle" --feature F002 --json | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).sessionId))")
ok "session $SID"

# 7. session verify --execute
step 7/11 session verify
"${AMBER[@]}" session verify --session "$SID" --execute --command "npm test" --target . > /dev/null 2>&1
ok "session verified"

# 8. session approve
step 8/11 session approve
"${AMBER[@]}" session approve --session "$SID" --gate "user-approval-implement" --yes --target . > /dev/null 2>&1
ok "session approved"

# 9. complete-check + complete
step 9/11 session complete
"${AMBER[@]}" session complete-check --session "$SID" --strict --target . > /dev/null 2>&1
"${AMBER[@]}" session complete --session "$SID" --target . > /dev/null 2>&1
ok "session completed"

# 10. accept
step 10/11 accept
"${AMBER[@]}" accept --target . --plan "$PLAN_REL" --session "$SID" > /dev/null 2>&1
ok "plan accepted"

# 11. handoff + next verification
step 11/11 handoff
"${AMBER[@]}" handoff --target . > /dev/null 2>&1
ok "handoff generated"

NEXT=$("${AMBER[@]}" next --target . --json)
COMPLETE=$(echo "$NEXT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).complete?'yes':'no'))")
ok "lifecycle complete: $COMPLETE"

echo ""
echo "━━━ Demo complete ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "All 11 steps passed."
