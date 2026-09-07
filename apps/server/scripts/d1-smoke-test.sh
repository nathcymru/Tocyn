#!/bin/bash
set -euo pipefail

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT
echo "Setting up local D1 test database in isolated temporary state ($TMP_DIR)..."

for migration in migrations/*.sql; do
  npx wrangler d1 execute luminatick-db --local --persist-to="$TMP_DIR" --file="$migration" > /dev/null
done

echo "Populating data with identical IDs in two tenants..."
npx wrangler d1 execute luminatick-db --local --persist-to=$TMP_DIR --command="INSERT INTO users (tenant_id, id, email, role) VALUES ('tenant-A', 'shared-id', 'a@test.com', 'customer');" > /dev/null
npx wrangler d1 execute luminatick-db --local --persist-to=$TMP_DIR --command="INSERT INTO users (tenant_id, id, email, role) VALUES ('tenant-B', 'shared-id', 'b@test.com', 'customer');" > /dev/null

echo "Populating distinct user in tenant B..."
npx wrangler d1 execute luminatick-db --local --persist-to=$TMP_DIR --command="INSERT INTO users (tenant_id, id, email, role) VALUES ('tenant-B', 'unique-b-id', 'b2@test.com', 'customer');" > /dev/null

echo "Attempting to create ticket for tenant-A assigned to tenant-B unique user (cross-tenant FK test)..."
# Expect failure!
if FK_OUTPUT=$(npx wrangler d1 execute luminatick-db --local --persist-to="$TMP_DIR" --command="INSERT INTO tickets (tenant_id, id, subject, customer_id, customer_email, source) VALUES ('tenant-A', 'ticket-1', 'Test', 'unique-b-id', 'test@test.com', 'email');" 2>&1); then
  echo "FAIL: Cross-tenant FK assignment was NOT rejected."
  exit 1
elif grep -q "FOREIGN KEY constraint failed" <<< "$FK_OUTPUT"; then
  echo "SUCCESS: Cross-tenant FK assignment was correctly rejected by D1."
else
  echo "FAIL: D1 command failed for a reason other than the expected FK constraint."
  exit 1
fi

echo "Running PRAGMA foreign_key_check..."
CHK_FK=$(npx wrangler d1 execute luminatick-db --local --persist-to=$TMP_DIR --command="PRAGMA foreign_key_check;" --json)
if grep -q '"results": \[\]' <<< "$CHK_FK"; then
  echo "SUCCESS: PRAGMA foreign_key_check valid (zero violations)."
else
  echo "FAIL: PRAGMA foreign_key_check failed."
  exit 1
fi

echo "Running PRAGMA quick_check..."
CHK_QC=$(npx wrangler d1 execute luminatick-db --local --persist-to=$TMP_DIR --command="PRAGMA quick_check;" --json)
if grep -q '"quick_check": "ok"' <<< "$CHK_QC"; then
  echo "SUCCESS: PRAGMA quick_check valid."
else
  echo "FAIL: PRAGMA quick_check failed."
  exit 1
fi

echo "D1 runtime integration tests passed!"
rm -rf $TMP_DIR
