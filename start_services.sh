#!/usr/bin/env bash
# GarudaTwin launcher — delegates to the cross-platform Node launcher.
#   ./start_services.sh            start AI service + gateway + web UI and verify the live stream
#   ./start_services.sh --restart  stop anything on 8001/5002/5173 first
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"
if [ "$1" = "--restart" ] || [ "$1" = "-r" ]; then
  node scripts/start.mjs stop
fi
exec node scripts/start.mjs all
