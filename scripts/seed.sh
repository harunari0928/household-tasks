#!/bin/bash
# Seed script: import all household tasks into the database via API
set -e

BASE_URL="${1:-http://localhost:3100}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Importing seed data to ${BASE_URL}..."
RESULT=$(curl -s -X POST "${BASE_URL}/api/tasks/import" \
  -H "Content-Type: application/json" \
  -d @"${SCRIPT_DIR}/seed-data.json")

echo "Result: ${RESULT}"
