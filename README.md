# GarudaTwin: AI-Enabled Real-Time Digital Twin System for MALE UAV Engines
### Baseline: Rotax 915 / 916 iS Turbocharged Aero Piston Engine (1414 cc, Dual FADEC)

[![React 18](https://img.shields.io/badge/Frontend-React%2018%20%2B%20Vite-blue.svg)](https://reactjs.org/)
[![Three.js](https://img.shields.io/badge/3D%20CAD-React%20Three%20Fiber-cyan.svg)](https://docs.pmnd.rs/react-three-fiber/)
[![PyTorch](https://img.shields.io/badge/AI%20Prognostics-PyTorch%20%2B%20FastAPI-red.svg)](https://pytorch.org/)
[![Node.js](https://img.shields.io/badge/Telemetry%20Engine-100%20Hz%20CAN%20Bus-green.svg)](https://nodejs.org/)
[![Military HUD](https://img.shields.io/badge/Standard-DO--178C%20%2F%20STANAG%204671-amber.svg)]()

---

## 🛰️ System Architecture

```
                                  +---------------------------------------+
                                  |   MALE UAV Aero Piston Engine Core    |
                                  |       (Rotax 915/916 iS FADEC)        |
                                  +---------------------------------------+
                                                     |
                                                     v
                                  +---------------------------------------+
                                  | 100 Hz Binary CAN Bus Telemetry Bus   |
                                  | CAN IDs: 0x100, 0x200, 0x210, 0x300   |
                                  +---------------------------------------+
                                         /                         \
                                        /                           \
                                       v                             v
           +---------------------------------------+   +---------------------------------------+
           | Node.js Express + Socket.io Server    |   | Python FastAPI AI & Physics Engine    |
           | - 100 Hz Packet Framer & Parser       |   | - First-Principles Thermodynamic Core |
           | - Dynamic Fault Injection Handlers    |   | - PyTorch Autoencoder (MSE Anomaly)   |
           | - Real-Time Health & Alert Dispatcher |   | - PyTorch Bi-LSTM (RUL 95% CI)        |
           +---------------------------------------+   | - Explainable AI (SHAP Attributions)  |
                                       \               | - Closed-Loop RL Mission Replanner    |
                                        \              +---------------------------------------+
                                         \                         /
                                          v                       v
                           +-----------------------------------------------------+
                           |            React 18 + Tailwind CSS + R3F            |
                           |           Tactical Ground Control Station           |
                           +-----------------------------------------------------+
                           | 1. 📐 3D Wireframe CAD Blueprint & Thermal Hotspots |
                           | 2. 📊 Live 100 Hz Telemetry & Residual Barometers   |
                           | 3. 🧠 PyTorch Prognostics, MSE Trace & SHAP XAI     |
                           | 4. 🗺️ RL Autonomous Emergency RTB Replanner        |
                           | 5. 🛸 Multi-UAV Swarm Fleet Management Matrix       |
                           | 6. ⚖️ Interactive Judge's Diagnostics Sandbox       |
                           | 7. 📄 AI GCS Copilot & 1-Click PDF Airworthiness    |
                           +-----------------------------------------------------+
```

---

## ⚡ Quick Start Guide

### 1. Prerequisites
- **Node.js**: v18.0+ / v20.0+
- **Python**: v3.10+ / v3.11+ / v3.12+ (for FastAPI microservice)

### 2. Frontend & Telemetry Engine Setup
```bash
# Install dependencies
npm install

# Start the 100 Hz CAN Bus Telemetry Server (Port 5000)
node server.js

# In a separate terminal, start the Vite Tactical Web Application (Port 5173)
npm run dev
```

### 3. (Optional) Python AI & Physics Microservice Setup
```bash
# Install Python requirements
pip install -r requirements.txt

# Run FastAPI PyTorch Microservice (Port 8000)
python ai_service.py
```

*Note: The frontend includes an autonomous internal physics & AI bridge that automatically synthesizes all 100 Hz telemetry, residual computations, and prognostics with zero latency even in standalone mode.*

---

## 📐 Tab Features & Capabilities

### Tab 1: 📐 Interactive MALE UAV Blueprint Workspace (`UavBlueprintTab.jsx`)
- 3D Wireframe & Solid Mesh of a MALE UAV (Predator / Heron class layout).
- Exploded View toggle revealing inner powertrain systems.
- Clickable component hotspots: **Rotax 915 Engine Block, Cylinders 1–4, Turbocharger & Electronic Wastegate, Lubrication System, Dual Fuel Pumps**.
- Real-time thermal shader color mapping (Green nominal $\rightarrow$ Amber warning $\rightarrow$ Red critical alert) fed from active sensor residuals.
- Hotspot Inspector drawer detailing subsystem specifications and physical failure modes.

### Tab 2: 📊 Real-Time Engine Telemetry & Residual Analytics (`TelemetryTab.jsx`)
- SVG Radial Gauges for RPM, Throttle %, MAP, Oil Pressure, Oil Temp, and Vibration g-RMS.
- Individual Combustion Channel Barometers for EGT 1–4 and CHT 1–4 with first-principles delta residual callouts ($\Delta = \text{Actual} - \text{Nominal}$).
- Live 100 Hz streaming sparklines for high-frequency telemetry channels.
- Live CAN 2.0B Binary Frame Raw Hex Sniffer displaying decoded packet frames.

### Tab 3: 🧠 AI Prognostics & Explainable AI (`PrognosticsTab.jsx`)
- **PyTorch Autoencoder Anomaly Detector**: Reconstruction MSE loss trajectory detecting subtle micro-anomalies before hardware threshold alarms trigger.
- **PyTorch Bi-LSTM Prognostics Network**: Sequence-to-One degradation curve forecasting Remaining Useful Life (RUL in Flight Hours) with shaded 95% confidence intervals.
- **SHAP-style Feature Importance Breakdown**: Percentage attribution bars identifying dominant root causes (e.g. `EGT_Cyl3: 48.5%`, `Vibration: 24.2%`).
- Subsystem health status matrix across Combustion, Lubrication, Turbocharging, Cooling, and Structural Dynamics.

### Tab 4: 🗺️ Closed-Loop RL Autonomous Mission Replanner (`MissionMapTab.jsx`)
- Interactive Leaflet tactical dark map displaying nominal mission flight plan (FOB Bravo $\rightarrow$ Waypoints).
- Autonomous RL Recalculated Emergency Return-to-Base (RTB) diversion trajectory dynamically computed when RUL decays below mission safety threshold.
- Dynamic safe glide reachability footprint and nearest recovery airstrips (Aux Recovery Strip 04).
- RL Policy control drawer recommending throttle derating (e.g. 58.0% min cruise power) and glide descent rate (-350 FPM).

### Tab 5: 🛸 Swarm Fleet Management Matrix (`FleetTab.jsx`)
- Multi-UAV fleet monitoring matrix for UAV-01 through UAV-05.
- Real-time health scores, airworthiness status, active flight hours, and scheduled maintenance countdowns.
- Detailed multi-disciplinary subsystem heatmap for any selected fleet asset.

### Tab 6: ⚖️ Judge's Diagnostics Sandbox (`JudgesSandboxTab.jsx`)
- Interactive parameter sliders allowing judges to enter arbitrary test conditions:
  - Altitude (0 – 30,000 ft), RPM (2,000 – 5,800), Throttle (0 – 100%), EGT 1–4, CHT 1–4, MAP, Oil Pressure & Temp, Vibration g-RMS.
- 1-Click Benchmark Scenarios: *Nominal Loiter*, *Cylinder 3 Lean Clog*, *Piston Ring Blow-By*, *Oil Pump Cavitation*, *Turbo Overboost Surge*.
- Instant evaluation outputs: Airworthiness Status Badge (NOMINAL / DERATED / CRITICAL ABORT), Health Index Score, Predicted RUL, Diagnostic Matrix, and Autonomous RL Recommendation.

### Tab 7: 📄 AI GCS Copilot & PDF Report Generator (`CopilotTab.jsx`)
- Natural language aerospace query assistant fine-tuned on Rotax 915 iS engine manuals and failure dynamics.
- Pre-built tactical prompt chips for rapid diagnostic interrogation.
- 1-Click PDF Airworthiness Report Exporter generating a formal digital certificate compliant with DO-178C.

---

## 🧪 Mathematical & Physics Foundations

### 1. Physics First-Principles Baseline Model
$$p_{\text{ambient}} = 1.01325 \left( 1 - 0.0225577 \cdot h_{\text{km}} \right)^{5.25588}$$
$$\text{MAP}_{\text{nominal}} = p_{\text{ambient}} \left[ 1 + 1.35 \cdot \left(\frac{\text{Throttle}}{100}\right) \cdot \left(\frac{\text{RPM}}{5800}\right) \right]$$
$$\text{EGT}_{\text{nominal}} = 820.0 + 45.0 \cdot \left(\frac{\text{Throttle}}{100}\right) + 20.0 \cdot \left(\frac{\text{RPM}}{5800}\right) + 8.0 \cdot \left(\frac{\text{Alt}}{10000}\right)$$
$$\text{Residual}_i = \text{Sensor}_i - \text{Nominal}_i$$

### 2. Autoencoder Reconstruction Loss
$$\mathcal{L}_{\text{MSE}} = \frac{1}{D} \sum_{j=1}^{D} \left( x_j - \hat{x}_j \right)^2$$

### 3. LSTM RUL Estimation & 95% Confidence Bounds
$$\mu_{\text{RUL}}, \sigma^2_{\text{RUL}} = f_{\text{Bi-LSTM}}(\mathbf{X}_{t-T:t})$$
$$\text{CI}_{95\%} = \left[ \mu_{\text{RUL}} - 1.96\sigma, \;\; \mu_{\text{RUL}} + 1.96\sigma \right]$$

---

## 🚀 Deployment to Vercel
The repository includes a production-ready `vercel.json` configured with single-page application routing rewrites. Simply push this repo to GitHub and import it into Vercel.
