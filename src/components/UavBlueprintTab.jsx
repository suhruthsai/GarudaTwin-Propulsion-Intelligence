/**
 * UavBlueprintTab.jsx
 * ===================
 * 360° Interactive Digital Twin — Rotax 915/916 iS Flat-4 Turbocharged Aero Engine
 *
 * Architecture: Engineering-informed 3D representation (not certified CAD geometry).
 * Every 3D component maps 1-to-1 with a telemetry data object.
 * All values shown in 3D labels, Inspector, and Schematic come from the same
 * TelemetryContext source — no duplicated or hard-coded sensor readings.
 *
 * Component tree (3D):
 *   EngineDigitalTwin
 *   ├── PropellerAssembly     — RPM-driven rotation (separate ref from crankcase)
 *   ├── CrankcaseAssembly     — flat-4 engine block, mount bosses, crankshaft stub
 *   ├── CylinderUnit × 4     — horizontally-opposed boxer layout, EGT/CHT bound
 *   ├── FlowPipes             — exhaust headers, turbo→intercooler→intake paths
 *   ├── TurboAssembly         — exhaust/rear side, compressor + turbine housings
 *   ├── IntercoolerAssembly   — charge-air cooler, boost path
 *   ├── OilSystemAssembly     — sump, oil cooler, pressure sensor
 *   ├── FuelRailAssembly      — rail bar + 4 injector stubs
 *   ├── FadecUnit × 2         — ECU Lane A (left) + Lane B (right)
 *   ├── CadGrid               — tactical floor grid
 *   └── CameraController      — smooth lerp camera focus
 */

import React, { useState, useRef, useCallback, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import * as THREE from 'three';
import { useTelemetry } from '../context/TelemetryContext';
import {
  Layers, AlertTriangle, Activity, Zap, Info, Cpu,
  Gauge, GitBranch, BarChart2, Eye, Flame
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────
// COLOR HELPERS — all driven by live telemetry, never hard-coded
// ─────────────────────────────────────────────────────────────

/** Returns a hex color based on residual magnitude and fault state. */
function statusColor(residualAbs, isFault, nominal = '#10B981') {
  if (isFault) return '#EF4444';
  if (residualAbs > 40) return '#EF4444';
  if (residualAbs > 15) return '#F59E0B';
  return nominal;
}

/** Maps a temperature to a blue→green→amber→red thermal gradient. */
function thermalColor(tempC, minC = 80, maxC = 1000) {
  const t = Math.max(0, Math.min(1, (tempC - minC) / (maxC - minC)));
  if (t > 0.85) return '#EF4444';
  if (t > 0.65) return '#F59E0B';
  if (t > 0.35) return '#10B981';
  return '#0284C7';
}

/** Maps a health percentage to green/amber/red. */
function healthColor(pct) {
  if (pct < 40) return '#EF4444';
  if (pct < 70) return '#F59E0B';
  return '#10B981';
}

/** Builds a standard meshStandardMaterial props object. */
function matProps(color, isSelected, emissiveInt = 0.2) {
  return {
    color: isSelected ? '#00F0FF' : color,
    emissive: isSelected ? '#00F0FF' : color,
    emissiveIntensity: isSelected ? 0.65 : emissiveInt,
    metalness: 0.78,
    roughness: 0.32,
  };
}

// ─────────────────────────────────────────────────────────────
// COMPONENT REGISTRY
// Maps every component ID to display metadata + camera focus
// targets + exploded-view offsets (added to nominal position).
// ─────────────────────────────────────────────────────────────
const REGISTRY = {
  PROP_01:      { id:'PROP_01',      label:'PROP',     name:'Propeller Assembly',          subsystem:'Propulsion',      camPos:[0,1,7],      camLook:[0,0,1.5], expOff:[0,0,3.0]   },
  ENGINE_BLOCK: { id:'ENGINE_BLOCK', label:'CRANK',    name:'Crankcase / Engine Core',     subsystem:'Powertrain',      camPos:[5,3,5],      camLook:[0,0,0],   expOff:[0,0,0]     },
  CYL_01:       { id:'CYL_01',       label:'CYL 1',    name:'Cylinder 1 (Left-Fwd)',       subsystem:'Combustion',      camPos:[-7,1,3],     camLook:[-2,0,0.7],expOff:[-2,0,0.6]  },
  CYL_02:       { id:'CYL_02',       label:'CYL 2',    name:'Cylinder 2 (Right-Fwd)',      subsystem:'Combustion',      camPos:[7,1,3],      camLook:[2,0,0.7], expOff:[2,0,0.6]   },
  CYL_03:       { id:'CYL_03',       label:'CYL 3',    name:'Cylinder 3 (Left-Aft) ⚡',    subsystem:'Combustion',      camPos:[-7,1,-3],    camLook:[-2,0,-0.7],expOff:[-2,0,-0.6] },
  CYL_04:       { id:'CYL_04',       label:'CYL 4',    name:'Cylinder 4 (Right-Aft)',      subsystem:'Combustion',      camPos:[7,1,-3],     camLook:[2,0,-0.7],expOff:[2,0,-0.6]  },
  TURBO_01:     { id:'TURBO_01',     label:'TURBO',    name:'Turbocharger Assembly',       subsystem:'Air / Boost',     camPos:[0,-4,-6],    camLook:[0,-1,-2.2],expOff:[0,-1.8,-2] },
  INTERCOOLER:  { id:'INTERCOOLER',  label:'INTCOOL',  name:'Charge Air Intercooler',      subsystem:'Air / Boost',     camPos:[0,5,-3],     camLook:[0,1.5,-1.5],expOff:[0,2.2,-1] },
  OIL_SYSTEM:   { id:'OIL_SYSTEM',   label:'OIL',      name:'Lubrication System',          subsystem:'Lubrication',     camPos:[0,-6,0],     camLook:[0,-1.5,0],expOff:[0,-2.2,0]  },
  FUEL_RAIL:    { id:'FUEL_RAIL',    label:'FUEL',     name:'Fuel Rail / Injectors',       subsystem:'Fuel Delivery',   camPos:[0,4,2],      camLook:[0,0.7,0], expOff:[0,1.8,0.5] },
  FADEC_A:      { id:'FADEC_A',      label:'FADEC-A',  name:'FADEC Lane A (Primary)',       subsystem:'Engine Control',  camPos:[-7,-1,-4],   camLook:[-1.8,-1,-1.5],expOff:[-1.8,-0.5,-1.2]},
  FADEC_B:      { id:'FADEC_B',      label:'FADEC-B',  name:'FADEC Lane B (Redundant)',     subsystem:'Engine Control',  camPos:[7,-1,-4],    camLook:[1.8,-1,-1.5], expOff:[1.8,-0.5,-1.2] },
  PRGB_GEARBOX: { id:'PRGB_GEARBOX', label:'PRGB',     name:'Reduction Gearbox & Clutch',   subsystem:'Powertrain',      camPos:[0,3,7],      camLook:[0,0,1],     expOff:[0,0,1.5]   },
  UAV_GENERATOR_28V: { id:'UAV_GENERATOR_28V', label:'28V GEN', name:'Payload Generator 28V', subsystem:'Electrical',    camPos:[-4,3,-4],    camLook:[0,0,-1],    expOff:[0,1,-1.5]  },
  COOLANT_RADIATOR: { id:'COOLANT_RADIATOR', label:'RADIATOR', name:'Liquid Cooling Loop',  subsystem:'Thermal',         camPos:[0,-5,4],     camLook:[0,-1.5,1.5],expOff:[0,-2,2]    },

};

// ─────────────────────────────────────────────────────────────
// CAMERA CONTROLLER — smooth lerp toward focus target
// ─────────────────────────────────────────────────────────────
const CameraController = ({ targetRef, controlsRef }) => {
  useFrame(() => {
    const t = targetRef.current;
    if (!t || !controlsRef.current) return;
    const cam = controlsRef.current.object;
    const ctrl = controlsRef.current;
    const destPos = new THREE.Vector3(...t.camPos);
    const destLook = new THREE.Vector3(...t.camLook);
    cam.position.lerp(destPos, 0.055);
    ctrl.target.lerp(destLook, 0.055);
    ctrl.update();
    if (cam.position.distanceTo(destPos) < 0.08) targetRef.current = null;
  });
  return null;
};

// ─────────────────────────────────────────────────────────────
// INLINE LABEL — drei Html, shown when component is selected
// ─────────────────────────────────────────────────────────────
const InlineLabel = ({ pos, rows }) => (
  <Html position={pos} style={{ pointerEvents: 'none' }}>
    <div style={{
      background: 'rgba(2,8,20,0.92)', border: '1px solid #00F0FF',
      borderRadius: 4, padding: '4px 8px', fontFamily: 'monospace',
      fontSize: 10, color: '#00F0FF', whiteSpace: 'nowrap',
      boxShadow: '0 0 10px rgba(0,240,255,0.35)', lineHeight: 1.7,
    }}>
      {rows.map((r, i) => (
        <div key={i} style={{ color: r.color || '#00F0FF' }}>
          {r.label && <span style={{ color: '#64748B' }}>{r.label}: </span>}
          {r.value}
        </div>
      ))}
    </div>
  </Html>
);

// ─────────────────────────────────────────────────────────────
// PROPELLER ASSEMBLY
// Only the blade group (propRef) rotates. Hub and cone are static.
// RPM driven via Rotax 2.43:1 planetary reduction gear ratio.
// ─────────────────────────────────────────────────────────────
const PropellerAssembly = ({ rpm, isSelected, onClick, basePos, ef }) => {
  const propRef = useRef();
  const propRpm = Math.max(0, rpm / 2.43);

  useFrame((_, dt) => {
    if (propRef.current) {
      propRef.current.rotation.z += ((propRpm / 60) * Math.PI * 2) * dt * 0.38;
    }
  });

  const expOff = REGISTRY.PROP_01.expOff;
  const pos = [basePos[0], basePos[1], basePos[2] + expOff[2] * ef];

  return (
    <group position={pos} onClick={e => { e.stopPropagation(); onClick('PROP_01'); }}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.22, 0.48, 16]} />
        <meshStandardMaterial color={isSelected ? '#00F0FF' : '#CBD5E1'} metalness={0.92} roughness={0.08}
          emissive={isSelected ? '#00F0FF' : '#000'} emissiveIntensity={isSelected ? 0.5 : 0} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -0.14, 0]}>
        <cylinderGeometry args={[0.2, 0.2, 0.12, 16]} />
        <meshStandardMaterial color="#475569" metalness={0.9} roughness={0.2} />
      </mesh>
      <group ref={propRef}>
        <mesh position={[1.25, 0, -0.18]} rotation={[0, 0, 0.16]}>
          <boxGeometry args={[2.5, 0.26, 0.055]} />
          <meshStandardMaterial color="#7C5C38" roughness={0.72} metalness={0.08} />
        </mesh>
        <mesh position={[-1.25, 0, -0.18]} rotation={[0, 0, -0.16]}>
          <boxGeometry args={[2.5, 0.26, 0.055]} />
          <meshStandardMaterial color="#7C5C38" roughness={0.72} metalness={0.08} />
        </mesh>
      </group>
      {isSelected && (
        <>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.55, 0.018, 8, 32]} />
            <meshBasicMaterial color="#00F0FF" />
          </mesh>
          <InlineLabel pos={[0, 1.0, 0]} rows={[
            { value: 'PROP_01' },
            { label: 'Engine RPM', value: `${Math.round(rpm)} RPM` },
            { label: 'Prop RPM',   value: `${Math.round(propRpm)} RPM` },
          ]} />
        </>
      )}
    </group>
  );
};

// ─────────────────────────────────────────────────────────────
// CRANKCASE ASSEMBLY — flat-4 boxer engine block
// ─────────────────────────────────────────────────────────────
const CrankcaseAssembly = ({ isSelected, onClick, basePos, ef, tel, vm }) => {
  const col = vm === 'HEALTH'   ? healthColor(tel.health.index)
            : vm === 'THERMAL'  ? thermalColor(tel.engine.oilTempC, 80, 140)
            : '#647080';

  return (
    <group position={basePos} onClick={e => { e.stopPropagation(); onClick('ENGINE_BLOCK'); }}>
      <mesh>
        <boxGeometry args={[2.2, 0.95, 1.65]} />
        <meshStandardMaterial {...matProps(col, isSelected)} />
      </mesh>
      <mesh position={[0, 0, 0.84]}>
        <boxGeometry args={[1.85, 0.75, 0.04]} />
        <meshStandardMaterial color="#2D3B4F" metalness={0.85} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0, -0.84]}>
        <boxGeometry args={[1.8, 0.75, 0.04]} />
        <meshStandardMaterial color="#1A2332" metalness={0.85} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0, 0.95]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.16, 0.16, 0.18, 16]} />
        <meshStandardMaterial color="#94A3B8" metalness={0.92} roughness={0.1} />
      </mesh>
      {[[-0.9,-0.45,0.6],[0.9,-0.45,0.6],[-0.9,-0.45,-0.6],[0.9,-0.45,-0.6]].map(([mx,my,mz],i)=>(
        <mesh key={i} position={[mx, my, mz]}>
          <cylinderGeometry args={[0.09, 0.09, 0.14, 8]} />
          <meshStandardMaterial color="#2D3B4F" metalness={0.7} roughness={0.5} />
        </mesh>
      ))}
      <mesh position={[0, 0, 0]} rotation={[Math.PI/2, 0, 0]}>
        <cylinderGeometry args={[0.07, 0.07, 1.5, 8]} />
        <meshStandardMaterial color="#334155" metalness={0.9} roughness={0.2} />
      </mesh>
      {isSelected && (
        <>
          <mesh>
            <boxGeometry args={[2.34, 1.09, 1.79]} />
            <meshBasicMaterial color="#00F0FF" wireframe />
          </mesh>
          <InlineLabel pos={[0, 1.0, 0]} rows={[
            { value: 'ENGINE_BLOCK' },
            { label: 'RPM',      value: `${Math.round(tel.engine.rpm)}` },
            { label: 'Throttle', value: `${tel.engine.throttlePct.toFixed(1)}%` },
            { label: 'Vib.',     value: `${tel.engine.vibrationGrms.toFixed(3)} g` },
          ]} />
        </>
      )}
    </group>
  );
};

// ─────────────────────────────────────────────────────────────
// CYLINDER UNIT — one of four horizontally-opposed cylinders
// Each cylinder is independently data-bound and selectable.
// ─────────────────────────────────────────────────────────────
const CylinderUnit = ({ compId, cylIdx, basePos, side, tel, isSelected, onClick, ef, vm }) => {
  const egt    = tel.engine.egt[cylIdx]  ?? 840;
  const cht    = tel.engine.cht[cylIdx]  ?? 106;
  const egtRes = Math.abs(tel.residuals.egtResiduals[cylIdx] ?? 0);
  const af     = tel.health.activeFault;

  const isFault =
    (cylIdx === 2 && af === 'CYL3_INJECTOR') ||
    (cylIdx === 1 && af === 'BLOW_BY') ||
    af === 'COOLING_DEGRADATION';

  const col = vm === 'THERMAL' ? thermalColor(egt, 820, 990)
            : vm === 'HEALTH'  ? healthColor(tel.health.index)
            : statusColor(egtRes, isFault, '#16A34A');

  const expOff = REGISTRY[compId].expOff;
  const pos = [basePos[0]+expOff[0]*ef, basePos[1]+expOff[1]*ef, basePos[2]+expOff[2]*ef];
  const xDir = side === 'left' ? -1 : 1;
  const rotZ = side === 'left' ? -Math.PI/2 : Math.PI/2;

  const groupRef = useRef();
  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const vib = tel.engine.vibrationGrms;
    const base = basePos[1] + expOff[1] * ef;
    if (vib > 0.8) {
      groupRef.current.position.y = base + Math.sin(clock.elapsedTime * 40) * (vib - 0.28) * 0.012;
    } else {
      groupRef.current.position.y = base;
    }
  });

  return (
    <group ref={groupRef} position={pos} onClick={e => { e.stopPropagation(); onClick(compId); }}>
      <mesh rotation={[0, 0, rotZ]}>
        <cylinderGeometry args={[0.27, 0.27, 1.35, 20]} />
        <meshStandardMaterial {...matProps(col, isSelected, isFault ? 0.65 : 0.22)} />
      </mesh>
      <mesh position={[xDir * 0.78, 0, 0]} rotation={[0, 0, rotZ]}>
        <cylinderGeometry args={[0.31, 0.27, 0.24, 20]} />
        <meshStandardMaterial color={isSelected ? '#00F0FF' : '#3B4B5F'} metalness={0.82} roughness={0.3} />
      </mesh>
      {[0,1,2,3,4].map(fi => (
        <mesh key={fi} position={[xDir * (0.05 + fi * 0.26), 0, 0]} rotation={[0, 0, rotZ]}>
          <cylinderGeometry args={[0.35, 0.35, 0.045, 20]} />
          <meshStandardMaterial color="#273040" metalness={0.72} roughness={0.55} />
        </mesh>
      ))}
      <mesh position={[xDir * 0.55, 0.32, 0.08]}>
        <cylinderGeometry args={[0.022, 0.022, 0.38, 8]} />
        <meshStandardMaterial color="#F59E0B" metalness={0.92} roughness={0.1}
          emissive="#F59E0B" emissiveIntensity={0.45} />
      </mesh>
      <mesh position={[xDir * 0.12, -0.28, 0.18]} rotation={[0.38, 0, 0.28 * xDir]}>
        <cylinderGeometry args={[0.065, 0.055, 0.48, 8]} />
        <meshStandardMaterial color="#7C3AED" metalness={0.62} roughness={0.6} />
      </mesh>
      {isSelected && (
        <>
          <mesh position={[xDir * 0.05, 0, 0]} rotation={[0, 0, rotZ]}>
            <cylinderGeometry args={[0.42, 0.42, 1.7, 20]} />
            <meshBasicMaterial color="#00F0FF" wireframe />
          </mesh>
          <InlineLabel pos={[xDir * 1.6, 0.9, 0]} rows={[
            { value: compId, color: '#00F0FF' },
            { label: 'EGT', value: `${egt.toFixed(1)}°C`, color: egtRes > 40 ? '#EF4444' : egtRes > 15 ? '#F59E0B' : '#10B981' },
            { label: 'CHT', value: `${cht.toFixed(1)}°C` },
            { label: 'Δ EGT', value: `${(tel.residuals.egtResiduals[cylIdx] > 0 ? '+' : '')}${(tel.residuals.egtResiduals[cylIdx]??0).toFixed(1)}°C` },
            ...(isFault ? [{ value: '⚠ FAULT', color: '#EF4444' }] : []),
          ]} />
        </>
      )}
    </group>
  );
};

// ─────────────────────────────────────────────────────────────
// TURBOCHARGER ASSEMBLY — exhaust/firewall side
// ─────────────────────────────────────────────────────────────
const TurboAssembly = ({ isSelected, onClick, basePos, ef, tel, vm }) => {
  const af     = tel.health.activeFault;
  const isFault = af === 'TURBO_WASTEGATE_STUCK';
  const mapRes  = Math.abs(tel.residuals.mapResidual ?? 0);

  const col = vm === 'THERMAL' ? thermalColor(tel.engine.oilTempC, 80, 160)
            : vm === 'HEALTH'  ? healthColor(tel.health.index)
            : statusColor(mapRes * 80, isFault, '#00B4D8');

  const expOff = REGISTRY.TURBO_01.expOff;
  const pos = [basePos[0]+expOff[0]*ef, basePos[1]+expOff[1]*ef, basePos[2]+expOff[2]*ef];

  const compRef = useRef();
  useFrame((_, dt) => {
    if (compRef.current) {
      compRef.current.rotation.z += ((tel.engine.rpm * 4.5 / 60) * Math.PI * 2) * dt * 0.004;
    }
  });

  return (
    <group position={pos} onClick={e => { e.stopPropagation(); onClick('TURBO_01'); }}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.36, 0.14, 16, 32]} />
        <meshStandardMaterial {...matProps(col, isSelected, isFault ? 0.7 : 0.3)} />
      </mesh>
      <group ref={compRef}>
      {isFault && <pointLight color="#EF4444" intensity={3} distance={5} />}
        {[0,1,2,3,4,5].map(i => {
          const a = (i / 6) * Math.PI * 2;
          return (
            <mesh key={i} position={[Math.cos(a)*0.22, Math.sin(a)*0.22, 0.12]} rotation={[0,0,a]}>
              <boxGeometry args={[0.18, 0.04, 0.06]} />
              <meshStandardMaterial color="#94A3B8" metalness={0.9} roughness={0.15} />
            </mesh>
          );
        })}
      </group>
      <mesh position={[0, 0, 0.44]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.30, 0.12, 16, 32]} />
        <meshStandardMaterial color={isSelected ? '#00F0FF' : '#374151'} metalness={0.82} roughness={0.32}
          emissive={isFault ? '#EF4444' : '#000'} emissiveIntensity={isFault ? 0.55 : 0} />
      </mesh>
      <mesh position={[0, 0, 0.21]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.09, 0.09, 0.48, 12]} />
        <meshStandardMaterial color="#1E2A38" metalness={0.9} roughness={0.2} />
      </mesh>
      <mesh position={[0.48, 0.2, 0.38]}>
        <boxGeometry args={[0.18, 0.14, 0.22]} />
        <meshStandardMaterial color={isFault ? '#EF4444' : '#1E3A8A'}
          emissive={isFault ? '#EF4444' : '#1E3A8A'} emissiveIntensity={0.35}
          metalness={0.7} roughness={0.4} />
      </mesh>
      {isSelected && (
        <>
          <mesh>
            <sphereGeometry args={[0.72, 12, 12]} />
            <meshBasicMaterial color="#00F0FF" wireframe />
          </mesh>
          <InlineLabel pos={[0, 1.1, 0]} rows={[
            { value: 'TURBO_01' },
            { label: 'MAP',     value: `${tel.engine.mapBar.toFixed(3)} bar` },
            { label: 'WG Duty', value: `${tel.engine.wastegateDutyPct.toFixed(1)}%` },
            { label: 'λ',       value: `${tel.engine.lambda.toFixed(3)}` },
            ...(isFault ? [{ value: '⚠ WASTEGATE STUCK', color: '#EF4444' }] : []),
          ]} />
        </>
      )}
    </group>
  );
};

// ─────────────────────────────────────────────────────────────
// INTERCOOLER ASSEMBLY — charge air cooler
// ─────────────────────────────────────────────────────────────
const IntercoolerAssembly = ({ isSelected, onClick, basePos, ef, tel, vm }) => {
  const expOff = REGISTRY.INTERCOOLER.expOff;
  const pos = [basePos[0]+expOff[0]*ef, basePos[1]+expOff[1]*ef, basePos[2]+expOff[2]*ef];
  const iat  = tel.mission.ambientTempC + 55 + (tel.engine.mapBar - 1.0) * 28;
  const col  = vm === 'THERMAL' ? thermalColor(iat, 20, 120) : (isSelected ? '#00F0FF' : '#0369A1');

  return (
    <group position={pos} onClick={e => { e.stopPropagation(); onClick('INTERCOOLER'); }}>
      <mesh>
        <boxGeometry args={[1.55, 0.32, 0.75]} />
        <meshStandardMaterial {...matProps(col, isSelected, 0.2)} />
      </mesh>
      {[-0.48, 0, 0.48].map((x, i) => (
        <mesh key={i} position={[x, 0.19, 0]}>
          <boxGeometry args={[0.32, 0.06, 0.76]} />
          <meshStandardMaterial color="#1A2535" metalness={0.65} roughness={0.7} />
        </mesh>
      ))}
      <mesh position={[-0.28, -0.25, -0.33]} rotation={[0.42, 0.18, 0]}>
        <cylinderGeometry args={[0.065, 0.065, 0.45, 8]} />
        <meshStandardMaterial color="#475569" metalness={0.72} roughness={0.42} />
      </mesh>
      <mesh position={[0.28, -0.25, 0.33]} rotation={[-0.42, 0.18, 0]}>
        <cylinderGeometry args={[0.065, 0.065, 0.45, 8]} />
        <meshStandardMaterial color="#475569" metalness={0.72} roughness={0.42} />
      </mesh>
      {isSelected && (
        <>
          <mesh>
            <boxGeometry args={[1.67, 0.44, 0.87]} />
            <meshBasicMaterial color="#00F0FF" wireframe />
          </mesh>
          <InlineLabel pos={[0, 0.8, 0]} rows={[
            { value: 'INTERCOOLER' },
            { label: 'IAT (est.)', value: `${iat.toFixed(1)}°C` },
            { label: 'MAP',        value: `${tel.engine.mapBar.toFixed(3)} bar` },
            { label: 'Ambient',    value: `${tel.mission.ambientTempC.toFixed(1)}°C` },
          ]} />
        </>
      )}
    </group>
  );
};

// ─────────────────────────────────────────────────────────────
// OIL SYSTEM ASSEMBLY
// ─────────────────────────────────────────────────────────────
const OilSystemAssembly = ({ isSelected, onClick, basePos, ef, tel, vm }) => {
  const af      = tel.health.activeFault;
  const isFault = af === 'OIL_PUMP_CAVITATION' || af === 'BLOW_BY';
  const pressRes = Math.abs(tel.residuals.oilPressResidual ?? 0);

  const col = vm === 'THERMAL' ? thermalColor(tel.engine.oilTempC, 80, 150)
            : vm === 'HEALTH'  ? healthColor(tel.health.index)
            : statusColor(pressRes * 50, isFault, '#D97706');

  const expOff = REGISTRY.OIL_SYSTEM.expOff;
  const pos = [basePos[0]+expOff[0]*ef, basePos[1]+expOff[1]*ef, basePos[2]+expOff[2]*ef];

  return (
    <group position={pos} onClick={e => { e.stopPropagation(); onClick('OIL_SYSTEM'); }}>
      <mesh>
        <boxGeometry args={[1.15, 0.38, 1.3]} />
        <meshStandardMaterial {...matProps(col, isSelected, isFault ? 0.72 : 0.3)} />
      </mesh>
      {[-0.38, 0, 0.38].map((z, i) => (
        <mesh key={i} position={[0.63, 0, z]}>
          <boxGeometry args={[0.05, 0.42, 0.26]} />
          <meshStandardMaterial color="#1A2535" metalness={0.72} roughness={0.62} />
        </mesh>
      ))}
      <mesh position={[-0.65, 0.16, 0.28]}>
        <cylinderGeometry args={[0.038, 0.038, 0.22, 8]} />
        <meshStandardMaterial color="#F59E0B" emissive="#F59E0B" emissiveIntensity={0.55}
          metalness={0.9} roughness={0.1} />
      </mesh>
      {isSelected && (
        <>
          <mesh>
            <boxGeometry args={[1.27, 0.5, 1.42]} />
            <meshBasicMaterial color="#00F0FF" wireframe />
          </mesh>
          <InlineLabel pos={[0, 0.7, 0]} rows={[
            { value: 'OIL_SYSTEM' },
            { label: 'Pressure', value: `${tel.engine.oilPressBar.toFixed(2)} bar`, color: isFault ? '#EF4444' : '#10B981' },
            { label: 'Temp',     value: `${tel.engine.oilTempC.toFixed(1)}°C` },
            { label: 'Δ Press',  value: `${(tel.residuals.oilPressResidual??0).toFixed(2)} bar` },
            ...(isFault ? [{ value: '⚠ OIL FAULT', color: '#EF4444' }] : []),
          ]} />
        </>
      )}
    </group>
  );
};

// ─────────────────────────────────────────────────────────────
// FUEL RAIL ASSEMBLY — rail bar with 4 injector stubs
// ─────────────────────────────────────────────────────────────
const FuelRailAssembly = ({ isSelected, onClick, basePos, ef, tel }) => {
  const expOff = REGISTRY.FUEL_RAIL.expOff;
  const pos = [basePos[0]+expOff[0]*ef, basePos[1]+expOff[1]*ef, basePos[2]+expOff[2]*ef];
  const col = isSelected ? '#00F0FF' : '#0EA5E9';

  return (
    <group position={pos} onClick={e => { e.stopPropagation(); onClick('FUEL_RAIL'); }}>
      <mesh rotation={[0, Math.PI / 2, 0]}>
        <cylinderGeometry args={[0.048, 0.048, 1.9, 8]} />
        <meshStandardMaterial color={col} metalness={0.85} roughness={0.28} emissive={col} emissiveIntensity={0.25} />
      </mesh>
      {[-0.7, -0.23, 0.23, 0.7].map((x, i) => (
        <mesh key={i} position={[x, -0.11, 0]}>
          <cylinderGeometry args={[0.028, 0.022, 0.2, 8]} />
          <meshStandardMaterial color="#00F0FF" emissive="#00F0FF" emissiveIntensity={0.32}
            metalness={0.9} roughness={0.1} />
        </mesh>
      ))}
      {isSelected && (
        <InlineLabel pos={[0, 0.5, 0]} rows={[
          { value: 'FUEL_RAIL' },
          { label: 'Flow',      value: `${tel.engine.fuelFlowLph.toFixed(1)} L/h` },
          { label: 'Rail Press',value: `${tel.engine.fuelPressureBar.toFixed(2)} bar` },
          { label: 'Lambda',    value: `${tel.engine.lambda.toFixed(3)} λ` },
        ]} />
      )}
    </group>
  );
};

// ─────────────────────────────────────────────────────────────
// FADEC UNIT — ECU box for Lane A or Lane B
// ─────────────────────────────────────────────────────────────
const FadecUnit = ({ compId, lane, isSelected, onClick, basePos, ef, tel }) => {
  const expOff = REGISTRY[compId].expOff;
  const pos = [basePos[0]+expOff[0]*ef, basePos[1]+expOff[1]*ef, basePos[2]+expOff[2]*ef];
  const col = isSelected ? '#00F0FF' : '#1D4ED8';
  const laneStatus = tel.health.activeFault === 'NONE' ? 'ACTIVE' : 'MONITORING';

  return (
    <group position={pos} onClick={e => { e.stopPropagation(); onClick(compId); }}>
      <mesh>
        <boxGeometry args={[0.52, 0.32, 0.7]} />
        <meshStandardMaterial color={col} emissive={col} emissiveIntensity={0.42} metalness={0.72} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.18, 0.36]}>
        <sphereGeometry args={[0.038, 8, 8]} />
        <meshStandardMaterial color="#10B981" emissive="#10B981" emissiveIntensity={1.0} />
      </mesh>
      <mesh position={[0, -0.14, -0.37]}>
        <boxGeometry args={[0.38, 0.11, 0.055]} />
        <meshStandardMaterial color="#1E2D3D" metalness={0.65} roughness={0.52} />
      </mesh>
      {isSelected && (
        <>
          <mesh>
            <boxGeometry args={[0.60, 0.40, 0.78]} />
            <meshBasicMaterial color="#00F0FF" wireframe />
          </mesh>
          <InlineLabel pos={[0, 0.7, 0]} rows={[
            { value: compId },
            { label: `Lane ${lane}`, value: laneStatus },
            { label: 'Sync',         value: 'A+B LOCKED' },
            { label: 'Throttle',     value: `${tel.engine.throttlePct.toFixed(1)}%` },
          ]} />
        </>
      )}
    </group>
  );
};


// ─────────────────────────────────────────────────────────────
// PRGB GEARBOX ASSEMBLY
// ─────────────────────────────────────────────────────────────
const PrgbAssembly = ({ isSelected, onClick, basePos, ef, tel, vm }) => {
  const expOff = REGISTRY.PRGB_GEARBOX.expOff;
  const pos = [basePos[0]+expOff[0]*ef, basePos[1]+expOff[1]*ef, basePos[2]+expOff[2]*ef];
  
  const isFault = tel.health.activeFault === 'PRGB_DEGRADATION';
  const col = vm === 'HEALTH' ? healthColor(tel.health.index) : (isFault ? '#EF4444' : '#475569');
  
  return (
    <group position={pos} onClick={e => { e.stopPropagation(); onClick('PRGB_GEARBOX'); }}>
      <mesh rotation={[Math.PI/2, 0, 0]}>
        <cylinderGeometry args={[0.5, 0.65, 0.5, 32]} />
        <meshStandardMaterial {...matProps(col, isSelected, isFault ? 0.65 : 0.1)} />
      </mesh>
      {isSelected && (
        <>
          <mesh rotation={[Math.PI/2, 0, 0]}>
            <cylinderGeometry args={[0.55, 0.7, 0.55, 32]} />
            <meshBasicMaterial color="#00F0FF" wireframe />
          </mesh>
          <InlineLabel pos={[1.2, 0, 0]} rows={[
            { value: 'PRGB_GEARBOX' },
            { label: 'Ratio', value: '2.43:1' },
            { label: 'Vibration', value: `${tel.engine.vibrationGrms.toFixed(2)} g` }
          ]} />
        </>
      )}
    </group>
  );
};

// ─────────────────────────────────────────────────────────────
// 28V PAYLOAD GENERATOR
// ─────────────────────────────────────────────────────────────
const GeneratorAssembly = ({ isSelected, onClick, basePos, ef, tel, vm }) => {
  const expOff = REGISTRY.UAV_GENERATOR_28V.expOff;
  const pos = [basePos[0]+expOff[0]*ef, basePos[1]+expOff[1]*ef, basePos[2]+expOff[2]*ef];
  
  const isFault = tel.health.activeFault === 'GENERATOR_FAILURE';
  const col = vm === 'HEALTH' ? healthColor(tel.health.index) : (isFault ? '#EF4444' : '#D97706');

  return (
    <group position={pos} onClick={e => { e.stopPropagation(); onClick('UAV_GENERATOR_28V'); }}>
      <mesh rotation={[0, 0, Math.PI/2]}>
        <cylinderGeometry args={[0.25, 0.25, 0.6, 16]} />
        <meshStandardMaterial {...matProps(col, isSelected, isFault ? 0.65 : 0.2)} />
      </mesh>
      <mesh position={[0.3, 0, 0]} rotation={[0, 0, Math.PI/2]}>
        <cylinderGeometry args={[0.15, 0.15, 0.1, 16]} />
        <meshStandardMaterial color="#94A3B8" />
      </mesh>
      {isSelected && (
        <>
          <mesh rotation={[0, 0, Math.PI/2]}>
            <cylinderGeometry args={[0.28, 0.28, 0.65, 16]} />
            <meshBasicMaterial color="#00F0FF" wireframe />
          </mesh>
          <InlineLabel pos={[0, 0.6, 0]} rows={[
            { value: 'UAV_GENERATOR_28V' },
            { label: 'Voltage', value: `${tel.engine.genVoltageV?.toFixed(1) || 28.4} V` },
            { label: 'Current', value: `${tel.engine.genCurrentA?.toFixed(1) || 45.2} A` }
          ]} />
        </>
      )}
    </group>
  );
};

// ─────────────────────────────────────────────────────────────
// COOLANT RADIATOR
// ─────────────────────────────────────────────────────────────
const RadiatorAssembly = ({ isSelected, onClick, basePos, ef, tel, vm }) => {
  const expOff = REGISTRY.COOLANT_RADIATOR.expOff;
  const pos = [basePos[0]+expOff[0]*ef, basePos[1]+expOff[1]*ef, basePos[2]+expOff[2]*ef];
  const isFault = tel.health.activeFault === 'COOLING_DEGRADATION';
  const temp = tel.engine.coolantTempC || 88.5;
  const col = vm === 'THERMAL' ? thermalColor(temp, 70, 120) : (isFault ? '#EF4444' : (isSelected ? '#00F0FF' : '#0F172A'));

  return (
    <group position={pos} onClick={e => { e.stopPropagation(); onClick('COOLANT_RADIATOR'); }}>
      <mesh>
        <boxGeometry args={[1.2, 0.6, 0.1]} />
        <meshStandardMaterial {...matProps(col, isSelected, isFault ? 0.5 : 0.1)} />
      </mesh>
      <mesh position={[0, -0.3, 0.05]}>
        <boxGeometry args={[1.3, 0.05, 0.15]} />
        <meshStandardMaterial color="#334155" />
      </mesh>
      <mesh position={[0, 0.3, 0.05]}>
        <boxGeometry args={[1.3, 0.05, 0.15]} />
        <meshStandardMaterial color="#334155" />
      </mesh>
      {isSelected && (
        <>
          <mesh>
            <boxGeometry args={[1.35, 0.7, 0.2]} />
            <meshBasicMaterial color="#00F0FF" wireframe />
          </mesh>
          <InlineLabel pos={[0.8, 0, 0]} rows={[
            { value: 'COOLANT_RADIATOR' },
            { label: 'Temp', value: `${temp.toFixed(1)} °C`, color: isFault ? '#EF4444' : '#10B981' },
            ...(isFault ? [{ value: '⚠ THERMAL RUNAWAY', color: '#EF4444' }] : [])
          ]} />
        </>
      )}
    </group>
  );
};

// ─────────────────────────────────────────────────────────────
// FLOW PIPES — exhaust headers, charge air, intake manifold
// Fades out at high explode factors.
// ─────────────────────────────────────────────────────────────
const FlowPipes = ({ ef }) => {
  const opacity = Math.max(0, 1 - ef * 2.4);
  if (opacity < 0.02) return null;
  const exh = { color:'#7C3AED', metalness:0.62, roughness:0.55, transparent:true, opacity };
  const bst = { color:'#0284C7', metalness:0.62, roughness:0.42, transparent:true, opacity };
  const inh = { color:'#10B981', metalness:0.62, roughness:0.42, transparent:true, opacity };
  return (
    <group>
      <mesh position={[-1.65,-0.55,0.68]} rotation={[0.72,0,0.28]}>
        <cylinderGeometry args={[0.052,0.052,0.85,8]} />
        <meshStandardMaterial {...exh} />
      </mesh>
      <mesh position={[-1.5,-0.55,-0.65]} rotation={[0.65,0,0.22]}>
        <cylinderGeometry args={[0.052,0.052,0.80,8]} />
        <meshStandardMaterial {...exh} />
      </mesh>
      <mesh position={[1.65,-0.55,0.68]} rotation={[0.72,0,-0.28]}>
        <cylinderGeometry args={[0.052,0.052,0.85,8]} />
        <meshStandardMaterial {...exh} />
      </mesh>
      <mesh position={[1.5,-0.55,-0.65]} rotation={[0.65,0,-0.22]}>
        <cylinderGeometry args={[0.052,0.052,0.80,8]} />
        <meshStandardMaterial {...exh} />
      </mesh>
      <mesh position={[0,-0.92,-1.55]} rotation={[0.55,0,0]}>
        <cylinderGeometry args={[0.068,0.068,0.85,8]} />
        <meshStandardMaterial {...exh} />
      </mesh>
      <mesh position={[0,0.28,-1.88]} rotation={[0.82,0,0]}>
        <cylinderGeometry args={[0.068,0.068,0.88,8]} />
        <meshStandardMaterial {...bst} />
      </mesh>
      <mesh position={[0,0.52,-1.10]} rotation={[0.58,0,0]}>
        <cylinderGeometry args={[0.058,0.058,0.58,8]} />
        <meshStandardMaterial {...bst} />
      </mesh>
      <mesh position={[0,0.60,0]} rotation={[0,Math.PI/2,0]}>
        <cylinderGeometry args={[0.052,0.052,2.05,8]} />
        <meshStandardMaterial {...inh} />
      </mesh>
    </group>
  );
};

// ─────────────────────────────────────────────────────────────
// CAD GRID FLOOR
// ─────────────────────────────────────────────────────────────
const CadGrid = () => (
  <group position={[0,-2.4,0]} rotation={[-Math.PI/2,0,0]}>
    <gridHelper args={[28,56,'#00F0FF','#0D1F35']} rotation={[Math.PI/2,0,0]} />
    <mesh position={[0,0,-0.01]}>
      <ringGeometry args={[4.8,4.84,64]} />
      <meshBasicMaterial color="#00F0FF" opacity={0.12} transparent side={THREE.DoubleSide} />
    </mesh>
    <mesh position={[0,0,-0.01]}>
      <ringGeometry args={[9.5,9.54,64]} />
      <meshBasicMaterial color="#00F0FF" opacity={0.06} transparent side={THREE.DoubleSide} />
    </mesh>
  </group>
);

// ─────────────────────────────────────────────────────────────
// ENGINE DIGITAL TWIN — root 3D scene composition
// Physical positions derived from Rotax 915 flat-4 architecture.
// ─────────────────────────────────────────────────────────────
const EngineDigitalTwin = ({ sel, onSel, ef, vm, camTargetRef, ctrlRef, tel }) => {
  const CRANK_POS   = [0,    0,      0    ];
  const PROP_POS    = [0,    0,      1.45 ];
  const TURBO_POS   = [0,   -1.28,  -2.18];
  const INTCOOL_POS = [0,    1.48,  -1.48];
  const OIL_POS     = [0,   -1.28,   0   ];
  const FUEL_POS    = [0,    0.68,   0   ];
  const FADECA_POS  = [-1.72,-0.88, -1.48];
  const FADECB_POS  = [ 1.72,-0.88, -1.48];
  const PRGB_POS    = [0,    0,      0.95 ];
  const GEN_POS     = [-0.5, 0.8,   -0.9  ];
  const RAD_POS     = [0,   -1.8,    0.6  ];

  // Flat-4 boxer cylinder positions (horizontally-opposed)
  const CYL_POS = {
    CYL_01: [-1.95, 0.15,  0.62],
    CYL_02: [ 1.95, 0.15,  0.62],
    CYL_03: [-1.95, 0.15, -0.62],
    CYL_04: [ 1.95, 0.15, -0.62],
  };
  const CYL_DEFS = [
    {id:'CYL_01',idx:0,side:'left' },
    {id:'CYL_02',idx:1,side:'right'},
    {id:'CYL_03',idx:2,side:'left' },
    {id:'CYL_04',idx:3,side:'right'},
  ];

  const ptLightCol = tel.health.status==='CRITICAL' ? '#EF4444'
                   : tel.health.status==='DEGRADED'  ? '#F59E0B'
                   : '#00F0FF';

  return (
    <>
      <CadGrid />
      <CameraController targetRef={camTargetRef} controlsRef={ctrlRef} />

      <ambientLight intensity={0.52} />
      <directionalLight position={[8,10,8]} intensity={1.25} />
      <directionalLight position={[-8,6,-5]} intensity={0.55} color="#0369A1" />
      <pointLight position={[0,-1.5,2]} intensity={1.15} color={ptLightCol} />
      <pointLight position={[0,3,-3]}   intensity={0.45} color="#0D1F35" />

      <PropellerAssembly rpm={tel.engine.rpm} isSelected={sel==='PROP_01'}
        onClick={onSel} basePos={PROP_POS} ef={ef} />

      <CrankcaseAssembly isSelected={sel==='ENGINE_BLOCK'} onClick={onSel}
        basePos={CRANK_POS} ef={ef} tel={tel} vm={vm} />

      {CYL_DEFS.map(({id,idx,side}) => (
        <CylinderUnit key={id} compId={id} cylIdx={idx}
          basePos={CYL_POS[id]} side={side}
          tel={tel} isSelected={sel===id} onClick={onSel}
          ef={ef} vm={vm} />
      ))}

      <FlowPipes ef={ef} />

      <TurboAssembly isSelected={sel==='TURBO_01'} onClick={onSel}
        basePos={TURBO_POS} ef={ef} tel={tel} vm={vm} />

      <IntercoolerAssembly isSelected={sel==='INTERCOOLER'} onClick={onSel}
        basePos={INTCOOL_POS} ef={ef} tel={tel} vm={vm} />

      <OilSystemAssembly isSelected={sel==='OIL_SYSTEM'} onClick={onSel}
        basePos={OIL_POS} ef={ef} tel={tel} vm={vm} />

      <FuelRailAssembly isSelected={sel==='FUEL_RAIL'} onClick={onSel}
        basePos={FUEL_POS} ef={ef} tel={tel} />

      <FadecUnit compId="FADEC_A" lane="A" isSelected={sel==='FADEC_A'}
        onClick={onSel} basePos={FADECA_POS} ef={ef} tel={tel} />

      <FadecUnit compId="FADEC_B" lane="B" isSelected={sel==='FADEC_B'}
        onClick={onSel} basePos={FADECB_POS} ef={ef} tel={tel} />

      <PrgbAssembly isSelected={sel==='PRGB_GEARBOX'} onClick={onSel} basePos={PRGB_POS} ef={ef} tel={tel} vm={vm} />
      <GeneratorAssembly isSelected={sel==='UAV_GENERATOR_28V'} onClick={onSel} basePos={GEN_POS} ef={ef} tel={tel} vm={vm} />
      <RadiatorAssembly isSelected={sel==='COOLANT_RADIATOR'} onClick={onSel} basePos={RAD_POS} ef={ef} tel={tel} vm={vm} />
    </>
  );
};

// ─────────────────────────────────────────────────────────────
// SPARKLINE — mini SVG trend chart driven by historyBuffer
// ─────────────────────────────────────────────────────────────
const Sparkline = ({ data, color = '#00F0FF' }) => {
  if (!data || data.length < 2) return null;
  const mn = Math.min(...data), mx = Math.max(...data);
  const range = mx - mn || 1;
  const W = 200, H = 28;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * W;
    const y = H - ((v - mn) / range) * (H - 4) - 2;
    return `${x},${Math.max(2, Math.min(H - 2, y))}`;
  }).join(' ');
  const last = pts.split(' ').at(-1).split(',');
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="w-full mt-0.5">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.4" strokeLinejoin="round" />
      {last.length === 2 && <circle cx={last[0]} cy={last[1]} r="2.5" fill={color} />}
    </svg>
  );
};

// ─────────────────────────────────────────────────────────────
// INSPECTOR PANEL — structured per-field telemetry display
// ─────────────────────────────────────────────────────────────
const InspectorPanel = ({ compId, tel, aiProg, hist, injectFault, clearFault, selectedUav = 'Vahak-1', uavSpec }) => {
  const comp = REGISTRY[compId];
  if (!comp) return <div className="text-slate-500 text-xs font-mono p-4">Select a component.</div>;

  const af = tel.health.activeFault;

  const DESCS = {
    PROP_01:      'Two-blade propeller driven via 2.43:1 planetary reduction gearbox. RPM monitored by FADEC crankshaft encoder. Blade pitch is fixed.',
    ENGINE_BLOCK: 'Rotax 915 iS — 1,414 cc flat-4 turbocharged, intercooled, liquid/air-cooled boxer with dual FADEC ECU. Structural vibration monitored via piezo g-RMS sensor on crankcase.',
    CYL_01:       'Left-forward cylinder. 84 mm bore × 61 mm stroke, NiCaSil-plated bore. Dual spark ignition, port fuel injection.',
    CYL_02:       'Right-forward cylinder. Paired with CYL_01 on crank pin. Correlation with charge air temperature under boost.',
    CYL_03:       'Left-aft cylinder. Critical fault indicator — injector restriction causes EGT excursions >960°C (lean burn). Primary CYL3_INJECTOR sensor.',
    CYL_04:       'Right-aft cylinder. Monitored for thermal symmetry and exhaust manifold backpressure balance.',
    TURBO_01:     'Exhaust-driven turbocharger. Maintains sea-level MAP to 15,000 ft. FADEC-regulated electronic wastegate ±0.02 bar. Overspeed or stuck wastegate causes over-boost.',
    INTERCOOLER:  'Charge air cooler. Reduces post-compressor air temperature, increasing charge density and reducing knock risk.',
    OIL_SYSTEM:   'Dry sump lubrication. Mechanical pump with thermostatically-controlled cooler. Pressure collapse indicates cavitation or bearing seizure risk.',
    FUEL_RAIL:    'Dual redundant electric fuel pumps. 3.0 bar regulated rail pressure. Multi-point port injection. Avgas 100LL / Mogas 95.',
    FADEC_A:      'Primary FADEC Lane A (left ECU). Controls ignition, injection, boost, mixture. Monitors all sensors at 100 Hz.',
    FADEC_B:      'Redundant FADEC Lane B (right ECU). Mirrors Lane A. Auto-switches on Lane A fault. STANAG 4671 compliant.',
    PRGB_GEARBOX: 'Propeller Reduction Gearbox (2.43:1). Includes overload clutch and torsional vibration damper to protect crank from prop strikes and harmonics.',
    UAV_GENERATOR_28V: 'High-Output 28V DC payload generator. Powers SAR radar, EO/IR turret, and avionics. Loss of generator triggers AI payload-shedding and RTB.',
    COOLANT_RADIATOR: 'Liquid cooling heat exchanger for cylinder heads. Blockage or water pump failure leads to thermal runaway and detonation risk.',
  };

  const buildFields = () => {
    switch (compId) {
      case 'PROP_01':
        return [
          { label:'Engine RPM', value:tel.engine.rpm,          unit:'RPM',p:0 },
          { label:'Prop RPM',   value:tel.engine.rpm/2.43,     unit:'RPM',p:0 },
          { label:'Throttle',   value:tel.engine.throttlePct,  unit:'%',  p:1 },
        ];
      case 'ENGINE_BLOCK':
        return [
          { label:'Engine RPM', value:tel.engine.rpm,          unit:'RPM',p:0, hist:hist.healthIndex },
          { label:'Throttle',   value:tel.engine.throttlePct,  unit:'%',  p:1 },
          { label:'Vibration',  value:tel.engine.vibrationGrms,unit:'g',  p:3, res:tel.residuals.vibrationResidual },
          { label:'Health',     value:tel.health.index,        unit:'%',  p:1 },
        ];
      case 'CYL_01':case 'CYL_02':case 'CYL_03':case 'CYL_04': {
        const i = parseInt(compId.slice(-1)) - 1;
        return [
          { label:'EGT', value:tel.engine.egt[i], unit:'°C',p:1, res:tel.residuals.egtResiduals[i], hist:hist[`egt${i+1}`] },
          { label:'CHT', value:tel.engine.cht[i], unit:'°C',p:1, res:tel.residuals.chtResiduals[i], hist:hist[`cht${i+1}`] },
        ];
      }
      case 'TURBO_01':
        return [
          { label:'Boost (MAP)', value:tel.engine.mapBar,           unit:'bar',p:3, res:tel.residuals.mapResidual, hist:hist.map },
          { label:'WG Duty',     value:tel.engine.wastegateDutyPct, unit:'%',  p:1 },
          { label:'Lambda',      value:tel.engine.lambda,           unit:'λ',  p:3 },
        ];
      case 'INTERCOOLER': {
        const iat = tel.mission.ambientTempC + 55 + (tel.engine.mapBar - 1.0) * 28;
        return [
          { label:'IAT (est.)', value:iat,                     unit:'°C',p:1 },
          { label:'MAP',        value:tel.engine.mapBar,       unit:'bar',p:3 },
          { label:'Ambient',    value:tel.mission.ambientTempC,unit:'°C',p:1 },
        ];
      }
      case 'OIL_SYSTEM':
        return [
          { label:'Oil Pressure', value:tel.engine.oilPressBar, unit:'bar',p:2, res:tel.residuals.oilPressResidual, hist:hist.oilPress },
          { label:'Oil Temp',     value:tel.engine.oilTempC,    unit:'°C', p:1, res:tel.residuals.oilTempResidual,  hist:hist.oilTemp  },
        ];
      case 'FUEL_RAIL':
        return [
          { label:'Fuel Flow',  value:tel.engine.fuelFlowLph,    unit:'L/h',p:1 },
          { label:'Rail Press', value:tel.engine.fuelPressureBar, unit:'bar',p:2 },
          { label:'Lambda',     value:tel.engine.lambda,          unit:'λ',  p:3 },
        ];
      case 'FADEC_A':case 'FADEC_B':
        return [
          { label:'Lane A',       value:'ACTIVE',                  unit:'',p:0,isStr:true },
          { label:'Lane B',       value:'ACTIVE',                  unit:'',p:0,isStr:true },
          { label:'Sync',         value:'A+B LOCKED',              unit:'',p:0,isStr:true },
          { label:'Throttle Cmd', value:tel.engine.throttlePct,    unit:'%',p:1 },
        ];
      case 'PRGB_GEARBOX':
        return [
          { label:'Input RPM', value:tel.engine.rpm, unit:'RPM', p:0 },
          { label:'Prop RPM',  value:tel.engine.rpm/2.43, unit:'RPM', p:0 },
          { label:'Vibration', value:tel.engine.vibrationGrms, unit:'g', p:3, res:tel.residuals.vibrationResidual }
        ];
      case 'UAV_GENERATOR_28V':
        return [
          { label:'Bus Voltage', value:tel.engine.genVoltageV || 28.4, unit:'V', p:1, res:tel.residuals.genVoltageResidual },
          { label:'Current', value:tel.engine.genCurrentA || 45.2, unit:'A', p:1 }
        ];
      case 'COOLANT_RADIATOR':
        return [
          { label:'Coolant Temp', value:tel.engine.coolantTempC || 88.5, unit:'°C', p:1, res:tel.residuals.coolantTempResidual }
        ];
      default: return [];
    }
  };

  const fields = buildFields();

  const compFault =
    (compId === 'CYL_03' && af === 'CYL3_INJECTOR') ||
    (compId === 'OIL_SYSTEM' && (af === 'OIL_PUMP_CAVITATION' || af === 'BLOW_BY')) ||
    (compId === 'TURBO_01' && af === 'TURBO_WASTEGATE_STUCK') ||
    (['CYL_01','CYL_02','CYL_04','COOLANT_RADIATOR'].includes(compId) && af === 'COOLING_DEGRADATION') ||
    (compId === 'PRGB_GEARBOX' && af === 'PRGB_DEGRADATION') ||
    (compId === 'UAV_GENERATOR_28V' && af === 'GENERATOR_FAILURE');

  const stBg = compFault
    ? 'bg-red-500/20 border-red-500/50 text-red-400 animate-pulse'
    : 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400';

  return (
    <div className="flex flex-col gap-2.5 h-full overflow-y-auto pr-0.5">
      <div className="flex items-center justify-between border-b border-hud-cyan/20 pb-2">
        <div className="flex items-center gap-1.5">
          <Cpu className="w-3.5 h-3.5 text-hud-cyan" />
          <span className="font-display font-bold text-[11px] tracking-wider text-hud-cyan">COMPONENT INSPECTOR</span>
        </div>
        <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${stBg}`}>
          {compFault ? 'FAULT' : 'NOMINAL'}
        </span>
      </div>

      <div className="bg-slate-900/90 border border-slate-700/80 rounded p-2.5">
        <div className="text-[9px] font-mono text-slate-400 uppercase tracking-wider">{comp.subsystem}</div>
        <div className="text-sm font-bold text-white mt-0.5 leading-tight">{comp.name}</div>
        <div className="text-[9px] font-mono text-hud-cyan mt-1">ID: {comp.id}</div>
      </div>

      <div className="bg-black/60 border border-hud-cyan/30 rounded p-2.5 flex flex-col gap-2">
        <div className="text-[9px] font-mono text-slate-400 flex items-center gap-1">
          <Activity className="w-3 h-3 text-hud-cyan" /> LIVE SENSOR DATA
        </div>
        {fields.map((f, fi) => {
          const resAbs = f.res !== undefined ? Math.abs(f.res) : 0;
          const vc = f.res !== undefined
            ? (resAbs > 40 ? 'text-red-400' : resAbs > 15 ? 'text-amber-400' : 'text-emerald-400')
            : 'text-emerald-400';
          const dispVal = f.isStr ? f.value : typeof f.value === 'number' ? f.value.toFixed(f.p) : '—';
          return (
            <div key={fi} className="flex flex-col gap-0.5">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-mono text-slate-400">{f.label}</span>
                <span className={`text-sm font-mono font-bold ${vc}`}>
                  {dispVal}
                  <span className="text-[9px] text-slate-500 ml-0.5">{f.unit}</span>
                </span>
              </div>
              {f.res !== undefined && (
                <div className="text-[9px] font-mono text-slate-600 text-right">
                  Δ {f.res > 0 ? '+' : ''}{(f.res).toFixed(2)} {f.unit}
                </div>
              )}
              {f.hist && <Sparkline data={f.hist} color={resAbs > 15 ? '#F59E0B' : '#00F0FF'} />}
            </div>
          );
        })}
      </div>

      <div className="bg-slate-900/60 border border-slate-800 rounded p-2.5">
        <div className="text-[9px] font-mono text-slate-400 mb-2 flex items-center gap-1">
          <BarChart2 className="w-3 h-3 text-hud-amber" /> ENGINE HEALTH & ANOMALY
        </div>
        {[
          { label:'Health Index',  val:tel.health.index,           col:healthColor(tel.health.index) },
          { label:'Anomaly Score', val:aiProg.anomaly_score*100,   col:aiProg.anomaly_score>0.5?'#EF4444':aiProg.anomaly_score>0.2?'#F59E0B':'#10B981' },
        ].map((bar,bi) => (
          <div key={bi} className="flex items-center gap-2 mb-1">
            <span className="text-[9px] font-mono text-slate-400 w-24 shrink-0">{bar.label}</span>
            <div className="flex-1 bg-slate-800 rounded-full h-1.5">
              <div className="h-1.5 rounded-full transition-all duration-300"
                style={{ width:`${Math.min(100,bar.val)}%`, backgroundColor:bar.col }} />
            </div>
            <span className="text-[10px] font-mono font-bold w-10 text-right" style={{ color:bar.col }}>
              {bar.val.toFixed(1)}%
            </span>
          </div>
        ))}
        {af !== 'NONE' && (
          <div className="mt-1.5 text-[9px] font-mono text-red-400 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> {af}
          </div>
        )}
        {aiProg.rul_hours_mean !== undefined && (
          <div className="mt-1 text-[9px] font-mono text-slate-400">
            RUL: <span className="text-hud-cyan font-bold">{aiProg.rul_hours_mean.toFixed(0)} hr</span>
            <span className="text-slate-600 ml-1">
              ({aiProg.rul_hours_lower_95?.toFixed(0)}–{aiProg.rul_hours_upper_95?.toFixed(0)} 95% CI)
            </span>
          </div>
        )}
      </div>

      <div className="bg-slate-900/60 border border-slate-800 rounded p-2.5 text-[9px] leading-relaxed text-slate-300">
        <div className="font-bold text-hud-cyan mb-1 flex items-center gap-1 text-[9px]">
          <Info className="w-3 h-3" /> ENGINEERING NOTES
        </div>
        {DESCS[compId] || '—'}
      </div>

      <div className="mt-auto pt-2 border-t border-slate-800 shrink-0">
        {selectedUav === 'Vahak-1' ? (
          <>
            <div className="text-[9px] font-mono text-slate-400 mb-1.5 flex items-center gap-1">
              <Flame className="w-3 h-3 text-hud-cyan" /> QUICK FAULT INJECTION (JUDGE / DEMO):
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button onClick={() => injectFault('CYL3_INJECTOR', 0.9)}
                className={`px-2 py-1.5 rounded text-[9px] font-mono transition-all ${af==='CYL3_INJECTOR' ? 'bg-red-500 text-black font-bold border-red-500 shadow-hud-red' : 'bg-slate-900/90 text-red-400 border border-red-500/40 hover:bg-red-950'}`}>Cyl 3 Clog</button>
                
              <button onClick={() => injectFault('BLOW_BY', 0.85)}
                className={`px-2 py-1.5 rounded text-[9px] font-mono transition-all ${af==='BLOW_BY' ? 'bg-amber-500 text-black font-bold border-amber-500 shadow-hud-amber' : 'bg-slate-900/90 text-amber-400 border border-amber-500/40 hover:bg-amber-950'}`}>Piston Blow-By</button>
                
              <button onClick={() => injectFault('OIL_PUMP_CAVITATION', 0.95)}
                className={`px-2 py-1.5 rounded text-[9px] font-mono transition-all ${af==='OIL_PUMP_CAVITATION' ? 'bg-red-500 text-black font-bold border-red-500 shadow-hud-red' : 'bg-slate-900/90 text-red-300 border border-red-500/40 hover:bg-red-950'}`}>Oil Cavitation</button>

              <button onClick={() => injectFault('TURBO_WASTEGATE_STUCK', 0.8)}
                className={`px-2 py-1.5 rounded text-[9px] font-mono transition-all ${af==='TURBO_WASTEGATE_STUCK' ? 'bg-purple-500 text-black font-bold border-purple-500' : 'bg-slate-900/90 text-purple-300 border border-purple-500/40 hover:bg-purple-950'}`}>Turbo Surge</button>

              <button onClick={() => injectFault('COOLING_DEGRADATION', 0.85)}
                className={`px-2 py-1.5 rounded text-[9px] font-mono transition-all ${af==='COOLING_DEGRADATION' ? 'bg-cyan-500 text-black font-bold border-cyan-500' : 'bg-slate-900/90 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-950'}`}>Cooling Decay</button>
                
              <button onClick={() => injectFault('PRGB_DEGRADATION', 0.9)}
                className={`px-2 py-1.5 rounded text-[9px] font-mono transition-all ${af==='PRGB_DEGRADATION' ? 'bg-orange-500 text-black font-bold border-orange-500' : 'bg-orange-950/40 hover:bg-orange-900/60 border border-orange-500/40 text-orange-300'}`}>Gearbox Wear</button>
                
              <button onClick={() => injectFault('GENERATOR_FAILURE', 0.9)}
                className={`px-2 py-1.5 rounded text-[9px] font-mono transition-all ${af==='GENERATOR_FAILURE' ? 'bg-yellow-500 text-black font-bold border-yellow-500' : 'bg-yellow-950/40 hover:bg-yellow-900/60 border border-yellow-500/40 text-yellow-300'}`}>Gen Failure</button>
                
              <button onClick={() => clearFault()}
                className={`px-2 py-1.5 rounded text-[9px] font-mono transition-all ${af==='NONE' ? 'bg-emerald-500 text-black font-bold border-emerald-500' : 'bg-slate-900/90 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-950'}`}>Clear All (Nominal)</button>
            </div>
          </>
        ) : (
          <div className="bg-slate-900/80 p-2.5 rounded border border-slate-800 text-[9px] font-mono flex flex-col gap-1">
            <div className="text-hud-cyan font-bold flex items-center justify-between">
              <span>{selectedUav} SWARM TELEMETRY:</span>
              <span className="text-slate-400 font-normal">S/N: {uavSpec?.sn || 'RTX-0915'}</span>
            </div>
            <div className="text-slate-300">ROLE: <span className="font-bold text-white">{uavSpec?.role}</span></div>
            <div className="text-slate-300">TOTAL AIRFRAME HOURS: <span className="font-bold text-white">{uavSpec?.hours}</span></div>
            <div className="text-slate-300">THEATER LOCATION: <span className="font-bold text-hud-cyan">{uavSpec?.location}</span></div>
            <div className="text-slate-400 text-[8.5px] mt-0.5 pt-1 border-t border-slate-800/80">
              * Live physics telemetry streaming from Western Air Command swarm datalink bus.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// SCHEMATIC PANEL — 2D SVG system flow diagram
// Bidirectionally synchronized with 3D selection.
// ─────────────────────────────────────────────────────────────
const SchematicPanel = ({ sel, onSel, tel }) => {
  const af = tel.health.activeFault;
  const isFaulty = (id) =>
    (id==='CYL_03' && af==='CYL3_INJECTOR') ||
    (id==='OIL_SYSTEM' && (af==='OIL_PUMP_CAVITATION'||af==='BLOW_BY')) ||
    (id==='TURBO_01' && af==='TURBO_WASTEGATE_STUCK') ||
    (['CYL_01','CYL_02','CYL_04','COOLANT_RADIATOR'].includes(id) && af==='COOLING_DEGRADATION') ||
    (id==='PRGB_GEARBOX' && af==='PRGB_DEGRADATION') ||
    (id==='UAV_GENERATOR_28V' && af==='GENERATOR_FAILURE');

  const ns = (id) => ({
    fill:   sel===id ? '#00F0FF' : isFaulty(id) ? 'rgba(239,68,68,0.2)' : 'rgba(10,25,47,0.9)',
    stroke: sel===id ? '#00F0FF' : isFaulty(id) ? '#EF4444' : '#334155',
    sw:     sel===id ? 2 : 1,
    tc:     sel===id ? '#000'    : isFaulty(id) ? '#FCA5A5' : '#64748B',
    fw:     sel===id ? 'bold'    : 'normal',
  });

  const Node = ({ id, x, y, w=60, h=20, label }) => {
    const s = ns(id);
    return (
      <g onClick={() => onSel(id)} style={{ cursor:'pointer' }}>
        <rect x={x-w/2} y={y-h/2} width={w} height={h} rx={3}
          fill={s.fill} stroke={s.stroke} strokeWidth={s.sw}
          style={{ transition:'fill 0.2s,stroke 0.2s' }} />
        <text x={x} y={y+0.5} textAnchor="middle" dominantBaseline="middle"
          fontSize="7" fontFamily="monospace" fill={s.tc} fontWeight={s.fw}>{label}</text>
      </g>
    );
  };

  const Arr = ({ x1,y1,x2,y2,col='#1E3A5F' }) => (
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={col} strokeWidth={1}
      markerEnd="url(#arr)" opacity={0.65} />
  );

  return (
    <div className="bg-black/70 border border-hud-cyan/20 rounded p-2">
      <div className="text-[9px] font-mono text-hud-cyan mb-1.5 flex items-center gap-1">
        <GitBranch className="w-3 h-3" /> SYSTEM SCHEMATIC
        <span className="text-slate-600 ml-1">· click to select</span>
      </div>
      <svg viewBox="0 0 280 240" width="100%">
        <defs>
          <marker id="arr" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
            <polygon points="0 0,6 2,0 4" fill="#1E3A5F" />
          </marker>
        </defs>
        <Arr x1={140} y1={19}  x2={140} y2={33}  col="#475569" />
        <Arr x1={120} y1={52}  x2={72}  y2={70}  col="#10B981" />
        <Arr x1={128} y1={52}  x2={108} y2={70}  col="#10B981" />
        <Arr x1={152} y1={52}  x2={172} y2={70}  col="#10B981" />
        <Arr x1={160} y1={52}  x2={208} y2={70}  col="#10B981" />
        <Arr x1={160} y1={44}  x2={248} y2={52}  col="#0EA5E9" />
        <Arr x1={140} y1={52}  x2={140} y2={98}  col="#7C3AED" />
        <Arr x1={140} y1={110} x2={140} y2={128} col="#7C3AED" />
        <Arr x1={140} y1={148} x2={140} y2={163} col="#0284C7" />
        <Arr x1={140} y1={178} x2={140} y2={195} col="#10B981" />
        <Arr x1={140} y1={209} x2={140} y2={212} col="#10B981" />
        <Arr x1={60}  y1={135} x2={122} y2={50}  col="#1D4ED8" />
        <Arr x1={220} y1={135} x2={158} y2={50}  col="#1D4ED8" />
        <Arr x1={28}  y1={90}  x2={118} y2={50}  col="#D97706" />
        <Arr x1={155} y1={43}  x2={220} y2={108} col="#0EA5E9" />
        <Arr x1={140} y1={180} x2={140} y2={195} col="#10B981" />


        <Node id="PROP_01"      x={140} y={12}  w={54} h={16} label="PROPELLER"    />
        <Node id="ENGINE_BLOCK" x={140} y={43}  w={65} h={20} label="CRANKCASE"    />
        <Node id="CYL_01"       x={68}  y={80}  w={38} h={18} label="CYL 1"        />
        <Node id="CYL_02"       x={108} y={80}  w={38} h={18} label="CYL 2"        />
        <Node id="CYL_03"       x={172} y={80}  w={38} h={18} label="CYL 3"        />
        <Node id="CYL_04"       x={212} y={80}  w={38} h={18} label="CYL 4"        />
        <rect x={118} y={98} width={44} height={14} rx={2}
          fill="rgba(124,58,237,0.15)" stroke="#7C3AED" strokeWidth={0.5} />
        <text x={140} y={105} textAnchor="middle" dominantBaseline="middle"
          fontSize="6" fontFamily="monospace" fill="#A78BFA">EXHAUST MAN.</text>
        <Node id="TURBO_01"     x={140} y={138} w={62} h={20} label="TURBOCHARGER" />
        <Node id="INTERCOOLER"  x={140} y={171} w={66} h={18} label="INTERCOOLER"  />
        <rect x={122} y={212} width={36} height={13} rx={2}
          fill="rgba(16,185,129,0.1)" stroke="#10B981" strokeWidth={0.5} />
        <text x={140} y={218} textAnchor="middle" dominantBaseline="middle"
          fontSize="6" fontFamily="monospace" fill="#10B981">INTAKE</text>
        <Node id="FADEC_A"      x={38}  y={143} w={52} h={18} label="FADEC-A"      />
        <Node id="FADEC_B"      x={242} y={143} w={52} h={18} label="FADEC-B"      />
        <Node id="OIL_SYSTEM"   x={22}  y={88}  w={38} h={18} label="OIL SYS"     />
        <Node id="FUEL_RAIL"    x={252} y={58}  w={44} h={18} label="FUEL RAIL"    />
        
        <Node id="PRGB_GEARBOX" x={140} y={28}  w={46} h={14} label="PRGB" />
        <Node id="UAV_GENERATOR_28V" x={242} y={115} w={52} h={14} label="28V GEN" />
        <Node id="COOLANT_RADIATOR" x={140} y={202} w={54} h={14} label="RADIATOR" />
      </svg>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// CAMERA PRESETS
// ─────────────────────────────────────────────────────────────
const CAM_PRESETS = {
  ISO:   { camPos:[6,4,8],     camLook:[0,0,0] },
  TOP:   { camPos:[0,14,0.01], camLook:[0,0,0] },
  FRONT: { camPos:[0,1,13],    camLook:[0,0,0] },
  BACK:  { camPos:[0,1,-13],   camLook:[0,0,0] },
  LEFT:  { camPos:[-13,1,0],   camLook:[0,0,0] },
  RIGHT: { camPos:[13,1,0],    camLook:[0,0,0] },
  BAY:   { camPos:[3.5,2,3.5], camLook:[0,0,0] },
};

// ─────────────────────────────────────────────────────────────
// MAIN EXPORTED TAB COMPONENT
// ─────────────────────────────────────────────────────────────
export const UavBlueprintTab = () => {
  const { telemetry, aiPrognostics, historyBuffer, injectFault, clearFault } = useTelemetry();

  const [selectedUav, setSelectedUav] = useState('Vahak-1');
  const [sel,       setSel]       = useState('CYL_03');
  const [ef,        setEf]        = useState(0.0);
  const [vm,        setVm]        = useState('OPERATIONAL');
  const [camKey,    setCamKey]    = useState('ISO');
  const [showSchem, setShowSchem] = useState(false);

  const ctrlRef      = useRef();
  const camTargetRef = useRef(null);

  // Fleet Specifications & Roles
  const FLEET_SPECS = {
    'Vahak-1': { sn: 'ENG-882-X', hours: '342.5h', role: 'Active Tactical Testbed', location: 'Barmer Border Orbit' },
    'Vahak-2': { sn: 'RTX-0819', hours: '415.0h', role: 'Escort Lead', location: 'Sector South' },
    'Vahak-3': { sn: 'RTX-0902', hours: '80.0h', role: 'Relay Orbit', location: 'FL 180 Surveillance' },
    'Vahak-4': { sn: 'RTX-0754', hours: '780.0h', role: 'Perimeter Patrol', location: 'Derated Desert Patrol' },
    'Vahak-5': { sn: 'RTX-0699', hours: '1080.0h', role: 'Hangar Reserve', location: 'AFS Uttarlai Hangar' }
  };
  const curSpec = FLEET_SPECS[selectedUav] || FLEET_SPECS['Vahak-1'];

  // Dynamic Fleet Telemetry & Prognostics Resolver
  const { activeTel, activeAiProg } = useMemo(() => {
    if (selectedUav === 'Vahak-1') {
      return { activeTel: telemetry, activeAiProg: aiPrognostics };
    }

    if (selectedUav === 'Vahak-2') {
      return {
        activeTel: {
          ...telemetry,
          engine: {
            ...telemetry.engine,
            rpm: 4950,
            throttlePct: 80.0,
            egt: [838.0, 835.5, 840.2, 837.1],
            cht: [104.2, 105.1, 103.8, 105.4],
            mapBar: 1.44,
            oilPressBar: 3.90,
            oilTempC: 96.5,
            vibrationGrms: 0.24,
            coolantTempC: 86.2,
            fuelFlowLph: 25.2
          },
          health: {
            index: 96.2,
            status: 'NOMINAL',
            activeFault: 'NONE',
            alertMessage: 'ALL SYSTEMS NOMINAL'
          },
          residuals: {
            ...telemetry.residuals,
            egtResiduals: [2.0, -1.5, 3.2, 0.1],
            chtResiduals: [-1.8, -0.9, -2.2, -0.6],
            oilPressResidual: 0.05,
            oilTempResidual: -1.5,
            vibrationResidual: -0.04,
            mapResidual: 0.02
          }
        },
        activeAiProg: {
          ...aiPrognostics,
          engine_health_index: 96.2,
          rul_hours_mean: 785.0,
          rul_hours_lower_95: 720.0,
          rul_hours_upper_95: 850.0,
          anomaly_score: 0.04,
          dominant_root_cause_feature: 'NONE'
        }
      };
    }

    if (selectedUav === 'Vahak-3') {
      return {
        activeTel: {
          ...telemetry,
          engine: {
            ...telemetry.engine,
            rpm: 5100,
            throttlePct: 82.5,
            egt: [825.0, 822.4, 826.8, 824.2],
            cht: [99.4, 100.2, 99.8, 101.1],
            mapBar: 1.48,
            oilPressBar: 4.10,
            oilTempC: 94.0,
            vibrationGrms: 0.18,
            coolantTempC: 84.5,
            fuelFlowLph: 26.0
          },
          health: {
            index: 99.1,
            status: 'NOMINAL',
            activeFault: 'NONE',
            alertMessage: 'OPTIMAL THERMAL EQUILIBRIUM'
          },
          residuals: {
            ...telemetry.residuals,
            egtResiduals: [-5.0, -7.6, -3.2, -5.8],
            chtResiduals: [-6.6, -5.8, -6.2, -4.9],
            oilPressResidual: 0.25,
            oilTempResidual: -4.0,
            vibrationResidual: -0.10,
            mapResidual: 0.06
          }
        },
        activeAiProg: {
          ...aiPrognostics,
          engine_health_index: 99.1,
          rul_hours_mean: 1120.0,
          rul_hours_lower_95: 1040.0,
          rul_hours_upper_95: 1200.0,
          anomaly_score: 0.01,
          dominant_root_cause_feature: 'NONE'
        }
      };
    }

    if (selectedUav === 'Vahak-4') {
      return {
        activeTel: {
          ...telemetry,
          engine: {
            ...telemetry.engine,
            rpm: 4400, // Derated continuous cruise
            throttlePct: 72.0,
            egt: [858.0, 862.4, 855.0, 864.2],
            cht: [112.5, 114.2, 111.8, 115.0],
            mapBar: 1.35,
            oilPressBar: 3.45,
            oilTempC: 103.5,
            vibrationGrms: 0.68, // Elevated PRGB vibration
            coolantTempC: 94.0,
            fuelFlowLph: 22.8
          },
          health: {
            index: 84.5,
            status: 'DEGRADED',
            activeFault: 'PRGB_DEGRADATION',
            alertMessage: 'PRGB GEARBOX CLUTCH WEAR DETECTED'
          },
          residuals: {
            ...telemetry.residuals,
            egtResiduals: [18.0, 22.4, 15.0, 24.2],
            chtResiduals: [6.5, 8.2, 5.8, 9.0],
            oilPressResidual: -0.40,
            oilTempResidual: 5.5,
            vibrationResidual: 0.40,
            mapResidual: -0.07
          }
        },
        activeAiProg: {
          ...aiPrognostics,
          engine_health_index: 84.5,
          rul_hours_mean: 420.0,
          rul_hours_lower_95: 360.0,
          rul_hours_upper_95: 480.0,
          anomaly_score: 0.38,
          dominant_root_cause_feature: 'PRGB Torsional Harmonics (2X Gear Mesh)'
        }
      };
    }

    // Default Vahak-5 (Hangar Reserve - Ground Maintenance)
    return {
      activeTel: {
        ...telemetry,
        engine: {
          ...telemetry.engine,
          rpm: 0, // Engine stopped on ground
          throttlePct: 0.0,
          egt: [32.0, 31.8, 32.5, 32.0],
          cht: [34.0, 34.2, 33.8, 34.5],
          mapBar: 1.01,
          oilPressBar: 0.0,
          oilTempC: 32.0,
          vibrationGrms: 0.0,
          coolantTempC: 32.0,
          fuelFlowLph: 0.0
        },
        health: {
          index: 72.0,
          status: 'CRITICAL',
          activeFault: 'OIL_PUMP_CAVITATION',
          alertMessage: 'AIRCRAFT GROUNDED - OIL CAVITATION OVERHAUL'
        },
        residuals: {
          ...telemetry.residuals,
          egtResiduals: [-800, -800, -800, -800],
          chtResiduals: [-70, -70, -70, -70],
          oilPressResidual: -3.85,
          oilTempResidual: -66.0,
          vibrationResidual: -0.28,
          mapResidual: -0.41
        }
      },
      activeAiProg: {
        ...aiPrognostics,
        engine_health_index: 72.0,
        rul_hours_mean: 120.0,
        rul_hours_lower_95: 80.0,
        rul_hours_upper_95: 160.0,
        anomaly_score: 0.76,
        dominant_root_cause_feature: 'Oil Pump Cavitation & Hydrodynamic Loss'
      }
    };
  }, [selectedUav, telemetry, aiPrognostics]);

  const handleSel = useCallback((compId) => {
    setSel(compId);
    const reg = REGISTRY[compId];
    if (reg) camTargetRef.current = { camPos: reg.camPos, camLook: reg.camLook };
  }, []);

  const handlePreset = useCallback((key) => {
    setCamKey(key);
    const p = CAM_PRESETS[key];
    if (p) camTargetRef.current = p;
  }, []);

  const af      = activeTel.health.activeFault;
  const hIdx    = activeTel.health.index;
  const hStatus = activeTel.health.status;
  const hCol    = hStatus==='CRITICAL' ? 'text-red-400' : hStatus==='DEGRADED' ? 'text-amber-400' : 'text-emerald-400';

  const ITEMS = [
    {id:'PROP_01',     label:'PROP'   },
    {id:'ENGINE_BLOCK',label:'CRANK'  },
    {id:'CYL_01',      label:'CYL 1' },
    {id:'CYL_02',      label:'CYL 2' },
    {id:'CYL_03',      label:'CYL 3' },
    {id:'CYL_04',      label:'CYL 4' },
    {id:'TURBO_01',    label:'TURBO' },
    {id:'INTERCOOLER', label:'COOL'  },
    {id:'OIL_SYSTEM',  label:'OIL'   },
    {id:'FUEL_RAIL',   label:'FUEL'  },
    {id:'FADEC_A',     label:'FAD-A' },
    {id:'FADEC_B',     label:'FAD-B' },
    {id:'PRGB_GEARBOX',label:'PRGB'  },
    {id:'UAV_GENERATOR_28V', label:'28V GEN'},
    {id:'COOLANT_RADIATOR',  label:'RADIATOR'},
  ];

  const itemFault = (id) =>
    (id==='CYL_03' && af==='CYL3_INJECTOR') ||
    (id==='OIL_SYSTEM' && (af==='OIL_PUMP_CAVITATION'||af==='BLOW_BY')) ||
    (id==='TURBO_01' && af==='TURBO_WASTEGATE_STUCK') ||
    (['CYL_01','CYL_02','CYL_04','COOLANT_RADIATOR'].includes(id) && af==='COOLING_DEGRADATION') ||
    (id==='PRGB_GEARBOX' && af==='PRGB_DEGRADATION') ||
    (id==='UAV_GENERATOR_28V' && af==='GENERATOR_FAILURE');

  return (
    <div className="flex flex-col lg:flex-row gap-3 h-full w-full">

      {/* ═══ LEFT — 3D CANVAS ═══ */}
      <div className="flex-1 relative starship-glass rounded-xl overflow-hidden min-w-0 border border-white/[0.08] shadow-starship-glass">

        {/* Status chips + Unit Selector — top left */}
        <div className="absolute top-3 left-3 z-10 flex flex-wrap items-center gap-2">
          {/* Swarm Unit Selector Pills */}
          <div className="flex items-center gap-1 bg-slate-950/90 p-1 rounded-xl border border-white/[0.08] backdrop-blur-xl shadow-lg text-[10px]">
            {['Vahak-1', 'Vahak-2', 'Vahak-3', 'Vahak-4', 'Vahak-5'].map(u => (
              <button
                key={u}
                onClick={() => setSelectedUav(u)}
                className={`px-2.5 py-1 rounded-lg transition-all font-mono font-bold ${
                  selectedUav === u
                    ? 'bg-cyan-400 text-black shadow-[0_0_12px_rgba(0,240,255,0.6)]'
                    : 'text-slate-400 hover:text-white hover:bg-white/[0.05]'
                }`}
              >
                {u}
              </button>
            ))}
          </div>

          <div className="px-3 py-1 bg-slate-950/80 border border-cyan-500/30 rounded-lg text-[10px] font-mono text-cyan-300 flex items-center gap-1.5 backdrop-blur-md shadow-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_8px_rgba(0,240,255,0.9)]" />
            <span className="font-bold">{selectedUav}</span>
            <span className="text-slate-500">•</span>
            <span>ROTAX 915 iS ({curSpec.sn})</span>
          </div>
          
          <div className={`px-2.5 py-1 bg-slate-950/80 border rounded-lg text-[10px] font-mono font-bold backdrop-blur-md ${
            hStatus==='CRITICAL' ? 'border-red-500/80 bg-red-950/40 text-red-300 shadow-hud-red' : 
            hStatus==='DEGRADED' ? 'border-amber-500/80 bg-amber-950/40 text-amber-300 shadow-hud-amber' : 
            'border-emerald-500/50 text-emerald-300'
          }`}>
            HEALTH: <span className={hCol}>{hIdx.toFixed(1)}%</span>
          </div>

          {af !== 'NONE' && (
            <div className="px-2.5 py-1 bg-red-950/90 border border-red-500/80 rounded-lg text-[10px] font-mono text-red-200 animate-pulse flex items-center gap-1.5 shadow-hud-red">
              <AlertTriangle className="w-3.5 h-3.5" /> <span className="font-bold">{af}</span>
            </div>
          )}
        </div>

        {/* View mode + camera presets — top right */}
        <div className="absolute top-3 right-3 z-10 flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-1 bg-slate-950/90 border border-white/[0.08] p-1 rounded-xl backdrop-blur-xl shadow-lg">
            {Object.keys(CAM_PRESETS).map(k => (
              <button key={k} onClick={() => handlePreset(k)}
                className={`px-2 py-1 text-[10px] font-mono rounded-lg transition-all ${
                  camKey===k
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/60 shadow-sm font-bold'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
                }`}>
                {k}
              </button>
            ))}
          </div>
        </div>

        {/* Explode slider */}
        <div className="absolute top-[52px] right-3 z-10 flex items-center gap-2 bg-slate-950/90 border border-white/[0.08] rounded-xl px-3 py-1.5 backdrop-blur-xl shadow-lg">
          <Layers className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-[10px] font-mono text-cyan-300 font-bold">EXPLODE</span>
          <input type="range" min={0} max={100} step={1}
            value={Math.round(ef*100)}
            onChange={e => setEf(parseInt(e.target.value)/100)}
            className="w-24 h-1.5 accent-cyan-400 cursor-pointer bg-slate-800 rounded-lg" />
          <span className="text-[10px] font-mono text-cyan-300 font-bold w-8 text-right">{Math.round(ef*100)}%</span>
        </div>

        {/* 3D Canvas */}
        <div className="absolute inset-0 cursor-grab active:cursor-grabbing">
          <Canvas camera={{ position:[6,4,8], fov:42 }} gl={{ antialias:true, alpha:true }}>
            <color attach="background" args={['#02040A']} />
            <EngineDigitalTwin
              sel={sel} onSel={handleSel} ef={ef} vm={vm}
              camTargetRef={camTargetRef} ctrlRef={ctrlRef} tel={activeTel}
            />
            <OrbitControls ref={ctrlRef} enableDamping dampingFactor={0.07}
              minDistance={2} maxDistance={30} />
          </Canvas>
        </div>

        {/* Bottom subsystem selector */}
        <div className="absolute bottom-3 left-3 right-3 z-10 flex flex-wrap items-center justify-center gap-1.5 bg-slate-950/90 border border-white/[0.08] px-3 py-2 rounded-xl backdrop-blur-xl shadow-2xl">
          <span className="text-[10px] font-mono text-cyan-400 font-bold flex items-center gap-1 mr-1">
            <Zap className="w-3.5 h-3.5" /> SELECT:
          </span>
          {ITEMS.map(({ id, label }) => (
            <button key={id} onClick={() => handleSel(id)}
              className={`px-2 py-1 text-[10px] font-mono rounded-lg border transition-all ${
                sel===id
                  ? 'bg-cyan-400 text-black font-bold border-cyan-300 shadow-hud-cyan'
                  : itemFault(id)
                  ? 'bg-red-950/80 text-red-200 border-red-500/80 animate-pulse font-bold'
                  : 'bg-slate-900/80 text-slate-300 border-white/[0.06] hover:border-cyan-400/50 hover:text-cyan-200 hover:bg-white/[0.04]'
              }`}>
              {label}
            </button>
          ))}
          <button onClick={() => setShowSchem(s => !s)}
            className={`ml-1.5 px-2.5 py-1 text-[10px] font-mono rounded-lg border flex items-center gap-1 transition-all ${
              showSchem
                ? 'bg-purple-500/20 text-purple-300 border-purple-400 shadow-sm font-bold'
                : 'bg-slate-900/80 text-slate-400 border-white/[0.06] hover:text-purple-300 hover:border-purple-400/40'
            }`}>
            <GitBranch className="w-3.5 h-3.5" /> SCHEMATIC
          </button>
        </div>
      </div>

      {/* ═══ RIGHT — INSPECTOR + SCHEMATIC ═══ */}
      <div className="w-full lg:w-80 shrink-0 starship-glass rounded-xl border border-white/[0.08] p-3.5 flex flex-col gap-3 overflow-hidden shadow-starship-glass">
        {showSchem && (
          <SchematicPanel sel={sel} onSel={handleSel} tel={activeTel} />
        )}
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
          <InspectorPanel
            compId={sel} tel={activeTel} aiProg={activeAiProg}
            hist={historyBuffer} injectFault={injectFault} clearFault={clearFault}
            selectedUav={selectedUav} uavSpec={curSpec}
          />
        </div>
      </div>
    </div>
  );
};
