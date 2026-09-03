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
  const { telemetry, aiPrognostics } = useTelemetry();
  
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
  const unitGeo = FLEET_GEO[selectedUnit] || FLEET_GEO['Vahak-1'];
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
  const isReplannerActive = isCritical || isDegraded || isSimulating || isPreview || isDerateEngaged;

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
        chosenField = sortedByDist[0]; // AFS Jaisalmer for Vahak-4
      } else {
        // Nominal: auto-assign to the nearest primary air base in sector
        if (selectedUnit === 'Vahak-2') {
          // Sector South naturally recovers to AFS Uttarlai
          chosenField = candidateDistances.find(f => f.id === 'AFS_UTTARLAI') || candidateDistances[0];
        } else if (selectedUnit === 'Vahak-3') {
          // Relay Orbit FL180 nearest to Jaisalmer
          chosenField = candidateDistances.find(f => f.id === 'AFS_JAISALMER') || candidateDistances[0];
        } else {
          // Vahak-1 nearest to Jaisalmer
          chosenField = candidateDistances.find(f => f.id === 'AFS_JAISALMER') || candidateDistances[0];
        }
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
      policyLabel = isDerateEngaged ? 'CLOSED-LOOP DERATE APPLIED TO FADEC' : 'CONTINGENCY ENVELOPE PREVIEW';
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
    lastReplanTime
  ]);

  // Recalculate Trigger
  const handleRecalculate = () => {
    setIsSolving(true);
    setTimeout(() => {
      setLastReplanTime(Date.now());
      setIsSolving(false);
    }, 450);
  };

  // Engage Derate Trigger
  const handleEngageDerate = () => {
    setIsDerateEngaged(true);
    setTimeout(() => setIsDerateEngaged(false), 8000);
  };

  return (
    <div className="flex flex-col lg:flex-row gap-3.5 h-[calc(100vh-140px)] w-full text-slate-100 font-mono">
      
      {/* ─────────────────────────────────────────────────────────────
          1. LEFT MAP CANVAS: Tactical Leaflet Display & Visual Overlays
         ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 relative starship-glass rounded-xl overflow-hidden flex flex-col min-h-[480px] border border-white/[0.08] shadow-starship-glass">
        
        {/* Top Header Control Banner */}
        <div className="absolute top-3 left-3 right-3 z-[1000] flex flex-wrap items-center justify-between gap-2 pointer-events-none">
          <div className="flex flex-wrap items-center gap-2 pointer-events-auto">
            {/* Title Badge */}
            <div className="px-3.5 py-1.5 bg-slate-950/90 border border-white/[0.08] rounded-xl text-xs font-mono text-cyan-300 flex items-center gap-2 backdrop-blur-xl shadow-lg">
              <Navigation className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
              <span className="font-bold tracking-wider">RL AUTONOMOUS REPLANNER</span>
            </div>

            {/* Decision Status Badge */}
            <div className={`px-3.5 py-1.5 rounded-xl text-xs font-mono font-bold flex items-center gap-2 backdrop-blur-xl shadow-lg border ${
              isCritical || isSimulating
                ? 'bg-red-950/90 border-red-500/80 text-red-200 animate-pulse shadow-hud-red'
                : isDegraded || isPreview
                ? 'bg-amber-950/90 border-amber-500/80 text-amber-200 shadow-hud-amber'
                : 'bg-emerald-950/90 border-emerald-500/60 text-emerald-200 shadow-hud-green'
            }`}>
              <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
              <span>RL DECISION: {rlSolution.label}</span>
            </div>
          </div>

          {/* Unit Switcher Pills on Map */}
          <div className="flex items-center gap-1 bg-slate-950/90 p-1 rounded-xl border border-white/[0.08] backdrop-blur-xl pointer-events-auto shadow-lg text-[10px]">
            {['Vahak-1', 'Vahak-2', 'Vahak-3', 'Vahak-4', 'Vahak-5'].map(u => (
              <button
                key={u}
                onClick={() => setSelectedUnit(u)}
                className={`px-2.5 py-1 rounded-lg transition-all font-bold ${
                  selectedUnit === u
                    ? 'bg-cyan-400 text-black shadow-[0_0_10px_rgba(0,240,255,0.6)]'
                    : 'text-slate-400 hover:text-white hover:bg-white/[0.05]'
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
            style={{ height: '100%', width: '100%', minHeight: '480px', background: '#030712' }}
            zoomControl={false}
          >
            {/* Automatic Size Invalidation for Tab Switching */}
            <MapResizer />

            {/* Dark Tactical Map Tiles (Free OpenStreetMap with Tactical HUD Inversion Filter) */}
            <TileLayer
              attribution='&copy; OpenStreetMap contributors'
              url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            {/* 1. Dark Bold Indo-Pak International Border (IB) Line */}
            {/* Outer heavy black contrast stroke */}
            <Polyline
              positions={INDO_PAK_BORDER}
              pathOptions={{
                color: '#000000',
                weight: 7,
                opacity: 0.95,
                lineCap: 'round',
                lineJoin: 'round'
              }}
            />
            {/* Inner high-visibility red dashed border line */}
            <Polyline
              positions={INDO_PAK_BORDER}
              pathOptions={{
                color: '#EF4444',
                weight: 3.5,
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
              pathOptions={{ color: '#00F0FF', weight: 1.5, dashArray: '6, 6', fillOpacity: 0.02 }}
            />

            {/* Nominal Flight Plan (Cyan Polyline) */}
            <Polyline
              positions={unitGeo.nominalPath}
              pathOptions={{ color: '#00F0FF', weight: 2.5, opacity: 0.6 }}
            />

            {/* RL Autonomous Recalculated Flight Plan (Amber / Red Dotted) */}
            {isReplannerActive && (
              <Polyline
                positions={rlSolution.routePolyline}
                pathOptions={{
                  color: isCritical || isSimulating ? '#EF4444' : '#F59E0B',
                  weight: 4,
                  dashArray: '8, 8',
                  opacity: 0.95
                }}
              />
            )}

            {/* Safe Glide Cone Reachability Footprint */}
            <Circle
              center={unitGeo.coords}
              radius={rlSolution.metrics.glideConeRadiusNm * 1852} // Convert NM to meters
              pathOptions={{
                color: isCritical || isSimulating ? '#EF4444' : '#10B981',
                fillColor: isCritical || isSimulating ? '#EF4444' : '#10B981',
                fillOpacity: 0.05,
                weight: 1.5,
                dashArray: '5, 5'
              }}
            />

            {/* Airfield Markers */}
            {AIRFIELDS.map(f => (
              <Marker key={f.id} position={f.coords} icon={f.icon}>
                <Popup>
                  <div className="text-xs font-mono">
                    <div className="font-bold text-hud-cyan">{f.name}</div>
                    <div className="text-slate-300">Elev: {f.altFt} ft | Rwy: {f.rwyLengthFt} ft</div>
                    <div className="text-amber-400 font-bold mt-1">
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
                    <div className="font-bold text-sky-400">{wp.name} (#{wp.id})</div>
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
                  position={geo.coords}
                  icon={createSwarmUavIcon(uId, stats.status, isSelected)}
                  eventHandlers={{
                    click: () => setSelectedUnit(uId)
                  }}
                >
                  <Popup>
                    <div className="text-xs font-mono">
                      <div className="font-bold text-hud-cyan flex items-center justify-between gap-2">
                        <span>{geo.callsign}</span>
                        {isSelected && <span className="text-[9px] bg-hud-cyan text-black px-1 rounded font-bold">FOCUSED</span>}
                      </div>
                      <div className="text-slate-300 mt-1">Status: <span className={stats.statusColor}>{stats.status}</span> ({stats.desc})</div>
                      <div>Health: <span className="font-bold text-white">{stats.health}%</span> | RUL: <span className="font-bold text-white">{stats.rul} hrs</span></div>
                      <div>Altitude: <span className="font-bold text-white">{stats.altitude.toLocaleString()} ft</span> | Speed: <span className="font-bold text-white">{stats.speed} kts</span></div>
                      <div className="text-amber-400">Active Fault: {stats.fault}</div>
                      {!isSelected && (
                        <button
                          onClick={() => setSelectedUnit(uId)}
                          className="mt-2 w-full py-1 text-[10px] bg-hud-cyan hover:bg-hud-cyan/80 text-black font-bold rounded transition-colors"
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
        <div className="absolute bottom-3 left-3 z-[1000] flex flex-wrap items-center gap-3 bg-black/85 border border-slate-700/80 px-3 py-1.5 rounded-lg text-[11px] font-mono backdrop-blur-md shadow-lg">
          <div className="flex items-center gap-1.5 text-red-400 font-bold">
            <span className="w-3.5 h-1 bg-red-500 inline-block border-t border-b border-black"></span> INDO-PAK BORDER (IB)
          </div>
          <div className="flex items-center gap-1.5 text-slate-300">
            <span className="w-3 h-1 bg-hud-cyan inline-block rounded"></span> Nominal Flight Path
          </div>
          <div className="flex items-center gap-1.5 text-slate-300">
            <span className="w-3 h-1 bg-amber-400 inline-block border-t border-dashed"></span> RL Recalculated RTB Route
          </div>
          <div className="flex items-center gap-1.5 text-slate-300">
            <span className="w-2.5 h-2.5 rounded-full border border-emerald-400 inline-block"></span> Glide Footprint ({rlSolution.metrics.glideConeRadiusNm} NM)
          </div>
          <div className="flex items-center gap-1.5 text-slate-300 border-l border-slate-700 pl-3">
            <span className="text-hud-cyan font-bold">SWARM ASSETS:</span> 5 UNITS (4 PATROL · 1 HANGAR)
          </div>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          2. RIGHT CONTROL PANEL: RL Policy Engine & Real-Time Commands
         ───────────────────────────────────────────────────────────── */}
      <div className="w-full lg:w-[420px] starship-glass rounded-xl border border-white/[0.08] p-4 flex flex-col gap-4 overflow-y-auto custom-scrollbar shadow-starship-glass">
        
        {/* Panel Header */}
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-400/40 text-cyan-300">
              <Compass className="w-4 h-4 text-cyan-400" />
            </div>
            <div>
              <h3 className="font-display font-black text-sm tracking-wider text-cyan-300 glow-cyan">
                RL POLICY CONTROLLER
              </h3>
              <p className="text-[10px] font-mono text-slate-400">PPO CL-TRAJECTORY OPTIMIZER v2.4</p>
            </div>
          </div>
          <button
            onClick={handleRecalculate}
            disabled={isSolving}
            className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-white/[0.08] text-cyan-300 hover:bg-slate-800 hover:border-cyan-400/50 transition-colors flex items-center gap-1.5 text-xs font-mono font-bold shadow-sm"
            title="Force RL policy re-solve"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${isSolving ? 'animate-spin' : ''}`} />
            SOLVE
          </button>
        </div>

        {/* 1. Interactive Replanning Controls */}
        <div className="starship-glass-card p-3.5 rounded-xl border border-white/[0.08] flex flex-col gap-2.5">
          <div className="text-[10px] font-mono text-slate-400 font-bold uppercase tracking-wider flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-hud-cyan">
              <Sliders className="w-3.5 h-3.5" /> REPLANNER OPERATING MODE
            </span>
            <span className="text-[9px] bg-slate-900 text-slate-400 px-1 rounded">POLICY STATE</span>
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
                className={`py-1.5 px-1 rounded border font-bold text-center transition-all ${
                  replanMode === m.id
                    ? 'bg-hud-cyan text-black border-hud-cyan shadow-sm'
                    : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-slate-700'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Divert Recovery Field Selector */}
          <div className="flex flex-col gap-1 text-xs">
            <span className="text-[10px] text-slate-400">TARGET RECOVERY AIRFIELD:</span>
            <select
              value={selectedAirfieldId}
              onChange={e => setSelectedAirfieldId(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-hud-cyan font-mono focus:outline-none focus:border-hud-cyan"
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
        <div className={`p-3 rounded border flex flex-col gap-2 ${
          isCritical || isSimulating
            ? 'bg-red-950/30 border-red-500/50'
            : isDegraded || isPreview
            ? 'bg-amber-950/30 border-amber-500/50'
            : 'bg-emerald-950/20 border-emerald-500/30'
        }`}>
          <div className="text-xs font-mono font-bold flex items-center justify-between">
            <span className={isCritical || isSimulating ? 'text-red-400' : isDegraded ? 'text-amber-400' : 'text-emerald-400'}>
              CLOSED-LOOP FADEC COMMANDS
            </span>
            <span className="text-[10px] bg-black/60 px-1.5 py-0.5 rounded text-slate-400">
              {isGrounded ? 'GROUNDED' : isDerateEngaged ? 'ENGAGED' : 'STANDBY'}
            </span>
          </div>

          <div className="flex flex-col gap-1.5 text-xs font-mono">
            <div className="flex items-center justify-between bg-slate-900/90 p-2 rounded border border-slate-800">
              <span className="text-slate-400">COMMANDED THROTTLE:</span>
              <span className="font-bold text-white">
                {isGrounded 
                  ? '0.0% (ENGINE OFF)' 
                  : `${rlSolution.recommendedThrottle.toFixed(1)}% ${isCritical || isSimulating ? '(DERATED CRUISE)' : isDegraded ? '(POWER DERATE)' : '(NOMINAL)'}`}
              </span>
            </div>

            <div className="flex items-center justify-between bg-slate-900/90 p-2 rounded border border-slate-800">
              <span className="text-slate-400">TARGET RECOVERY FIELD:</span>
              <span className="font-bold text-hud-cyan truncate max-w-[200px]" title={rlSolution.destination.name}>
                {rlSolution.destination.shortName} ({rlSolution.distNm} NM) {!isCritical && !isDegraded && !isSimulating && !isGrounded ? '[CONTINGENCY]' : ''}
              </span>
            </div>

            <div className="flex items-center justify-between bg-slate-900/90 p-2 rounded border border-slate-800">
              <span className="text-slate-400">DESCENT RATE PROFILE:</span>
              <span className="font-bold text-white">
                {isGrounded
                  ? '0 FPM (ON GROUND)'
                  : `${rlSolution.recommendedClimbFpm} FPM ${rlSolution.recommendedClimbFpm < 0 ? '(GLIDE DESCENT)' : '(LEVEL CRUISE)'}`}
              </span>
            </div>

            <div className="flex items-center justify-between bg-slate-900/90 p-2 rounded border border-slate-800">
              <span className="text-slate-400">EST. TIME TO TOUCHDOWN:</span>
              <span className="font-bold text-emerald-400">
                {isGrounded ? '0.0 MINUTES (ON GROUND)' : `${rlSolution.flightTimeMin} MINUTES`}
              </span>
            </div>

            <div className="flex items-center justify-between bg-slate-900/90 p-2 rounded border border-slate-800">
              <span className="text-slate-400">FUEL FLOW TARGET:</span>
              <span className="font-bold text-amber-400">
                {rlSolution.fuelFlowLph.toFixed(1)} L/h
              </span>
            </div>
          </div>

          {/* Action Button: Execute Derate */}
          <button
            onClick={isGrounded ? undefined : handleEngageDerate}
            disabled={isGrounded}
            className={`mt-2 py-2 px-3 rounded text-xs font-mono font-bold tracking-wider flex items-center justify-center gap-2 border transition-all ${
              isGrounded
                ? 'bg-slate-900 border-slate-700 text-slate-500 cursor-not-allowed'
                : isDerateEngaged
                ? 'bg-emerald-950 border-emerald-500 text-emerald-400'
                : 'bg-hud-cyan/15 border-hud-cyan text-hud-cyan hover:bg-hud-cyan hover:text-black shadow-sm'
            }`}
          >
            {isGrounded ? (
              <>
                <ShieldAlert className="w-4 h-4 text-red-400" /> AIRCRAFT GROUNDED — ENGINE SHUTDOWN
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
        </div>

        {/* 3. Safety Margin & RL Policy Rewards */}
        <div className="bg-slate-950 p-3 rounded border border-slate-800 flex flex-col gap-2.5">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-slate-400">RUL / FLIGHT TIME MARGIN:</span>
            <span className={`font-bold ${isGrounded ? 'text-slate-400' : rlSolution.safetyMarginRatio < 2.0 ? 'text-red-400' : rlSolution.safetyMarginRatio < 5.0 ? 'text-amber-400' : 'text-emerald-400'}`}>
              {isGrounded ? 'N/A (GROUNDED)' : rlSolution.safetyMarginRatio > 99 ? '>99x (EXCESS)' : `${rlSolution.safetyMarginRatio}x (SAFE MARGIN)`}
            </span>
          </div>

          <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden border border-slate-800">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isGrounded ? 'bg-slate-700' : rlSolution.safetyMarginRatio < 2.0 ? 'bg-red-500' : rlSolution.safetyMarginRatio < 5.0 ? 'bg-amber-500' : 'bg-emerald-500'
              }`}
              style={{ width: `${isGrounded ? 100 : Math.min(100, Math.max(10, (rlSolution.safetyMarginRatio / 10.0) * 100))}%` }}
            />
          </div>

          {/* RL Policy Performance Badges */}
          <div className="grid grid-cols-2 gap-2 text-[10px] mt-1">
            <div className="bg-slate-900/90 p-2 rounded border border-slate-800">
              <span className="text-slate-400 block">{isGrounded ? 'IN-FLIGHT CRASH RISK:' : 'SURVIVABILITY:'}</span>
              <span className="text-emerald-400 font-bold text-xs">
                {isGrounded ? '0.0%' : `${rlSolution.metrics.survivabilityPct}%`}
              </span>
              <span className="text-[8.5px] block text-slate-500">
                {isGrounded ? '(RAMP SECURED)' : rlSolution.metrics.survivabilityPct > 99.5 ? '(OPTIMAL ENVELOPE)' : '(CONTROLLED RECOVERY)'}
              </span>
            </div>

            <div className="bg-slate-900/90 p-2 rounded border border-slate-800">
              <span className="text-slate-400 block">{isGrounded ? 'DEGRADATION RATE:' : 'CYCLE LIFE PRESERVED:'}</span>
              <span className="text-hud-cyan font-bold text-xs">
                {isGrounded ? '0.0%/hr' : `+${rlSolution.metrics.cyclePreservationPct}%`}
              </span>
              <span className="text-[8.5px] block text-slate-500">
                {isGrounded ? '(ENGINE SHUTDOWN)' : isCritical || isDegraded ? '(THERMAL STRESS REDUCED)' : '(NOMINAL EFFICIENCY)'}
              </span>
            </div>

            <div className="bg-slate-900/90 p-2 rounded border border-slate-800">
              <span className="text-slate-400 block">GLIDE CONE REACH:</span>
              <span className={`font-bold text-xs ${isGrounded ? 'text-slate-400' : 'text-amber-400'}`}>
                {isGrounded ? 'N/A' : `${rlSolution.metrics.glideConeRadiusNm} NM`}
              </span>
              <span className="text-[8.5px] block text-slate-500">
                {isGrounded ? '(WHEELS CHOCKED)' : '(@ 12:1 GLIDE RATIO)'}
              </span>
            </div>

            <div className="bg-slate-900/90 p-2 rounded border border-slate-800">
              <span className="text-slate-400 block">GLIDE MARGIN:</span>
              <span className={`font-bold text-xs ${isGrounded ? 'text-slate-400' : rlSolution.metrics.glideMarginNm >= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                {isGrounded ? 'N/A' : rlSolution.metrics.glideMarginNm > 0 ? `+${rlSolution.metrics.glideMarginNm} NM` : `${rlSolution.metrics.glideMarginNm} NM`}
              </span>
              <span className="text-[8.5px] block text-slate-500">
                {isGrounded ? '(GROUNDED)' : rlSolution.metrics.glideMarginNm >= 0 ? '(DEAD-STICK GLIDE SAFE)' : '(POWER-ASSIST REQUIRED)'}
              </span>
            </div>
          </div>
        </div>

        {/* 4. Optimized Waypoint Flight Plan Table */}
        <div className="bg-slate-950 p-3 rounded border border-slate-800 flex flex-col gap-2">
          <div className="text-[10px] font-bold text-slate-300 uppercase tracking-wider flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-hud-cyan">
              <Layers className="w-3.5 h-3.5" /> {isGrounded ? 'GROUND DISPATCH & ISOLATION STATUS' : `WAYPOINT FLIGHT PROFILE (${rlSolution.waypoints.length} PTS)`}
            </span>
            <span className="text-[9px] text-slate-500">{rlSolution.destination.shortName}</span>
          </div>

          {isGrounded ? (
            <div className="bg-slate-900/80 border border-red-500/40 rounded p-3 text-xs font-mono flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-red-400 font-bold text-[11px] border-b border-slate-800 pb-1">
                <span className="flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4 text-red-400" /> RED-X GROUNDING ORDER
                </span>
                <span className="text-[9px] bg-red-950/80 text-red-300 border border-red-500/40 px-1.5 py-0.5 rounded">STANAG 4671</span>
              </div>
              <div className="text-slate-300 text-[10px]">LOCATION: <span className="font-bold text-white">AFS Uttarlai — Hangar Bay 3 (Concrete Ramp)</span></div>
              <div className="text-slate-300 text-[10px]">CRITICAL FAULT: <span className="font-bold text-red-400">OIL_PUMP_CAVITATION (RUL: 120.0h)</span></div>
              <div className="text-slate-300 text-[10px]">FADEC STATUS: <span className="font-bold text-hud-cyan">ECU LOCKOUT / INJECTION DISABLED</span></div>
              <div className="text-slate-400 text-[9px] mt-1 pt-1 border-t border-slate-800">
                * Flight operations suspended pending depot-level mechanical oil scavenge pump replacement and hydrodynamic lubrication loop flush.
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[10px] border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 font-bold">
                    <th className="py-1">WP</th>
                    <th className="py-1">ALTITUDE</th>
                    <th className="py-1">SPEED</th>
                    <th className="py-1">DIST</th>
                    <th className="py-1 text-right">ETA</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-900">
                  {rlSolution.waypoints.map(w => (
                    <tr key={w.id} className="hover:bg-slate-900/50">
                      <td className="py-1.5 font-bold text-sky-400">{w.name}</td>
                      <td className="py-1.5 text-slate-300">{w.altitudeFt.toLocaleString()} ft</td>
                      <td className="py-1.5 text-slate-300">{w.airspeedKts} kts</td>
                      <td className="py-1.5 text-slate-400">{w.distRemainingNm} NM</td>
                      <td className="py-1.5 text-right font-bold text-emerald-400">+{w.etaMin}m</td>
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
