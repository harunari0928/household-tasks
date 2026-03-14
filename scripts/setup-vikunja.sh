#!/bin/bash
# Vikunja initial setup: create user, API token, and project
set -e

VIKUNJA_URL="${1:-http://localhost:3456}"
ENV_FILE="${2:-.env}"
USERNAME="admin"
EMAIL="admin@localhost.local"
PASSWORD="changeme123"

echo "=== Vikunja Initial Setup ==="
echo "URL: ${VIKUNJA_URL}"

# Wait for Vikunja to be ready
echo "Waiting for Vikunja..."
for i in $(seq 1 30); do
  if curl -s "${VIKUNJA_URL}/api/v1/info" > /dev/null 2>&1; then
    echo "Vikunja is ready."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "ERROR: Vikunja did not start within 30 seconds."
    exit 1
  fi
  sleep 1
done

# 1. Register user
echo "Registering user..."
curl -s -X POST "${VIKUNJA_URL}/api/v1/register" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"${USERNAME}\",\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}" \
  > /dev/null 2>&1 || echo "(User may already exist)"

# 2. Login and get JWT
echo "Logging in..."
LOGIN_RESPONSE=$(curl -s -X POST "${VIKUNJA_URL}/api/v1/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"${USERNAME}\",\"password\":\"${PASSWORD}\"}")

JWT=$(echo "${LOGIN_RESPONSE}" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
if [ -z "${JWT}" ]; then
  echo "ERROR: Failed to get JWT token"
  echo "Response: ${LOGIN_RESPONSE}"
  exit 1
fi
echo "JWT obtained."

# 3. Create API token
echo "Creating API token..."
# Token expires in 10 years
EXPIRES_AT=$(date -u -d "+10 years" "+%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -v+10y "+%Y-%m-%dT%H:%M:%SZ")
TOKEN_RESPONSE=$(curl -s -X PUT "${VIKUNJA_URL}/api/v1/tokens" \
  -H "Authorization: Bearer ${JWT}" \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"scheduler\",\"permissions\":{\"tasks\":[\"create\",\"read\",\"update\"]},\"expires_at\":\"${EXPIRES_AT}\"}")

API_TOKEN=$(echo "${TOKEN_RESPONSE}" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
if [ -z "${API_TOKEN}" ]; then
  echo "ERROR: Failed to create API token"
  echo "Response: ${TOKEN_RESPONSE}"
  exit 1
fi
echo "API token created."

# 4. Create project
echo "Creating project..."
PROJECT_RESPONSE=$(curl -s -X PUT "${VIKUNJA_URL}/api/v1/projects" \
  -H "Authorization: Bearer ${JWT}" \
  -H "Content-Type: application/json" \
  -d '{"title":"家庭タスク"}')

PROJECT_ID=$(echo "${PROJECT_RESPONSE}" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)
if [ -z "${PROJECT_ID}" ]; then
  echo "ERROR: Failed to create project"
  echo "Response: ${PROJECT_RESPONSE}"
  exit 1
fi
echo "Project created (ID: ${PROJECT_ID})."

# 5. Write to .env
cat > "${ENV_FILE}" << EOF
VIKUNJA_API_TOKEN=${API_TOKEN}
EOF

echo ""
echo "=== Setup Complete ==="
echo "API Token: ${API_TOKEN}"
echo "Project ID: ${PROJECT_ID}"
echo "Written to: ${ENV_FILE}"
echo ""
echo "Next steps:"
echo "  1. Update scheduler_config via API:"
echo "     curl -X PUT http://localhost:3100/api/config -H 'Content-Type: application/json' -d '{\"default_project_id\":\"${PROJECT_ID}\",\"vikunja_api_token\":\"${API_TOKEN}\"}'"
echo "  2. Import seed data:"
echo "     ./scripts/seed.sh"
echo "  3. Restart containers:"
echo "     docker compose up -d"
