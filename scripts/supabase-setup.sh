#!/usr/bin/env bash
# Bootstrap local Supabase + generate .env files for both apps.
#
# Usage:
#   ./scripts/supabase-setup.sh            # local stack (Docker) + reset DB
#   ./scripts/supabase-setup.sh --remote   # assume you already ran `supabase link`
#
# Requires: supabase CLI (`brew install supabase/tap/supabase` or `npm i -g supabase`).

set -euo pipefail

MODE="${1:-local}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if ! command -v supabase >/dev/null 2>&1; then
  echo "❌ supabase CLI not found. Install it: npm i -g supabase" >&2
  exit 1
fi

if [[ "$MODE" == "--remote" ]]; then
  echo "📡 Remote mode — assuming 'supabase link' already ran."
  supabase db push
  echo "✅ Migrations pushed to remote."
  exit 0
fi

echo "🐳 Starting local Supabase stack (Postgres + Auth + Storage + Edge Functions)…"
supabase start

echo "🗄  Applying migrations + seed…"
supabase db reset

# Parse CLI output into .env for each app.
STATUS=$(supabase status --output json)
API_URL=$(echo "$STATUS" | grep -o '"API URL":"[^"]*' | cut -d'"' -f4 | head -n1)
ANON_KEY=$(echo "$STATUS" | grep -o '"anon key":"[^"]*' | cut -d'"' -f4 | head -n1)
SERVICE_ROLE=$(echo "$STATUS" | grep -o '"service_role key":"[^"]*' | cut -d'"' -f4 | head -n1)

write_env() {
  local path="$1"
  shift
  echo "$@" > "$path"
  echo "📝 wrote $path"
}

write_env apps/mobile/.env.local \
"EXPO_PUBLIC_SUPABASE_URL=$API_URL
EXPO_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY
EXPO_PUBLIC_BIOMETRIC_PROVIDER=unico"

write_env apps/dashboard/.env.local \
"NEXT_PUBLIC_SUPABASE_URL=$API_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE"

echo ""
echo "✅ Ready:"
echo "   Studio: $(echo "$STATUS" | grep -o '"Studio URL":"[^"]*' | cut -d'"' -f4 | head -n1)"
echo "   API:    $API_URL"
echo ""
echo "Next: pnpm dashboard:dev  (or pnpm mobile:start)"
