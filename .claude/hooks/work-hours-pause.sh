#!/usr/bin/env bash
# Pauses Claude Code during work hours: weekdays 09:00-17:00 America/Los_Angeles,
# except the 12:00-13:00 lunch break. Wired to UserPromptSubmit (blocks new messages)
# and PreToolUse (stops work already in progress at its next tool call).
# WORK_HOURS_NOW="2026-09-28 10:00" overrides the clock, for testing.
set -euo pipefail
cat >/dev/null # hook input on stdin is not needed

export TZ=America/Los_Angeles
if [[ -n "${WORK_HOURS_NOW:-}" ]]; then
  now=$(date -d "$WORK_HOURS_NOW" '+%u %H%M')
else
  now=$(date '+%u %H%M')
fi
read -r dow hm <<<"$now"
hm=$((10#$hm))

if ((dow <= 5)) && { ((hm >= 900 && hm < 1200)) || ((hm >= 1300 && hm < 1700)); }; then
  echo '{"continue": false, "stopReason": "上班時間暫停中（平日 9:00-17:00 PT，12:00-13:00 午休可用）。"}'
fi
exit 0
