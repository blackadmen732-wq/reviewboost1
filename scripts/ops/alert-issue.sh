#!/usr/bin/env bash
# Keep exactly one GitHub issue open per alert while its check is failing, and
# close it when the check passes again. One issue, not one per run: a check
# that fails every few hours must not become a notification every few hours.
# GitHub notifies the repository owner of a new issue by email and in the
# mobile app, which is the whole point.
#
#   scripts/ops/alert-issue.sh open  <label> <title> <body-file>
#   scripts/ops/alert-issue.sh close <label> <comment>
#
# Needs GH_TOKEN (issues: write) and GH_REPO. Used by the production-watch and
# database-backup workflows.
set -euo pipefail

action=${1:?open or close}
label=${2:?label}

existing=$(gh issue list --state open --label "$label" --limit 1 --json number --jq '.[0].number // empty' 2>/dev/null || true)

case "$action" in
  open)
    title=${3:?title}
    body_file=${4:?body file}
    gh label create "$label" --color B60205 \
      --description "Opened and closed automatically by the production watch workflows" \
      --force >/dev/null
    if [[ -n "$existing" ]]; then
      echo "Alert already open: #$existing"
    else
      gh issue create --title "$title" --label "$label" --body-file "$body_file"
    fi
    ;;
  close)
    comment=${3:?comment}
    if [[ -n "$existing" ]]; then
      gh issue close "$existing" --comment "$comment"
    else
      echo "No open $label issue."
    fi
    ;;
  *)
    echo "usage: $0 open|close <label> ..." >&2
    exit 2
    ;;
esac
