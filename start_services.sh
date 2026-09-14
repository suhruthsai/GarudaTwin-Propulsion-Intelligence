#!/usr/bin/env bash
# ==============================================================================
# GarudaTwin Propulsion Intelligence - Unified Service Launcher
# Launches:
#   1. Python FastAPI AI Prognostics Microservice (Port 8001)
#   2. Node.js Telemetry, CAN Bus & Gateway Server (Port 5002)
#   3. Vite UI Frontend (Port 5173)
# ==============================================================================

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "============================================================"
echo "  GarudaTwin MALE UAV Propulsion Intelligence System        "
echo "============================================================"

# Helper function to kill child processes on exit
cleanup() {
    echo ""
    echo "[!] Stopping launched GarudaTwin services..."
    if [ -n "$AI_PID" ] && kill -0 "$AI_PID" 2>/dev/null; then
        kill "$AI_PID" 2>/dev/null || true
    fi
    if [ -n "$NODE_PID" ] && kill -0 "$NODE_PID" 2>/dev/null; then
        kill "$NODE_PID" 2>/dev/null || true
    fi
    if [ -n "$VITE_PID" ] && kill -0 "$VITE_PID" 2>/dev/null; then
        kill "$VITE_PID" 2>/dev/null || true
    fi
    exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# 1. Start Python AI Microservice (Port 8001)
if lsof -nP -iTCP:8001 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "[✓] Port 8001: Python AI Service is already running."
else
    echo "[+] Starting Python AI Microservice on port 8001..."
    ./ai_venv/bin/python ai_service.py > ai_service.log 2>&1 &
    AI_PID=$!
    sleep 2
fi

# 2. Start Node.js Gateway & CAN Server (Port 5002)
if lsof -nP -iTCP:5002 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "[✓] Port 5002: Node Telemetry & Gateway Server is already running."
else
    echo "[+] Starting Node.js CAN & Gateway Server on port 5002..."
    node server.js > server.log 2>&1 &
    NODE_PID=$!
    sleep 2
fi

# 3. Start Vite Frontend (Port 5173)
if lsof -nP -iTCP:5173 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "[✓] Port 5173: Vite Frontend is already running."
else
    echo "[+] Starting Vite Frontend on port 5173..."
    npm run dev &
    VITE_PID=$!
fi

echo "============================================================"
echo "  All Services Operational:                                 "
echo "   - Frontend UI:        http://localhost:5173              "
echo "   - Telemetry Gateway:  http://localhost:5002              "
echo "   - AI Microservice:    http://localhost:8001              "
echo "============================================================"
echo "Press Ctrl+C to stop all services."

wait
