#!/usr/bin/env bash

set -u

if [[ $# -lt 3 ]]; then
  echo "usage: run-with-diagnostics.sh <step-name> <log-name> <command> [args...]" >&2
  exit 64
fi

step_name=$1
log_name=$2
shift 2

workspace=${GITHUB_WORKSPACE:-$(pwd)}
log_dir="$workspace/build-logs"
log_path="$log_dir/$log_name"
summary_path="$log_dir/failure-summary.txt"

mkdir -p "$log_dir"
rm -f "$summary_path"

printf 'Running diagnostic step: %s\n' "$step_name"
printf 'Command:'
printf ' %q' "$@"
printf '\n'

set +e
"$@" 2>&1 | tee "$log_path"
pipe_status=("${PIPESTATUS[@]}")
set -e

command_status=${pipe_status[0]:-1}
tee_status=${pipe_status[1]:-1}
status=$command_status
if [[ $status -eq 0 && $tee_status -ne 0 ]]; then
  status=$tee_status
fi

if [[ $status -ne 0 ]]; then
  {
    echo "failed_step=$step_name"
    echo "exit_code=$status"
    echo "command_exit_code=$command_status"
    echo "tee_exit_code=$tee_status"
    echo "working_directory=$(pwd)"
    echo "log_file=$log_name"
    echo "command=$(printf '%q ' "$@")"
    echo "--- last 400 lines ---"
    tail -n 400 "$log_path" || true
  } > "$summary_path"

  echo "::error title=$step_name::Command failed with exit code $status. Download the Android build diagnostics artifact for the complete untruncated log."
  cat "$summary_path"
  exit "$status"
fi

printf 'Diagnostic step completed: %s\n' "$step_name"
