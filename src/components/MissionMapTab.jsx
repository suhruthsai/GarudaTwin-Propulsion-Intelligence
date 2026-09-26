import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, Polygon, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useTelemetry } from '../context/TelemetryContext';
import { 
  Navigation, 
  MapPin, 
  Wind, 
  ShieldAlert, 
  CheckCircle2, 
  Compass, 
  ArrowRight, 
  Plane,
  AlertTriangle,
  RotateCcw,
  Play,
  Sliders,
  ShieldCheck,
  Gauge,
  Fuel,
  Eye,
  Cpu,
  RefreshCw,
  Send,
  Check,
  Crosshair,
  Layers
} from 'lucide-react';

// Tactical Swarm UAV SVG Marker Factory
const createSwarmUavIcon = (uavId, status = 'NOMINAL', isSelected = false) => {
  const isEmergency = status === 'CRITICAL';
  const isDegraded = status === 'DEGRADED';
  const mainColor = isEmergency ? '#EF4444' : isDegraded ? '#F59E0B' : '#00F0FF';
  const size = isSelected ? 38 : 28;
  const shortId = uavId.replace('Vahak-', 'V-');

  return new L.DivIcon({
    className: 'custom-uav-icon',
    html: `
      <div style="position: relative; display: flex; flex-direction: column; align-items: center;">
        <div style="
          transform: rotate(45deg); 
          display: flex; 
          align-items: center; 
          justify-content: center; 
          width: ${size}px; 
          height: ${size}px; 
          background: ${isEmergency ? 'rgba(239, 68, 68, 0.35)' : isDegraded ? 'rgba(245, 158, 11, 0.35)' : 'rgba(0, 240, 255, 0.25)'}; 
          border: ${isSelected ? '2.5px solid #FFFFFF' : `2px solid ${mainColor}`}; 
          border-radius: 50%; 
          box-shadow: 0 0 ${isSelected ? '22px' : '10px'} ${mainColor};
          transition: all 0.3s ease;
        ">
          <svg width="${isSelected ? 20 : 15}" height="${isSelected ? 20 : 15}" viewBox="0 0 24 24" fill="${mainColor}" stroke="#030712" stroke-width="1.5">
            <polygon points="12 2 2 7 12 12 22 7 12 2"/>
            <polyline points="2 17 12 22 22 17"/>
            <polyline points="2 12 12 17 22 12"/>
          </svg>
        </div>
        <div style="
          position: absolute;
          top: ${size + 2}px;
          background: rgba(3, 7, 18, 0.92);
          border: 1px solid ${mainColor};
          color: ${isSelected ? '#FFFFFF' : mainColor};
          font-size: 8.5px;
          font-weight: bold;
          font-family: monospace;
          padding: 1px 4px;
          border-radius: 3px;
          white-space: nowrap;
          box-shadow: 0 2px 8px rgba(0,0,0,0.85);
          letter-spacing: 0.5px;
        ">
          ${shortId}
        </div>
      </div>
    `,
    iconSize: [size, size + 16],
    iconAnchor: [size / 2, size / 2]
  });
};

// Base Airfield Marker
const baseIcon = new L.DivIcon({
  className: 'custom-base-icon',
  html: `
    <div style="display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; background: rgba(16, 185, 129, 0.3); border: 2px solid #10B981; border-radius: 4px; box-shadow: 0 0 12px #10B981;">
      <div style="width: 8px; height: 8px; background: #10B981; border-radius: 2px;"></div>
    </div>
  `,
  iconSize: [28, 28],
  iconAnchor: [14, 14]
});

// Divert Strip Marker
const divertIcon = new L.DivIcon({
  className: 'custom-divert-icon',
  html: `
    <div style="display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; background: rgba(245, 158, 11, 0.3); border: 2px solid #F59E0B; border-radius: 4px; box-shadow: 0 0 12px #F59E0B;">
      <div style="width: 8px; height: 8px; background: #F59E0B; border-radius: 2px;"></div>
    </div>
  `,
  iconSize: [28, 28],
  iconAnchor: [14, 14]
});

// Remote Emergency Strip Marker
const remoteIcon = new L.DivIcon({
  className: 'custom-remote-icon',
  html: `
    <div style="display: flex; align-items: center; justify-content: center; width: 26px; height: 26px; background: rgba(239, 68, 68, 0.3); border: 2px solid #EF4444; border-radius: 4px; box-shadow: 0 0 10px #EF4444;">
      <div style="width: 7px; height: 7px; background: #EF4444; border-radius: 2px;"></div>
    </div>
  `,
  iconSize: [26, 26],
  iconAnchor: [13, 13]
});

// Waypoint Marker
const waypointIcon = (id) => new L.DivIcon({
  className: 'custom-wp-icon',
  html: `
    <div style="display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; background: rgba(14, 165, 233, 0.4); border: 1.5px solid #38BDF8; border-radius: 50%; color: #38BDF8; font-size: 9px; font-weight: bold; font-family: monospace; box-shadow: 0 0 8px #0EA5E9;">
      ${id}
    </div>
  `,
  iconSize: [20, 20],
  iconAnchor: [10, 10]
});

// Leaflet Map Resizer Hook for Tab Layouts
function MapResizer() {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
    const t1 = setTimeout(() => map.invalidateSize(), 150);
    const t2 = setTimeout(() => map.invalidateSize(), 400);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [map]);
  return null;
}

// Dynamic Map Viewport Controller for Replan Corridor Auto-Fit
function MapFocusController({ routePolyline, isReplannerActive, replanMode }) {
  const map = useMap();
  useEffect(() => {
    if (!isReplannerActive || !routePolyline || routePolyline.length < 2) return;
    if (replanMode === 'CONTINGENCY_PREVIEW' || replanMode === 'FORCE_SIMULATION') {
      try {
        const bounds = routePolyline.map(pt => [pt[0], pt[1]]);
        map.fitBounds(bounds, { padding: [60, 60], maxZoom: 9, animate: true });
      } catch (err) {
        console.warn('[MapFocusController] Auto-fit bounds error:', err);
      }
    }
  }, [map, routePolyline, isReplannerActive, replanMode]);
  return null;
}

// Haversine Distance Helper (Nautical Miles)
const calcDistNm = (lat1, lon1, lat2, lon2) => {
  const R = 3440.065; // Earth radius in NM
  const toRad = deg => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// Recovery Airfields Registry (Indo-Pak Border Western Theater)
const AIRFIELDS = [
  {
    id: 'AFS_UTTARLAI',
    name: 'Air Force Station Uttarlai (AFS UTL - Rwy 02/20)',
    shortName: 'AFS Uttarlai',
    coords: [25.8117, 71.4883],
    altFt: 500,
    rwyLengthFt: 9000,
    type: 'PRIMARY',
    icon: baseIcon,
    color: '#10B981'
  },
  {
    id: 'AFS_JAISALMER',
    name: 'Air Force Station Jaisalmer (Forward Air Base)',
    shortName: 'AFS Jaisalmer',
    coords: [26.8897, 70.8653],
    altFt: 825,
    rwyLengthFt: 9000,
    type: 'DIVERT',
    icon: divertIcon,
    color: '#F59E0B'
  },
  {
    id: 'POKHRAN_ALG',
    name: 'Pokhran Advanced Landing Ground (Emergency Strip 09)',
    shortName: 'Pokhran ALG',
    coords: [26.9200, 71.7500],
    altFt: 720,
    rwyLengthFt: 4500,
    type: 'EMERGENCY_GLIDE',
    icon: remoteIcon,
    color: '#EF4444'
  }
];

// Swarm Fleet Base Telemetry & Geo Registry (Thar Border Surveillance Sector)
const FLEET_GEO = {
  'Vahak-1': {
    id: 'Vahak-1',
    callsign: 'Vahak-1 (BORDER PATROL - THAR SECTOR)',
    coords: [26.4500, 70.5200],
    nominalPath: [
      [25.8117, 71.4883],
      [26.1500, 71.1000],
      [26.4500, 70.5200],
      [26.8500, 70.3500],
      [27.1000, 70.6000]
    ]
  },
  'Vahak-2': {
    id: 'Vahak-2',
    callsign: 'Vahak-2 (ESCORT LEAD - SECTOR SOUTH)',
    coords: [25.9500, 70.8500],
    nominalPath: [
      [25.8117, 71.4883],
      [25.9500, 70.8500],
      [26.1000, 70.6500]
    ]
  },
  'Vahak-3': {
    id: 'Vahak-3',
    callsign: 'Vahak-3 (RELAY ORBIT - HIGH ALTITUDE)',
    coords: [26.7000, 71.3000],
    nominalPath: [
      [26.8897, 70.8653],
      [26.7000, 71.3000],
      [26.5000, 71.6000]
    ]
  },
  'Vahak-4': {
    id: 'Vahak-4',
    callsign: 'Vahak-4 (PERIMETER PATROL - DESERT CORRIDOR)',
    coords: [26.3500, 70.9000],
    nominalPath: [
      [25.8117, 71.4883],
      [26.3500, 70.9000]
    ]
  },
  'Vahak-5': {
    id: 'Vahak-5',
    callsign: 'Vahak-5 (HANGAR RESERVE - AFS UTTARLAI)',
    coords: [25.8117, 71.4883],
    nominalPath: [
      [25.8117, 71.4883]
    ]
  }
};

// Geofence Tactical Operating Box (Indo-Pak Border Western Corridor)
const GEOFENCE_POLYGON = [
  [25.3000, 70.1000],
  [27.5000, 70.1000],
  [27.5000, 72.2000],
  [25.3000, 72.2000]
];

// Indo-Pak International Border (IB) Line (Sir Creek to Punjab Corridor)
const INDO_PAK_BORDER = [
  [23.7000, 68.2000],
  [24.1500, 68.8000],
  [24.5500, 69.4500],
  [24.9500, 70.3000],
  [25.4000, 70.2800], // Munabao Border Sector
  [25.7500, 70.2500], // Gadra Road
  [26.1500, 70.1800], // Khokhropar / Barmer West Sector
  [26.5500, 70.2200], // Mirpur Khas / Jaisalmer SW Sector
  [26.9000, 70.1500], // Longewala / Tanot Sector
  [27.3500, 70.4000], // Kishangarh Fort Sector
  [27.8500, 71.0000], // West of Bikaner
  [28.3000, 71.5500], // Anupgarh Sector
  [28.8500, 72.3000], // Sri Ganganagar Sector
  [29.4000, 72.9000],
  [30.1000, 73.5000], // Fazilka Sector
  [30.8500, 74.3000], // Ferozepur / Hussainiwala
  [31.6000, 74.5700], // Wagah / Attari Border
  [32.0500, 74.9000], // Dera Baba Nanak
  [32.3500, 75.0500]  // Shakargarh Bulge
];

// Tactical Airspace Territorial Label DivIcons
const createTerritoryLabel = (text, flag, color, bgColor, borderColor) => new L.DivIcon({
  className: 'custom-territory-label',
  html: `
    <div style="
      background: ${bgColor}; 
      border: 1.5px solid ${borderColor}; 
      border-radius: 4px; 
      padding: 3px 8px; 
      color: ${color}; 
      font-size: 10px; 
      font-family: monospace; 
      font-weight: 800; 
      white-space: nowrap; 
      box-shadow: 0 0 14px ${borderColor};
      letter-spacing: 0.5px;
      backdrop-filter: blur(4px);
    ">
      <span style="margin-right: 4px;">${flag}</span>${text}
    </div>
  `,
  iconSize: [160, 24],
  iconAnchor: [80, 12]
});

const indiaAirspaceIcon = createTerritoryLabel('INDIA (WESTERN AIR COMMAND)', '🇮🇳', '#38BDF8', 'rgba(3, 7, 18, 0.85)', 'rgba(56, 189, 248, 0.7)');
const pakistanAirspaceIcon = createTerritoryLabel('PAKISTAN (HOSTILE RADAR ADZ)', '🇵🇰', '#F87171', 'rgba(30, 10, 10, 0.9)', 'rgba(239, 68, 68, 0.8)');

export const MissionMapTab = () => {
  const { 
    telemetry, 
    aiPrognostics, 
    fcsState,
    loadFcsMission,
    setFcsAirspeed,
    setFcsAltitude,
    setFcsMode,
    updateManualConditions
  } = useTelemetry();
  
  // Selected Unit State
  const [selectedUnit, setSelectedUnit] = useState('Vahak-1');
  
  // Replan Control Mode: 'AUTO' | 'FORCE_SIMULATION' | 'CONTINGENCY_PREVIEW'
  const [replanMode, setReplanMode] = useState('AUTO');
  
  // Target Airfield Selection: 'AUTO' | 'FOB_BRAVO' | 'AUX_04' | 'THERMAL_09'
  const [selectedAirfieldId, setSelectedAirfieldId] = useState('AUTO');

  // Closed-loop Derate Engagement State
  const [isDerateEngaged, setIsDerateEngaged] = useState(false);
  const [isSolving, setIsSolving] = useState(false);
  const [lastReplanTime, setLastReplanTime] = useState(Date.now());
  const [backendRlSolution, setBackendRlSolution] = useState(null);
  const [derateStatusMsg, setDerateStatusMsg] = useState('');

  // Swarm fleet real-time physics status helper
  const getUavStats = useCallback((uavId) => {
    if (uavId === 'Vahak-1') {
      const h = aiPrognostics?.engine_health_index ?? telemetry.health?.index ?? 100.0;
      const r = aiPrognostics?.rul_hours_mean ?? 751.4;
      const af = telemetry.health?.activeFault ?? 'NONE';
      const isCrit = h < 40 || r < 2.0 || af === 'CYL3_INJECTOR' || af === 'OIL_PUMP_CAVITATION';
      const isDeg = !isCrit && (h < 75 || r < 20.0 || af !== 'NONE');
      return {
        health: Number(h.toFixed(1)),
        rul: Number(r.toFixed(1)),
        altitude: telemetry.mission?.altitudeFt ?? 14500,
        speed: telemetry.mission?.airspeedKts ?? 115,
        fault: af,
        status: isCrit ? 'CRITICAL' : isDeg ? 'DEGRADED' : 'NOMINAL',
        statusColor: isCrit ? 'text-red-400 font-bold' : isDeg ? 'text-amber-400 font-bold' : 'text-emerald-400 font-bold',
        desc: 'Lead Tactical Testbed'
      };
    }
    
    if (uavId === 'Vahak-2') {
      return {
        health: 96.2,
        rul: 785.0,
        altitude: 15200,
        speed: 118,
        fault: 'NONE',
        status: 'NOMINAL',
        statusColor: 'text-emerald-400 font-bold',
        desc: 'Escort Lead'
      };
    }

    if (uavId === 'Vahak-3') {
      return {
        health: 99.1,
        rul: 1120.0,
        altitude: 18000,
        speed: 125,
        fault: 'NONE',
        status: 'NOMINAL',
        statusColor: 'text-emerald-400 font-bold',
        desc: 'Relay Orbit'
      };
    }

    if (uavId === 'Vahak-4') {
      return {
        health: 84.5,
        rul: 420.0,
        altitude: 12000,
        speed: 98,
        fault: 'PRGB_DEGRADATION',
        status: 'DEGRADED',
        statusColor: 'text-amber-400 font-bold',
        desc: 'Perimeter Patrol'
      };
    }

    // Vahak-5 (AFS Uttarlai Hangar Reserve)
    return {
      health: 72.0,
      rul: 120.0,
      altitude: 500,
      speed: 0,
      fault: 'OIL_PUMP_CAVITATION',
      status: 'CRITICAL',
      statusColor: 'text-red-400 font-bold',
      desc: 'AFS Uttarlai Hangar (Grounded)'
    };
  }, [telemetry, aiPrognostics]);

  // Unit Status & Telemetry Resolver
  const baseGeo = FLEET_GEO[selectedUnit] || FLEET_GEO['Vahak-1'];
  const unitGeo = useMemo(() => {
    if (selectedUnit === 'Vahak-1' && (telemetry.mission?.lat || fcsState?.north_m !== undefined)) {
      const lat = telemetry.mission?.lat ?? (26.4500 + (fcsState?.north_m ?? 0) / 111320);
      const lon = telemetry.mission?.lon ?? (70.5200 + (fcsState?.east_m ?? 0) / (111320 * Math.cos(26.45 * Math.PI / 180)));
      return {
        ...baseGeo,
        coords: [Number(lat.toFixed(5)), Number(lon.toFixed(5))],
      };
    }
    return baseGeo;
  }, [selectedUnit, baseGeo, telemetry.mission?.lat, telemetry.mission?.lon, fcsState?.north_m, fcsState?.east_m]);
  const currentStats = getUavStats(selectedUnit);
  const unitHealth = currentStats.health;
  const unitRul = currentStats.rul;
  const unitAltitude = currentStats.altitude;
  const unitAirspeed = currentStats.speed;
  const activeFault = currentStats.fault;
  const isGrounded = selectedUnit === 'Vahak-5';
  const isCritical = currentStats.status === 'CRITICAL' && !isGrounded;
  const isDegraded = currentStats.status === 'DEGRADED';
  const isSimulating = replanMode === 'FORCE_SIMULATION';
  const isPreview = replanMode === 'CONTINGENCY_PREVIEW';

  // Whether RL Replanner Active Route Should Render
  const isReplannerActive = isCritical || isDegraded || isSimulating || isPreview || isDerateEngaged || selectedAirfieldId !== 'AUTO';

  // Asynchronous RL Replan Solver connecting to Python FastAPI / Node Gateway
  const solveRlReplan = useCallback(async () => {
    if (isGrounded) return;
    setIsSolving(true);
    try {
      const uavPos = unitGeo.coords;
      const liveFuelLiters = (telemetry.mission?.fuel_kg ? (telemetry.mission.fuel_kg / 0.72) : null)
        ?? (telemetry.mission?.fuel_remaining_liters)
        ?? (telemetry.mission?.missionTime ? Math.max(10, (200 - telemetry.mission.missionTime * 0.0072) / 0.72) : 84.0);

      const payload = {
        uav_id: selectedUnit,
        current_lat: uavPos[0],
        current_lng: uavPos[1],
        altitude_ft: unitAltitude,
        fuel_remaining_liters: Number(liveFuelLiters.toFixed(1)),
        engine_health_index: unitHealth,
        rul_hours: unitRul,
        target_field_id: selectedAirfieldId,
        mode: replanMode
      };

      const primaryHost = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? `http://${window.location.hostname}:8001`
        : '/ai';
      const gatewayHost = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? `http://${window.location.hostname}:5002`
        : '';

      let res = null;
      try {
        res = await fetch(`${primaryHost}/api/rl-replan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          throw new Error(`Primary host HTTP ${res.status}`);
        }
      } catch {
        try {
          res = await fetch(`${gatewayHost}/api/rl-replan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          if (!res.ok) {
            throw new Error(`Gateway host HTTP ${res.status}`);
          }
        } catch (gateErr) {
          console.warn('[RL Replanner] Backend query fallback failed:', gateErr);
        }
      }

      if (res && res.ok) {
        const data = await res.json();
        setBackendRlSolution({ ...data, uavId: selectedUnit });
      }
    } catch (err) {
      console.warn('[RL Replanner] Backend query failed:', err);
    } finally {
      setIsSolving(false);
      setLastReplanTime(Date.now());
    }
  }, [
    isGrounded,
    unitGeo.coords,
    unitAltitude,
    unitHealth,
    unitRul,
    selectedAirfieldId,
    replanMode,
    selectedUnit,
    telemetry.mission?.fuel_kg,
    telemetry.mission?.fuel_remaining_liters,
    telemetry.mission?.missionTime
  ]);

  // Automatically trigger asynchronous solve when relevant parameters change
  useEffect(() => {
    const t = setTimeout(() => {
      solveRlReplan();
    }, 120);
    return () => clearTimeout(t);
  }, [selectedUnit, replanMode, selectedAirfieldId, isCritical, isDegraded]);

  // -------------------------------------------------------------
  // PPO Reinforcement Learning Policy Evaluation
  // -------------------------------------------------------------
  const rlSolution = useMemo(() => {
    const uavPos = unitGeo.coords;
    
    // 0. Handle Grounded Airframe (Vahak-5)
    if (isGrounded) {
      const hangarField = {
        id: 'AFS_UTTARLAI',
        name: 'Air Force Station Uttarlai (Hangar Bay 3)',
        shortName: 'AFS Uttarlai (Hangar)',
        coords: [25.8117, 71.4883],
        altFt: 500,
        distNm: 0.0
      };
      return {
        action: 'AIRCRAFT_GROUNDED',
        label: 'AIRCRAFT SECURED ON GROUND (MAINTENANCE OVERHAUL)',
        destination: hangarField,
        allFields: AIRFIELDS.map(f => ({ ...f, distNm: Number(calcDistNm(uavPos[0], uavPos[1], f.coords[0], f.coords[1]).toFixed(1)) })),
        distNm: 0.0,
        flightTimeMin: 0.0,
        safetyMarginRatio: 99.9,
        recommendedThrottle: 0.0,
        recommendedRpm: 0,
        recommendedClimbFpm: 0,
        commandedSpeedKts: 0,
        fuelFlowLph: 0.0,
        waypoints: [],
        routePolyline: [],
        metrics: {
          survivabilityPct: 100.0,
          cyclePreservationPct: 100.0,
          glideConeRadiusNm: 0.0,
          glideMarginNm: 0.0
        }
      };
    }

    // 1. Calculate Distances to all candidate airfields from this UAV's location
    const candidateDistances = AIRFIELDS.map(f => ({
      ...f,
      distNm: Number(calcDistNm(uavPos[0], uavPos[1], f.coords[0], f.coords[1]).toFixed(1))
    }));

    // 2. Select Optimal Destination based on unit sector and aeromechanics
    let chosenField = null;
    if (selectedAirfieldId !== 'AUTO') {
      chosenField = candidateDistances.find(f => f.id === selectedAirfieldId) || candidateDistances[0];
    } else {
      if (isCritical || isSimulating) {
        // Nearest runway with immediate glide reach
        const sortedByDist = [...candidateDistances].sort((a, b) => a.distNm - b.distNm);
        chosenField = sortedByDist[0];
      } else if (isDegraded) {
        // Degraded power: prioritize nearest base with full recovery facilities
        const sortedByDist = [...candidateDistances].sort((a, b) => a.distNm - b.distNm);
        chosenField = sortedByDist[0]; // Nearest runway for degraded divert
      } else {
        // Nominal & Contingency Preview: Default to Primary Base AFS Uttarlai (Full depot, 9000ft runway)
        chosenField = candidateDistances.find(f => f.id === 'AFS_UTTARLAI') || candidateDistances[0];
      }
    }

    // 3. Recommended Power & Descent Profile based on RL Policy
    let recommendedThrottle = selectedUnit === 'Vahak-3' ? 82.5 : selectedUnit === 'Vahak-2' ? 80.0 : 78.5;
    let recommendedRpm = selectedUnit === 'Vahak-3' ? 5100 : selectedUnit === 'Vahak-2' ? 4950 : 4850;
    let recommendedClimbFpm = 0;
    let commandedSpeedKts = unitAirspeed;
    let policyAction = 'NOMINAL_CRUISE';
    let policyLabel = 'NOMINAL MISSION PATROL ORBIT';

    const isEngagedOrDivert = isCritical || isSimulating || isDegraded || isPreview || isDerateEngaged;

    if (isCritical || isSimulating) {
      policyAction = 'EMERGENCY_DIVERT_RTB';
      policyLabel = 'AUTONOMOUS EMERGENCY RTB ENGAGED';
      recommendedThrottle = 58.0; // Minimum cruise power
      recommendedRpm = 4200;
      recommendedClimbFpm = -350; // Glide descent slope
      commandedSpeedKts = 95.0;
    } else if (isDegraded) {
      policyAction = 'DERATE_AND_DIVERT';
      policyLabel = 'ADAPTIVE POWER DERATE COMMANDED';
      recommendedThrottle = 68.0; // Derated power to spare PRGB clutch
      recommendedRpm = 4400;
      recommendedClimbFpm = -200; // Controlled glide descent
      commandedSpeedKts = 105.0;
    } else if (isDerateEngaged || isPreview) {
      policyAction = isDerateEngaged ? 'DERATE_ACTIVE' : 'CONTINGENCY_PREVIEW';
      policyLabel = isDerateEngaged ? 'CLOSED-LOOP DERATE APPLIED TO FADEC' : 'CONTINGENCY ENVELOPE PREVIEW — AFS UTTARLAI RTB';
      recommendedThrottle = 68.0;
      recommendedRpm = 4600;
      recommendedClimbFpm = -200;
      commandedSpeedKts = 105.0;
    }

    // 4. Calculate Flight Time & Safety Margin
    const effectiveSpeed = commandedSpeedKts > 0 ? commandedSpeedKts : 110.0;
    const flightTimeMin = Math.max(0.5, (chosenField.distNm / effectiveSpeed) * 60.0);
    const flightTimeHrs = flightTimeMin / 60.0;
    const safetyMarginRatio = Number((unitRul / flightTimeHrs).toFixed(1));

    // 5. Generate Multi-Waypoint RL Flight Plan
    const waypoints = [];
    const numSteps = 4;
    for (let i = 0; i <= numSteps; i++) {
      const frac = i / numSteps;
      const lat = Number((uavPos[0] + frac * (chosenField.coords[0] - uavPos[0])).toFixed(4));
      const lng = Number((uavPos[1] + frac * (chosenField.coords[1] - uavPos[1])).toFixed(4));
      const alt = Math.round(unitAltitude - frac * (unitAltitude - chosenField.altFt));
      const segDist = Number((chosenField.distNm * (1 - frac)).toFixed(1));
      const etaMin = Number((flightTimeMin * frac).toFixed(1));

      let wpName = `WP-${i + 1}`;
      if (i === 0) wpName = isEngagedOrDivert ? 'INITIAL_DERATE' : 'CURRENT_POS';
      else if (i === 1) wpName = 'GLIDE_INTERCEPT';
      else if (i === numSteps - 1) wpName = 'APPROACH_GATE';
      else if (i === numSteps) wpName = 'TOUCHDOWN';

      waypoints.push({
        id: i + 1,
        name: wpName,
        coords: [lat, lng],
        altitudeFt: isEngagedOrDivert ? alt : (i === numSteps ? chosenField.altFt : unitAltitude),
        airspeedKts: i === numSteps ? 72 : commandedSpeedKts,
        distRemainingNm: segDist,
        etaMin: etaMin
      });
    }

    // 6. RL Reward & Performance Metrics
    const survivabilityPct = isCritical ? 98.6 : isDegraded ? 99.4 : 99.9;
    const cyclePreservationPct = isCritical ? 52.4 : isDegraded ? 38.0 : 15.0;
    const glideConeRadiusNm = Number(((unitAltitude / 6076.12) * 12.0).toFixed(1)); // 12:1 glide ratio in NM
    const glideMarginNm = Number((glideConeRadiusNm - chosenField.distNm).toFixed(1));

    // Merge backend RL policy solution if available and matches selected unit & non-grounded state
    if (backendRlSolution && backendRlSolution.uavId === selectedUnit && backendRlSolution.optimized_rtb_flight_plan && !isGrounded) {
      const backendCmds = backendRlSolution.rl_control_commands || {};
      const backendWps = backendRlSolution.optimized_rtb_flight_plan.map((w, idx) => ({
        id: idx + 1,
        name: w.name || w.wp_id || `WP-${idx + 1}`,
        coords: [w.lat, w.lng],
        altitudeFt: w.altitude_ft,
        airspeedKts: w.commanded_airspeed_kts || commandedSpeedKts,
        distRemainingNm: w.dist_remaining_nm ?? Number((backendRlSolution.distance_to_field_nm * (1 - idx / 4)).toFixed(1)),
        etaMin: w.eta_min ?? Number((backendRlSolution.estimated_flight_time_minutes * (idx / 4)).toFixed(1))
      }));

      const matchedDest = AIRFIELDS.find(f => f.id === backendRlSolution.target_field_id) || chosenField;

      return {
        action: backendRlSolution.action,
        label: backendRlSolution.action === 'EMERGENCY_DIVERT_RTB'
          ? 'AUTONOMOUS EMERGENCY RTB ENGAGED (RL OPTIMAL)'
          : backendRlSolution.action === 'CONTINGENCY_RTB_PREVIEW'
          ? 'CONTINGENCY ENVELOPE PREVIEW — AFS UTTARLAI RTB'
          : (isDerateEngaged ? 'CLOSED-LOOP DERATE APPLIED TO FADEC' : policyLabel),
        destination: {
          ...matchedDest,
          distNm: backendRlSolution.distance_to_field_nm
        },
        allFields: candidateDistances,
        distNm: backendRlSolution.distance_to_field_nm,
        flightTimeMin: backendRlSolution.estimated_flight_time_minutes,
        safetyMarginRatio: backendRlSolution.rul_safety_margin_factor,
        recommendedThrottle: backendCmds.recommended_throttle_pct ?? recommendedThrottle,
        recommendedRpm: backendCmds.recommended_rpm ?? recommendedRpm,
        recommendedClimbFpm: backendCmds.recommended_vertical_speed_fpm ?? recommendedClimbFpm,
        commandedSpeedKts: backendCmds.commanded_airspeed_kts ?? commandedSpeedKts,
        fuelFlowLph: backendCmds.fuel_flow_target_lph ?? (recommendedThrottle < 65 ? 18.5 : 25.0),
        waypoints: backendWps,
        routePolyline: backendWps.map(w => w.coords),
        metrics: {
          survivabilityPct,
          cyclePreservationPct,
          glideConeRadiusNm,
          glideMarginNm: Number((glideConeRadiusNm - backendRlSolution.distance_to_field_nm).toFixed(1))
        }
      };
    }

    return {
      action: policyAction,
      label: policyLabel,
      destination: chosenField,
      allFields: candidateDistances,
      distNm: chosenField.distNm,
      flightTimeMin: Number(flightTimeMin.toFixed(1)),
      safetyMarginRatio: safetyMarginRatio,
      recommendedThrottle: recommendedThrottle,
      recommendedRpm: recommendedRpm,
      recommendedClimbFpm: recommendedClimbFpm,
      commandedSpeedKts: commandedSpeedKts,
      fuelFlowLph: recommendedThrottle === 0 ? 0.0 : recommendedThrottle < 65 ? 18.5 : recommendedThrottle < 75 ? 22.0 : 26.0,
      waypoints: waypoints,
      routePolyline: waypoints.map(w => w.coords),
      metrics: {
        survivabilityPct,
        cyclePreservationPct,
        glideConeRadiusNm,
        glideMarginNm
      }
    };
  }, [
    selectedUnit,
    unitGeo,
    unitHealth,
    unitRul,
    unitAltitude,
    unitAirspeed,
    activeFault,
    isGrounded,
    isCritical,
    isDegraded,
    isSimulating,
    isPreview,
    isDerateEngaged,
    selectedAirfieldId,
    lastReplanTime,
    backendRlSolution
  ]);

  // Recalculate Trigger
  const handleRecalculate = () => {
    solveRlReplan();
  };

  // Engage Derate Trigger - Transmit closed-loop commands to FCS Autopilot and Engine FADEC
  const handleEngageDerate = () => {
    if (isGrounded) return;
    setIsDerateEngaged(true);

    // 1. Transform RL flight plan waypoints to local ENU for 6-DOF Autopilot
    if (rlSolution.waypoints && rlSolution.waypoints.length > 0) {
      const fcsWps = rlSolution.waypoints.map(wp => ({
        north: (wp.coords[0] - 26.4500) * 111320,
        east: (wp.coords[1] - 70.5200) * (111320 * Math.cos(26.45 * Math.PI / 180)),
        alt_m: (wp.altitudeFt || 14500) * 0.3048,
        speed_ms: (wp.airspeedKts || 95) / 1.94384
      }));
      loadFcsMission(fcsWps);
    }

    // 2. Set Autopilot setpoints
    setFcsAirspeed(rlSolution.commandedSpeedKts);
    // Safe intermediate hold altitude to prevent abrupt nose-dive while waypoints handle gradual descent
    const safeHoldAlt = (rlSolution.waypoints && rlSolution.waypoints[1]?.altitudeFt)
      ? rlSolution.waypoints[1].altitudeFt
      : unitAltitude;
    setFcsAltitude(safeHoldAlt);

    // 3. Command FADEC engine derate to live engine twin
    updateManualConditions({
      throttlePct: rlSolution.recommendedThrottle,
      targetRpm: rlSolution.recommendedRpm,
      airspeedKts: rlSolution.commandedSpeedKts
    });

    // 4. Arm Autopilot in AUTO_MISSION
    setFcsMode('AUTO_MISSION');

    setDerateStatusMsg('COMMANDS TRANSMITTED: FADEC DERATED & FCS AUTO-MISSION ARMED');
    setTimeout(() => setDerateStatusMsg(''), 6000);
  };

  return (
    <div className="flex flex-col lg:flex-row gap-3.5 h-[calc(100vh-140px)] w-full text-slate-900 font-mono">
      
      {/* ─────────────────────────────────────────────────────────────
          1. LEFT MAP CANVAS: Tactical Leaflet Display & Visual Overlays
         ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 relative gcs-panel rounded-lg overflow-hidden flex flex-col min-h-[480px] border border-slate-200 shadow-xs">
        
        {/* Top Header Control Banner */}
        <div className="absolute top-3 left-3 right-3 z-[1000] flex flex-wrap items-center justify-between gap-2 pointer-events-none">
          <div className="flex flex-wrap items-center gap-2 pointer-events-auto">
            {/* Title Badge */}
            <div className="px-3 py-1 bg-white/95 border border-slate-200 rounded-md text-xs font-mono text-sky-700 flex items-center gap-2 backdrop-blur shadow-xs">
              <Navigation className="w-3.5 h-3.5 text-sky-600 animate-pulse" />
              <span className="font-bold tracking-wider">RL AUTONOMOUS REPLANNER</span>
            </div>

            {/* Decision Status Badge */}
            <div className={`px-3 py-1 rounded-md text-xs font-mono font-bold flex items-center gap-2 backdrop-blur shadow-xs border ${
              isCritical || isSimulating
                ? 'bg-red-50 border-red-200 text-red-700 animate-pulse'
                : isDegraded || isPreview
                ? 'bg-amber-50 border-amber-200 text-amber-700'
                : 'bg-emerald-50 border-emerald-200 text-emerald-700'
            }`}>
              <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
              <span>RL DECISION: {rlSolution.label}</span>
            </div>
          </div>

          {/* Unit Switcher Pills on Map */}
          <div className="flex items-center gap-1 bg-white/95 p-1 rounded-md border border-slate-200 backdrop-blur-md pointer-events-auto shadow-sm text-[10px]">
            {['Vahak-1', 'Vahak-2', 'Vahak-3', 'Vahak-4', 'Vahak-5'].map(u => (
              <button
                key={u}
                onClick={() => setSelectedUnit(u)}
                className={`px-2.5 py-1 rounded-md transition-all font-bold ${
                  selectedUnit === u
                    ? 'bg-sky-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                {u}
              </button>
            ))}
          </div>
        </div>

        {/* Leaflet Interactive Map */}
        <div className="w-full h-full min-h-[480px]">
          <MapContainer
            center={[26.3500, 71.1000]}
            zoom={8}
            style={{ height: '100%', width: '100%', minHeight: '480px', background: '#F1F5F9' }}
            zoomControl={false}
          >
            {/* Automatic Size Invalidation for Tab Switching */}
            <MapResizer />

            {/* Dynamic Viewport Controller for RTB / Divert Flight Corridor Auto-Framing */}
            <MapFocusController
              routePolyline={rlSolution.routePolyline}
              isReplannerActive={isReplannerActive}
              replanMode={replanMode}
            />

            {/* Natural Daylight Cartography */}
            <TileLayer
              attribution='&copy; OpenStreetMap contributors'
              url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            {/* 1. Dark Bold Indo-Pak International Border (IB) Line */}
            {/* Outer heavy black contrast stroke */}
            <Polyline
              positions={INDO_PAK_BORDER}
              pathOptions={{
                color: '#0F172A',
                weight: 5,
                opacity: 0.85,
                lineCap: 'round',
                lineJoin: 'round'
              }}
            />
            {/* Inner high-visibility red dashed border line */}
            <Polyline
              positions={INDO_PAK_BORDER}
              pathOptions={{
                color: '#DC2626',
                weight: 3,
                dashArray: '10, 6',
                opacity: 1
              }}
            />

            {/* Tactical Territory Airspace Markers */}
            <Marker position={[26.6500, 71.0000]} icon={indiaAirspaceIcon} interactive={false} />
            <Marker position={[26.6500, 69.4500]} icon={pakistanAirspaceIcon} interactive={false} />

            {/* Geofence Perimeter */}
            <Polygon
              positions={GEOFENCE_POLYGON}
              pathOptions={{ color: '#0284C7', weight: 1.5, dashArray: '6, 6', fillOpacity: 0.04 }}
            />

            {/* Nominal Flight Plan (Sky Polyline) */}
            <Polyline
              positions={unitGeo.nominalPath}
              pathOptions={{ color: '#0284C7', weight: 2.5, opacity: 0.8 }}
            />

            {/* 6-DOF Autopilot Active Mission Waypoints */}
            {fcsState?.waypoints && fcsState.waypoints.length > 0 && (
              <>
                <Polyline
                  positions={fcsState.waypoints.map(w => [
                    26.4500 + (w.north || 0) / 111320,
                    70.5200 + (w.east || 0) / (111320 * Math.cos(26.45 * Math.PI / 180))
                  ])}
                  pathOptions={{ color: '#059669', weight: 3, dashArray: '6, 6', opacity: 0.9 }}
                />
                {fcsState.waypoints.map((w, idx) => {
                  const lat = 26.4500 + (w.north || 0) / 111320;
                  const lon = 70.5200 + (w.east || 0) / (111320 * Math.cos(26.45 * Math.PI / 180));
                  const isCurrentTarget = fcsState.wp_idx === idx;
                  return (
                    <Marker key={`fcs-wp-${idx}`} position={[lat, lon]} icon={waypointIcon(`WP${idx + 1}`)}>
                      <Popup>
                        <div className="font-mono text-xs">
                          <div className="text-sky-700 font-bold">FCS WAYPOINT {idx + 1}</div>
                          <div>North: {w.north}m | East: {w.east}m</div>
                          <div>Alt: {Math.round(w.alt_m * 3.28084)} ft</div>
                          {isCurrentTarget && <div className="text-emerald-600 font-bold mt-1">▶ ACTIVE TARGET</div>}
                        </div>
                      </Popup>
                    </Marker>
                  );
                })}
              </>
            )}

            {/* RL Autonomous Recalculated Flight Plan (High-Visibility Amber / Red Dotted) */}
            {isReplannerActive && (
              <>
                {/* Contrast underlay halo for tactical daylight visibility */}
                <Polyline
                  positions={rlSolution.routePolyline}
                  pathOptions={{
                    color: '#0F172A',
                    weight: 6,
                    opacity: 0.75,
                    lineCap: 'round',
                    lineJoin: 'round'
                  }}
                />
                {/* Tactical dashed trajectory line */}
                <Polyline
                  positions={rlSolution.routePolyline}
                  pathOptions={{
                    color: isCritical || isSimulating ? '#EF4444' : (isPreview ? '#F59E0B' : '#D97706'),
                    weight: 4,
                    dashArray: '8, 8',
                    opacity: 1.0
                  }}
                />
              </>
            )}

            {/* Safe Glide Cone Reachability Footprint / FCS 6-DOF Dynamic Glide Cone */}
            {(() => {
              const isFcsEmergency = fcsState?.ap_mode === 'EMERGENCY_GLIDE' || fcsState?.engine_out;
              const fcsGlideRadiusM = (fcsState?.glide_range_m && fcsState.glide_range_m > 0)
                ? fcsState.glide_range_m
                : (rlSolution.metrics.glideConeRadiusNm * 1852);
              return (
                <>
                  <Circle
                    center={unitGeo.coords}
                    radius={fcsGlideRadiusM}
                    pathOptions={{
                      color: isFcsEmergency ? '#DC2626' : (isCritical || isSimulating ? '#EF4444' : '#059669'),
                      fillColor: isFcsEmergency ? '#DC2626' : (isCritical || isSimulating ? '#EF4444' : '#059669'),
                      fillOpacity: isFcsEmergency ? 0.15 : 0.06,
                      weight: isFcsEmergency ? 3 : 1.5,
                      dashArray: isFcsEmergency ? '6, 4' : '5, 5'
                    }}
                  >
                    <Popup>
                      <div className="text-xs font-mono p-1">
                        <div className="font-bold text-red-600">
                          {isFcsEmergency ? '⚠ 6-DOF EMERGENCY GLIDE FOOTPRINT' : 'SAFE GLIDE CONE FOOTPRINT'}
                        </div>
                        <div className="text-slate-700 mt-1">
                          L/D Max: 14.5 | Vbg: 82 kts
                        </div>
                        <div className="text-emerald-700 font-bold mt-1">
                          Radius: {(fcsGlideRadiusM / 1000).toFixed(1)} km ({(fcsGlideRadiusM / 1852).toFixed(1)} NM)
                        </div>
                        {isFcsEmergency && (
                          <div className="text-amber-800 text-[10px] mt-1 border-t border-red-300 pt-1">
                            FADEC flameout/derate interlock triggered best-glide guidance.
                          </div>
                        )}
                      </div>
                    </Popup>
                  </Circle>
                  {isFcsEmergency && (
                    <Circle
                      center={unitGeo.coords}
                      radius={fcsGlideRadiusM * 0.7}
                      pathOptions={{
                        color: '#D97706',
                        fillColor: '#D97706',
                        fillOpacity: 0.08,
                        weight: 1.5,
                        dashArray: '3, 3'
                      }}
                    />
                  )}
                </>
              );
            })()}

            {/* Airfield Markers */}
            {AIRFIELDS.map(f => (
              <Marker key={f.id} position={f.coords} icon={f.icon}>
                <Popup>
                  <div className="text-xs font-mono">
                    <div className="font-bold text-slate-900">{f.name}</div>
                    <div className="text-slate-600">Elev: {f.altFt} ft | Rwy: {f.rwyLengthFt} ft</div>
                    <div className="text-amber-700 font-bold mt-1">
                      Distance from {selectedUnit}: {calcDistNm(unitGeo.coords[0], unitGeo.coords[1], f.coords[0], f.coords[1]).toFixed(1)} NM
                    </div>
                  </div>
                </Popup>
              </Marker>
            ))}

            {/* Intermediate Waypoint Markers on Replanned Route */}
            {isReplannerActive && rlSolution.waypoints.map(wp => (
              <Marker key={wp.id} position={wp.coords} icon={waypointIcon(wp.id)}>
                <Popup>
                  <div className="text-xs font-mono">
                    <div className="font-bold text-sky-700">{wp.name} (#{wp.id})</div>
                    <div>Target Alt: {wp.altitudeFt.toLocaleString()} ft</div>
                    <div>Airspeed: {wp.airspeedKts} kts</div>
                    <div>Distance to Touchdown: {wp.distRemainingNm} NM</div>
                    <div>ETA: +{wp.etaMin} min</div>
                  </div>
                </Popup>
              </Marker>
            ))}

            {/* All Swarm UAV Markers Rendered Simultaneously */}
            {Object.entries(FLEET_GEO).map(([uId, geo]) => {
              const isSelected = selectedUnit === uId;
              const stats = getUavStats(uId);

              return (
                <Marker
                  key={uId}
                  position={(uId === 'Vahak-1' || isSelected) ? unitGeo.coords : geo.coords}
                  icon={createSwarmUavIcon(uId, stats.status, isSelected)}
                  eventHandlers={{
                    click: () => setSelectedUnit(uId)
                  }}
                >
                  <Popup>
                    <div className="text-xs font-mono">
                      <div className="font-bold text-slate-900 flex items-center justify-between gap-2">
                        <span>{geo.callsign}</span>
                        {isSelected && <span className="text-[9px] bg-sky-600 text-white px-1.5 py-0.2 rounded font-bold">FOCUSED</span>}
                      </div>
                      <div className="text-slate-600 mt-1">Status: <span className={stats.statusColor}>{stats.status}</span> ({stats.desc})</div>
                      <div>Health: <span className="font-bold text-slate-900">{stats.health}%</span> | RUL: <span className="font-bold text-slate-900">{stats.rul} hrs</span></div>
                      <div>Altitude: <span className="font-bold text-slate-900">{stats.altitude.toLocaleString()} ft</span> | Speed: <span className="font-bold text-slate-900">{stats.speed} kts</span></div>
                      <div className="text-amber-700">Active Fault: {stats.fault}</div>
                      {!isSelected && (
                        <button
                          onClick={() => setSelectedUnit(uId)}
                          className="mt-2 w-full py-1 text-[10px] bg-sky-600 hover:bg-sky-700 text-white font-bold rounded transition-colors shadow-xs"
                        >
                          SELECT & REPLAN TRAJECTORY →
                        </button>
                      )}
                    </div>
                  </Popup>
                </Marker>
              );
            })}
          </MapContainer>
        </div>

        {/* Bottom Tactical Map Legend */}
        <div className="absolute bottom-3 left-3 z-[1000] flex flex-wrap items-center gap-3 bg-white/95 border border-slate-200 px-3 py-1.5 rounded-lg text-[11px] font-mono backdrop-blur-md shadow-md text-slate-700">
          <div className="flex items-center gap-1.5 text-red-600 font-bold">
            <span className="w-3.5 h-1 bg-red-600 inline-block border-t border-b border-slate-900"></span> INDO-PAK BORDER (IB)
          </div>
          <div className="flex items-center gap-1.5 text-slate-600 font-medium">
            <span className="w-3 h-1 bg-sky-600 inline-block rounded"></span> Nominal Flight Path
          </div>
          <div className="flex items-center gap-1.5 text-slate-600 font-medium">
            <span className="w-3 h-1 bg-amber-500 inline-block border-t border-dashed"></span> RL Recalculated RTB Route
          </div>
          <div className="flex items-center gap-1.5 text-slate-600 font-medium">
            <span className={`w-2.5 h-2.5 rounded-full border inline-block ${fcsState?.ap_mode === 'EMERGENCY_GLIDE' || fcsState?.engine_out ? 'border-red-500 bg-red-100' : 'border-emerald-600 bg-emerald-50'}`}></span> Glide Footprint ({fcsState?.glide_range_m && fcsState.glide_range_m > 0 ? (fcsState.glide_range_m / 1852).toFixed(1) : rlSolution.metrics.glideConeRadiusNm} NM)
          </div>
          <div className="flex items-center gap-1.5 text-slate-700 border-l border-slate-200 pl-3 font-semibold">
            <span className="text-sky-700 font-bold">SWARM ASSETS:</span> 5 UNITS (4 PATROL · 1 HANGAR)
          </div>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          2. RIGHT CONTROL PANEL: RL Policy Engine & Real-Time Commands
         ───────────────────────────────────────────────────────────── */}
      <div className="w-full lg:w-[420px] gcs-panel rounded-lg border border-slate-200 bg-white p-4 flex flex-col gap-4 overflow-y-auto custom-scrollbar shadow-xs">
        
        {/* Panel Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-md bg-sky-50 border border-sky-200 text-sky-600 shadow-xs">
              <Compass className="w-4 h-4 text-sky-600" />
            </div>
            <div>
              <h3 className="font-display font-bold text-sm tracking-wider text-slate-900 uppercase">
                RL POLICY CONTROLLER
              </h3>
              <p className="text-[10px] font-mono text-slate-500 font-medium">PPO CL-TRAJECTORY OPTIMIZER v2.4</p>
            </div>
          </div>
          <button
            onClick={handleRecalculate}
            disabled={isSolving}
            className="px-2.5 py-1.5 rounded-md bg-white border border-slate-200 text-slate-700 hover:text-slate-900 hover:bg-slate-50 transition-colors flex items-center gap-1.5 text-xs font-mono font-bold shadow-xs"
            title="Force RL policy re-solve"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-sky-600 ${isSolving ? 'animate-spin' : ''}`} />
            SOLVE
          </button>
        </div>

        {/* 1. Interactive Replanning Controls */}
        <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50 flex flex-col gap-2.5 shadow-2xs">
          <div className="text-[10px] font-mono text-slate-600 font-bold uppercase tracking-wider flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-sky-700">
              <Sliders className="w-3.5 h-3.5" /> REPLANNER OPERATING MODE
            </span>
            <span className="text-[9px] bg-white text-slate-600 px-1.5 py-0.5 rounded border border-slate-200 font-semibold shadow-2xs">POLICY STATE</span>
          </div>

          <div className="grid grid-cols-3 gap-1 text-[10px]">
            {[
              { id: 'AUTO', label: 'AUTO EVENT' },
              { id: 'FORCE_SIMULATION', label: 'SIMULATE DIVERT' },
              { id: 'CONTINGENCY_PREVIEW', label: 'PREVIEW PATH' }
            ].map(m => (
              <button
                key={m.id}
                onClick={() => setReplanMode(m.id)}
                className={`py-1.5 px-1 rounded-md border font-bold text-center transition-all ${
                  replanMode === m.id
                    ? 'bg-sky-600 text-white border-sky-600 shadow-xs'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:text-slate-900'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Divert Recovery Field Selector */}
          <div className="flex flex-col gap-1 text-xs">
            <span className="text-[10px] text-slate-500 font-semibold">TARGET RECOVERY AIRFIELD:</span>
            <select
              value={selectedAirfieldId}
              onChange={e => setSelectedAirfieldId(e.target.value)}
              className="bg-white border border-slate-200 rounded-md px-2.5 py-1.5 text-xs text-slate-900 font-mono font-medium focus:outline-none focus:border-sky-500 shadow-xs"
            >
              <option value="AUTO">★ AUTO (RL Policy Optimal Selection)</option>
              {AIRFIELDS.map(f => (
                <option key={f.id} value={f.id}>
                  {f.shortName} ({calcDistNm(unitGeo.coords[0], unitGeo.coords[1], f.coords[0], f.coords[1]).toFixed(1)} NM) · {f.type}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 2. Closed-Loop Command Panel */}
        <div className={`p-3 rounded-lg border flex flex-col gap-2 shadow-xs ${
          isCritical || isSimulating
            ? 'bg-red-50/70 border-red-200'
            : isDegraded || isPreview
            ? 'bg-amber-50/70 border-amber-200'
            : 'bg-emerald-50/50 border-emerald-200'
        }`}>
          <div className="text-xs font-mono font-bold flex items-center justify-between">
            <span className={isCritical || isSimulating ? 'text-red-700' : isDegraded ? 'text-amber-700' : 'text-emerald-700'}>
              CLOSED-LOOP FADEC COMMANDS
            </span>
            <span className="text-[10px] bg-white border border-slate-200 px-1.5 py-0.5 rounded text-slate-600 font-bold shadow-2xs">
              {isGrounded ? 'GROUNDED' : isDerateEngaged ? 'ENGAGED' : 'STANDBY'}
            </span>
          </div>

          <div className="flex flex-col gap-1.5 text-xs font-mono">
            <div className="flex items-center justify-between bg-white p-2 rounded-md border border-slate-200 shadow-2xs">
              <span className="text-slate-500 font-medium">COMMANDED THROTTLE:</span>
              <span className="font-bold text-slate-900">
                {isGrounded 
                  ? '0.0% (ENGINE OFF)' 
                  : `${rlSolution.recommendedThrottle.toFixed(1)}% ${isCritical || isSimulating ? '(DERATED CRUISE)' : isDegraded ? '(POWER DERATE)' : '(NOMINAL)'}`}
              </span>
            </div>

            <div className="flex items-center justify-between bg-white p-2 rounded-md border border-slate-200 shadow-2xs">
              <span className="text-slate-500 font-medium">TARGET RECOVERY FIELD:</span>
              <span className="font-bold text-sky-700 truncate max-w-[200px]" title={rlSolution.destination.name}>
                {rlSolution.destination.shortName} ({rlSolution.distNm} NM) {!isCritical && !isDegraded && !isSimulating && !isGrounded ? '[CONTINGENCY]' : ''}
              </span>
            </div>

            <div className="flex items-center justify-between bg-white p-2 rounded-md border border-slate-200 shadow-2xs">
              <span className="text-slate-500 font-medium">DESCENT RATE PROFILE:</span>
              <span className="font-bold text-slate-900">
                {isGrounded
                  ? '0 FPM (ON GROUND)'
                  : `${rlSolution.recommendedClimbFpm} FPM ${rlSolution.recommendedClimbFpm < 0 ? '(GLIDE DESCENT)' : '(LEVEL CRUISE)'}`}
              </span>
            </div>

            <div className="flex items-center justify-between bg-white p-2 rounded-md border border-slate-200 shadow-2xs">
              <span className="text-slate-500 font-medium">EST. TIME TO TOUCHDOWN:</span>
              <span className="font-bold text-emerald-700">
                {isGrounded ? '0.0 MINUTES (ON GROUND)' : `${rlSolution.flightTimeMin} MINUTES`}
              </span>
            </div>

            <div className="flex items-center justify-between bg-white p-2 rounded-md border border-slate-200 shadow-2xs">
              <span className="text-slate-500 font-medium">FUEL FLOW TARGET:</span>
              <span className="font-bold text-amber-700">
                {rlSolution.fuelFlowLph.toFixed(1)} L/h
              </span>
            </div>
          </div>

          {/* Action Button: Execute Derate */}
          <button
            onClick={isGrounded ? undefined : handleEngageDerate}
            disabled={isGrounded}
            className={`mt-2 py-2 px-3 rounded-md text-xs font-mono font-bold tracking-wider flex items-center justify-center gap-2 border transition-all ${
              isGrounded
                ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                : isDerateEngaged
                ? 'bg-emerald-600 border-emerald-600 text-white shadow-xs'
                : 'bg-sky-600 border-sky-600 text-white hover:bg-sky-700 shadow-xs'
            }`}
          >
            {isGrounded ? (
              <>
                <ShieldAlert className="w-4 h-4 text-red-600" /> AIRCRAFT GROUNDED — ENGINE SHUTDOWN
              </>
            ) : isDerateEngaged ? (
              <>
                <Check className="w-4 h-4" /> CLOSED-LOOP DERATE APPLIED TO FADEC
              </>
            ) : (
              <>
                <Send className="w-4 h-4" /> TRANSMIT RL DERATE COMMAND TO FADEC
              </>
            )}
          </button>

          {derateStatusMsg && (
            <div className="text-[10px] font-mono text-emerald-800 bg-emerald-50 border border-emerald-200 rounded p-2 text-center animate-pulse">
              ✓ {derateStatusMsg}
            </div>
          )}
        </div>

        {/* 3. Safety Margin & RL Policy Rewards */}
        <div className="bg-white p-3 rounded-lg border border-slate-200 flex flex-col gap-2.5 shadow-xs">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-slate-500 font-semibold">RUL / FLIGHT TIME MARGIN:</span>
            <span className={`font-bold ${isGrounded ? 'text-slate-400' : rlSolution.safetyMarginRatio < 2.0 ? 'text-red-600' : rlSolution.safetyMarginRatio < 5.0 ? 'text-amber-600' : 'text-emerald-600'}`}>
              {isGrounded ? 'N/A (GROUNDED)' : rlSolution.safetyMarginRatio > 99 ? '>99x (EXCESS)' : `${rlSolution.safetyMarginRatio}x (SAFE MARGIN)`}
            </span>
          </div>

          <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden border border-slate-200">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isGrounded ? 'bg-slate-400' : rlSolution.safetyMarginRatio < 2.0 ? 'bg-red-500' : rlSolution.safetyMarginRatio < 5.0 ? 'bg-amber-500' : 'bg-emerald-500'
              }`}
              style={{ width: `${isGrounded ? 100 : Math.min(100, Math.max(10, (rlSolution.safetyMarginRatio / 10.0) * 100))}%` }}
            />
          </div>

          {/* RL Policy Performance Badges */}
          <div className="grid grid-cols-2 gap-2 text-[10px] mt-1">
            <div className="bg-slate-50 p-2 rounded-md border border-slate-200 shadow-2xs">
              <span className="text-slate-500 font-semibold block">{isGrounded ? 'IN-FLIGHT CRASH RISK:' : 'SURVIVABILITY:'}</span>
              <span className="text-emerald-700 font-bold text-xs">
                {isGrounded ? '0.0%' : `${rlSolution.metrics.survivabilityPct}%`}
              </span>
              <span className="text-[8.5px] block text-slate-500">
                {isGrounded ? '(RAMP SECURED)' : rlSolution.metrics.survivabilityPct > 99.5 ? '(OPTIMAL ENVELOPE)' : '(CONTROLLED RECOVERY)'}
              </span>
            </div>

            <div className="bg-slate-50 p-2 rounded-md border border-slate-200 shadow-2xs">
              <span className="text-slate-500 font-semibold block">{isGrounded ? 'DEGRADATION RATE:' : 'CYCLE LIFE PRESERVED:'}</span>
              <span className="text-sky-700 font-bold text-xs">
                {isGrounded ? '0.0%/hr' : `+${rlSolution.metrics.cyclePreservationPct}%`}
              </span>
              <span className="text-[8.5px] block text-slate-500">
                {isGrounded ? '(ENGINE SHUTDOWN)' : isCritical || isDegraded ? '(THERMAL STRESS REDUCED)' : '(NOMINAL EFFICIENCY)'}
              </span>
            </div>

            <div className="bg-slate-50 p-2 rounded-md border border-slate-200 shadow-2xs">
              <span className="text-slate-500 font-semibold block">GLIDE CONE REACH:</span>
              <span className={`font-bold text-xs ${isGrounded ? 'text-slate-400' : 'text-amber-700'}`}>
                {isGrounded ? 'N/A' : `${rlSolution.metrics.glideConeRadiusNm} NM`}
              </span>
              <span className="text-[8.5px] block text-slate-500">
                {isGrounded ? '(WHEELS CHOCKED)' : '(@ 12:1 GLIDE RATIO)'}
              </span>
            </div>

            <div className="bg-slate-50 p-2 rounded-md border border-slate-200 shadow-2xs">
              <span className="text-slate-500 font-semibold block">GLIDE MARGIN:</span>
              <span className={`font-bold text-xs ${isGrounded ? 'text-slate-400' : rlSolution.metrics.glideMarginNm >= 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
                {isGrounded ? 'N/A' : rlSolution.metrics.glideMarginNm > 0 ? `+${rlSolution.metrics.glideMarginNm} NM` : `${rlSolution.metrics.glideMarginNm} NM`}
              </span>
              <span className="text-[8.5px] block text-slate-500">
                {isGrounded ? '(GROUNDED)' : rlSolution.metrics.glideMarginNm >= 0 ? '(DEAD-STICK GLIDE SAFE)' : '(POWER-ASSIST REQUIRED)'}
              </span>
            </div>
          </div>
        </div>

        {/* 4. Optimized Waypoint Flight Plan Table */}
        <div className="bg-white p-3 rounded-lg border border-slate-200 flex flex-col gap-2 shadow-xs">
          <div className="text-[10px] font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-sky-700">
              <Layers className="w-3.5 h-3.5" /> {isGrounded ? 'GROUND DISPATCH & ISOLATION STATUS' : `WAYPOINT FLIGHT PROFILE (${rlSolution.waypoints.length} PTS)`}
            </span>
            <span className="text-[9px] text-slate-500 font-semibold">{rlSolution.destination.shortName}</span>
          </div>

          {isGrounded ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs font-mono flex flex-col gap-1.5 shadow-2xs">
              <div className="flex items-center justify-between text-red-700 font-bold text-[11px] border-b border-red-200/80 pb-1">
                <span className="flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4 text-red-600" /> RED-X GROUNDING ORDER
                </span>
                <span className="text-[9px] bg-red-100 text-red-800 border border-red-300 px-1.5 py-0.5 rounded font-bold">STANAG 4671</span>
              </div>
              <div className="text-slate-700 text-[10px]">LOCATION: <span className="font-bold text-slate-900">AFS Uttarlai — Hangar Bay 3 (Concrete Ramp)</span></div>
              <div className="text-slate-700 text-[10px]">CRITICAL FAULT: <span className="font-bold text-red-700">OIL_PUMP_CAVITATION (RUL: 120.0h)</span></div>
              <div className="text-slate-700 text-[10px]">FADEC STATUS: <span className="font-bold text-sky-700">ECU LOCKOUT / INJECTION DISABLED</span></div>
              <div className="text-slate-600 text-[9px] mt-1 pt-1 border-t border-red-200/80 font-medium">
                * Flight operations suspended pending depot-level mechanical oil scavenge pump replacement and hydrodynamic lubrication loop flush.
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[10px] border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-600 font-bold">
                    <th className="py-1.5 px-2">WP</th>
                    <th className="py-1.5 px-2">ALTITUDE</th>
                    <th className="py-1.5 px-2">SPEED</th>
                    <th className="py-1.5 px-2">DIST</th>
                    <th className="py-1.5 px-2 text-right">ETA</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rlSolution.waypoints.map(w => (
                    <tr key={w.id} className="hover:bg-slate-50/80">
                      <td className="py-1.5 px-2 font-bold text-sky-700">{w.name}</td>
                      <td className="py-1.5 px-2 text-slate-700">{w.altitudeFt.toLocaleString()} ft</td>
                      <td className="py-1.5 px-2 text-slate-700">{w.airspeedKts} kts</td>
                      <td className="py-1.5 px-2 text-slate-500">{w.distRemainingNm} NM</td>
                      <td className="py-1.5 px-2 text-right font-bold text-emerald-700">+{w.etaMin}m</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
