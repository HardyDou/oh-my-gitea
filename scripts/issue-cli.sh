#!/usr/bin/env bash
set -euo pipefail

: "${GITEA_PM_URL:=http://localhost:3000}"
: "${OH_MY_GITEA_TOKEN:?请先设置 OH_MY_GITEA_TOKEN（oh-my-gitea API Token）}"

usage() {
  cat <<'EOF'
用法:
  issue-cli.sh get OWNER REPO NUMBER
  issue-cli.sh management OWNER REPO NUMBER STAGE_CODE SUBSTAGE_CODE [PRIORITY]
  issue-cli.sh state OWNER REPO NUMBER open|closed
  issue-cli.sh comment OWNER REPO NUMBER COMMENT
  issue-cli.sh assignee OWNER REPO NUMBER LOGIN
  issue-cli.sh due-date OWNER REPO NUMBER YYYY-MM-DD|clear
  issue-cli.sh history OWNER REPO NUMBER
EOF
  exit 2
}

[[ $# -ge 4 ]] || usage
command_name="$1"
owner="$2"
repo="$3"
number="$4"
base="${GITEA_PM_URL%/}/api/v1/repositories/${owner}/${repo}/issues/${number}"

request() {
  local method="$1" url="$2" body="${3:-}"
  if [[ -n "$body" ]]; then
    curl --fail-with-body -sS -X "$method" "$url" \
      -H "Authorization: Bearer ${OH_MY_GITEA_TOKEN}" \
      -H 'Content-Type: application/json' \
      --data "$body"
  else
    curl --fail-with-body -sS -X "$method" "$url" \
      -H "Authorization: Bearer ${OH_MY_GITEA_TOKEN}"
  fi
  printf '\n'
}

json_value() {
  command -v jq >/dev/null 2>&1 || { echo '需要安装 jq 才能使用此 CLI' >&2; exit 1; }
  jq -cn "$@"
}

case "$command_name" in
  get)
    [[ $# -eq 4 ]] || usage
    request GET "${base}/detail"
    ;;
  management)
    [[ $# -ge 6 && $# -le 7 ]] || usage
    stage_code="$5"
    substage_code="$6"
    priority="${7:-}"
    if [[ -n "$priority" ]]; then
      body="$(json_value --arg stageCode "$stage_code" --arg subStageCode "$substage_code" --arg priority "$priority" '{stageCode:$stageCode,subStageCode:$subStageCode,priority:$priority}')"
    else
      body="$(json_value --arg stageCode "$stage_code" --arg subStageCode "$substage_code" '{stageCode:$stageCode,subStageCode:$subStageCode}')"
    fi
    request PATCH "${base}/management" "$body"
    ;;
  state)
    [[ $# -eq 5 && ( "$5" == open || "$5" == closed ) ]] || usage
    body="$(json_value --arg state "$5" '{state:$state}')"
    request PATCH "${base}/state" "$body"
    ;;
  comment)
    [[ $# -eq 5 ]] || usage
    body="$(json_value --arg body "$5" '{body:$body}')"
    request POST "${base}/comments" "$body"
    ;;
  assignee)
    [[ $# -eq 5 ]] || usage
    body="$(json_value --arg assignee "$5" '{assignee:$assignee}')"
    request PATCH "${base}/assignee" "$body"
    ;;
  due-date)
    [[ $# -eq 5 ]] || usage
    if [[ "$5" == clear ]]; then
      body='{"dueDate":null}'
    else
      body="$(json_value --arg dueDate "$5" '{dueDate:$dueDate}')"
    fi
    request PATCH "${base}/due-date" "$body"
    ;;
  history)
    [[ $# -eq 4 ]] || usage
    request GET "${base}/history"
    ;;
  *)
    usage
    ;;
esac
