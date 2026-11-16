#!/bin/sh
# One end-to-end shop from the production image: its own database, reached by the tests on
# http://localhost:$((3300 + SHOP)). The log is kept in /logs, where the tests read the setup link.
set -eu
db="e2e-db:5432/shop$SHOP"
export DATABASE_URL="postgres://aicommerce_app:aicommerce_app@$db"
export MIGRATION_DATABASE_URL="postgres://aicommerce:aicommerce@$db"
export AICOMMERCE_PUBLIC_URL="http://localhost:$((3300 + SHOP))"
# Test values only.
export AICOMMERCE_SECRET_KEY=ZGV2ZWxvcG1lbnQtb25seS1zZWNyZXQta2V5LTMyYiE=
export AICOMMERCE_AUTH_SECRET=end-to-end-tests-only-auth-secret-not-for-production
node apps/server/dist/supervisor.js 2>&1 | tee "/logs/shop$SHOP.log"
