#!/usr/bin/env bash
# Scrape the video list of a MacCMS VOD source, optionally filtered by type.
#
# Usage:
#   ./scrape.sh              # list available types (id / parent / name)
#   ./scrape.sh all          # scrape every video                -> all_videos.jsonl
#   ./scrape.sh 8            # scrape type_id 8 only             -> type_8.jsonl
#   ./scrape.sh 学生空姐      # scrape the type named exactly this -> type_8.jsonl
#
# Matching is exact: only the one type whose id or name equals the param is
# scraped. No partial-name matches, no child types.
set -euo pipefail

BASE="${BASE:-https://f-1.cc/api.php/provide/vod}"
DELAY="${DELAY:-0.3}"   # seconds between requests; be polite / avoid rate limits

api() { curl -s --max-time 15 "$BASE?$1"; }

CLASSES=$(api "ac=list" | jq -c '[.class[]? | {id: .type_id, pid: .type_pid, name: .type_name}]')

if [[ $# -eq 0 ]]; then
  echo "Available types (id  parent  name):"
  jq -r '.[] | "\(.id)\t\(.pid)\t\(.name)"' <<<"$CLASSES"
  echo
  echo "Usage: $0 <type_id|type_name|all>"
  exit 0
fi

# Fetch all pages for one query string (e.g. "t=8" or ""), print JSONL to stdout.
# $2 (optional): keep only videos with this type_id, in case the source ignores t=.
scrape() {
  local q="$1" only="${2:-}" pages p
  pages=$(api "ac=list${q:+&$q}&pg=1" | jq '.pagecount // 0')
  echo "  ${q:-all}: $pages pages" >&2
  (( pages > 0 )) || return 0
  for p in $(seq 1 "$pages"); do
    api "ac=list${q:+&$q}&pg=$p" \
      | jq -c --arg only "$only" '.list[]?
          | select($only == "" or (.type_id | tostring) == $only)
          | {id: .vod_id, name: .vod_name, type_id: .type_id, type: .type_name, time: .vod_time}'
    sleep "$DELAY"
  done
}

if [[ "$1" == "all" ]]; then
  OUT="all_videos.jsonl"
  scrape "" > "$OUT"
else
  # Exact match: numeric param -> type_id, otherwise exact type_name
  T=$(jq -r --arg q "$1" '
    .[] | select((.id | tostring) == $q or .name == $q) | .id
  ' <<<"$CLASSES" | head -n1)
  if [[ -z "$T" ]]; then
    echo "No type named or numbered exactly: $1 (run $0 with no args to list types)" >&2
    exit 1
  fi
  NAME=$(jq -r --argjson t "$T" '.[] | select(.id == $t) | .name' <<<"$CLASSES")

  OUT="type_${T}.jsonl"
  echo "Scraping type $T ($NAME)" >&2
  scrape "t=$T" "$T" > "$OUT"
fi

echo "Saved $(wc -l < "$OUT" | tr -d ' ') videos to $OUT" >&2
