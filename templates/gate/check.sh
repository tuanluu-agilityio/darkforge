#!/usr/bin/env bash
# Quality gate skeleton. Replace each TODO with the project's real command.
# Prints the success marker as a whole line only when every step passed.
set -u
fail=0
step() {
  name=$1
  echo "== $name"
  shift
  "$@" || { echo "CHECK FAILED: $name"; fail=1; }
}
# TODO: build
step build true
# TODO: test
step test true
# TODO: lint
step lint true
if [ "$fail" -ne 0 ]; then exit 1; fi
echo "{{successMarker}}"
