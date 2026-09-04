import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────
// COLOR HELPERS
// ─────────────────────────────────────────────────────────────
export function statusColor(residualAbs, isFault, nominal = '#10B981') {
  if (isFault) return '#EF4444';
  if (residualAbs > 40) return '#EF4444';
  if (residualAbs > 15) return '#F59E0B';
  return nominal;
}

export function thermalColor(tempC, minC = 80, maxC = 1000) {
  const t = Math.max(0, Math.min(1, (tempC - minC) / (maxC - minC)));
  if (t > 0.85) return '#EF4444';
  if (t > 0.65) return '#F59E0B';
  if (t > 0.35) return '#10B981';
  return '#0284C7';
}

export function healthColor(pct) {
  if (pct < 40) return '#EF4444';
  if (pct < 70) return '#F59E0B';
  return '#10B981';
}

export function matProps(color, isSelected, emissiveInt = 0.2) {
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
// ─────────────────────────────────────────────────────────────
export const REGISTRY = {
  PROP_01:      { id:'PROP_01',      label:'PROP',     name:'Propeller Assembly',          subsystem:'Propulsion',      camPos:[0,1,7],      camLook:[0,0,1.5], expOff:[0,0,3.0]   },
  ENGINE_BLOCK: { id:'ENGINE_BLOCK', label:'CRANK',    name:'Crankcase / Engine Core',     subsystem:'Powertrain',      camPos:[5,3,5],      camLook:[0,0,0],   expOff:[0,0,0]     },
  CYL_01:       { id:'CYL_01',       label:'CYL 1',    name:'Cylinder 1 (Left-Fwd)',       subsystem:'Combustion',      camPos:[-7,1,3],     camLook:[-2,0,0.7],expOff:[-2,0,0.6]  },
  CYL_02:       { id:'CYL_02',       label:'CYL 2',    name:'Cylinder 2 (Right-Fwd)',      subsystem:'Combustion',      camPos:[7,1,3],      camLook:[2,0,0.7], expOff:[2,0,0.6]   },
  CYL_03:       { id:'CYL_03',       label:'CYL 3',    name:'Cylinder 3 (Left-Aft) ⚡',    subsystem:'Combustion',      camPos:[-7,1,-3],    camLook:[-2,0,-0.7],expOff:[-2,0,-0.6] },
  CYL_04:       { id:'CYL_04',       label:'CYL 4',    name:'Cylinder 4 (Right-Aft)',      subsystem:'Combustion',      camPos:[7,1,-3],     camLook:[2,0,-0.7],expOff:[-2,0,-0.6]  },
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

export const CameraController = ({ targetRef, controlsRef }) => {
  useFrame(() => {
    const t = targetRef?.current;
    if (!t || !controlsRef?.current) return;
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

export const InlineLabel = ({ pos, rows }) => (
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

export const PropellerAssembly = ({ rpm = 4800, isSelected, onClick, basePos, ef = 0 }) => {
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
    <group position={pos} onClick={e => { e.stopPropagation(); onClick?.('PROP_01'); }}>
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

export const CrankcaseAssembly = ({ isSelected, onClick, basePos, ef = 0, tel, vm }) => {
  const col = vm === 'HEALTH'   ? healthColor(tel?.health?.index || 100)
            : vm === 'THERMAL'  ? thermalColor(tel?.engine?.oilTempC || 98, 80, 140)
            : '#647080';

  return (
    <group position={basePos} onClick={e => { e.stopPropagation(); onClick?.('ENGINE_BLOCK'); }}>
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
            { label: 'RPM',      value: `${Math.round(tel?.engine?.rpm || 4800)}` },
            { label: 'Throttle', value: `${(tel?.engine?.throttlePct || 78.5).toFixed(1)}%` },
            { label: 'Vib.',     value: `${(tel?.engine?.vibrationGrms || 0.28).toFixed(3)} g` },
          ]} />
        </>
      )}
    </group>
  );
};

export const CylinderUnit = ({ compId, cylIdx, basePos, side, tel, isSelected, onClick, ef = 0, vm }) => {
  const egt    = tel?.engine?.egt?.[cylIdx]  ?? 840;
  const cht    = tel?.engine?.cht?.[cylIdx]  ?? 106;
  const egtRes = Math.abs(tel?.residuals?.egtResiduals?.[cylIdx] ?? 0);
  const af     = tel?.health?.activeFault || 'NONE';

  const isFault =
    (cylIdx === 2 && af === 'CYL3_INJECTOR') ||
    (cylIdx === 1 && af === 'BLOW_BY') ||
    af === 'COOLING_DEGRADATION';
  const isBlowBy = (cylIdx === 1 && af === 'BLOW_BY');

  const col = vm === 'THERMAL' ? thermalColor(egt, 820, 990)
            : vm === 'HEALTH'  ? healthColor(tel?.health?.index || 100)
            : statusColor(egtRes, isFault, '#16A34A');

  const expOff = REGISTRY[compId]?.expOff || [0,0,0];
  const pos = [basePos[0]+expOff[0]*ef, basePos[1]+expOff[1]*ef, basePos[2]+expOff[2]*ef];
  const xDir = side === 'left' ? -1 : 1;
  const rotZ = side === 'left' ? -Math.PI/2 : Math.PI/2;

  const groupRef = useRef();
  const pistonRef = useRef();
  const conRodRef = useRef();

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const vib = tel?.engine?.vibrationGrms || 0.28;
    const base = basePos[1] + expOff[1] * ef;
    if (vib > 0.8) {
      groupRef.current.position.y = base + Math.sin(clock.elapsedTime * 40) * (vib - 0.28) * 0.012;
    } else {
      groupRef.current.position.y = base;
    }

    // Dynamic 4-stroke piston reciprocation
    if (pistonRef.current) {
      const rpm = tel?.engine?.rpm ?? 4800;
      const firingPhases = [0, Math.PI, Math.PI * 0.5, Math.PI * 1.5];
      const strokePhase = clock.elapsedTime * (rpm / 60) * Math.PI * 2 + firingPhases[cylIdx];
      const strokeTravel = Math.sin(strokePhase) * 0.16;
      pistonRef.current.position.x = (0.28 + strokeTravel) * xDir + (ef * 0.45 * xDir);

      if (conRodRef.current) {
        conRodRef.current.rotation.z = -Math.cos(strokePhase) * 0.14 * xDir;
      }
    }
  });

  return (
    <group ref={groupRef} position={pos} onClick={e => { e.stopPropagation(); onClick?.(compId); }}>
      {/* Outer Cylinder Barrel (Translucent when selected or exploded to reveal internal piston) */}
      <mesh rotation={[0, 0, rotZ]}>
        <cylinderGeometry args={[0.27, 0.27, 1.35, 20]} />
        <meshStandardMaterial
          {...matProps(col, isSelected, isFault ? 0.65 : 0.22)}
          transparent={true}
          opacity={isSelected ? 0.38 : (ef > 0.05 ? Math.max(0.28, 0.88 - ef * 0.7) : 0.88)}
          roughness={isSelected ? 0.1 : 0.35}
        />
      </mesh>

      {/* ── INTERNAL RECIPROCATING PISTON ASSEMBLY ── */}
      <group ref={pistonRef} position={[xDir * 0.28, 0, 0]}>
        {/* Piston Crown & Skirt (Forged Aircraft Aluminum) */}
        <mesh rotation={[0, 0, rotZ]}>
          <cylinderGeometry args={[0.245, 0.245, 0.32, 20]} />
          <meshStandardMaterial
            color={isBlowBy ? '#F59E0B' : (isSelected ? '#38BDF8' : '#CBD5E1')}
            metalness={0.92}
            roughness={0.18}
            emissive={isBlowBy ? '#EF4444' : (isSelected ? '#00F0FF' : '#000000')}
            emissiveIntensity={isBlowBy ? 0.6 : (isSelected ? 0.2 : 0)}
          />
        </mesh>

        {/* Piston Crown Top Face (Combustion Dome) */}
        <mesh position={[xDir * 0.17, 0, 0]} rotation={[0, 0, rotZ]}>
          <cylinderGeometry args={[0.246, 0.246, 0.02, 20]} />
          <meshStandardMaterial
            color={vm === 'THERMAL' ? thermalColor(egt, 820, 990) : (isBlowBy ? '#DC2626' : '#94A3B8')}
            metalness={0.95}
            roughness={0.15}
            emissive={vm === 'THERMAL' ? thermalColor(egt, 820, 990) : (isBlowBy ? '#EF4444' : '#000000')}
            emissiveIntensity={isBlowBy ? 0.7 : (vm === 'THERMAL' ? 0.4 : 0)}
          />
        </mesh>

        {/* 3x Piston Compression & Oil Scraper Rings */}
        {[-0.04, 0.0, 0.04].map((ringZ, rIdx) => (
          <mesh key={rIdx} position={[xDir * (0.10 + ringZ), 0, 0]} rotation={[0, 0, rotZ]}>
            <cylinderGeometry args={[0.252, 0.252, 0.015, 20]} />
            <meshStandardMaterial
              color={isBlowBy ? '#EF4444' : '#334155'}
              metalness={0.98}
              roughness={0.1}
              emissive={isBlowBy ? '#EF4444' : '#000000'}
              emissiveIntensity={isBlowBy ? 0.9 : 0}
            />
          </mesh>
        ))}

        {/* Wrist Pin (Gudgeon Pin) */}
        <mesh position={[-xDir * 0.02, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.042, 0.042, 0.24, 12]} />
          <meshStandardMaterial color="#64748B" metalness={0.95} roughness={0.1} />
        </mesh>

        {/* H-Beam Connecting Rod */}
        <group ref={conRodRef} position={[-xDir * 0.02, 0, 0]}>
          <mesh position={[-xDir * 0.28, 0, 0]} rotation={[0, 0, rotZ]}>
            <boxGeometry args={[0.065, 0.48, 0.065]} />
            <meshStandardMaterial color="#64748B" metalness={0.88} roughness={0.25} />
          </mesh>
          {/* Rod Small End (Around Wrist Pin) */}
          <mesh position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.065, 0.065, 0.12, 12]} />
            <meshStandardMaterial color="#94A3B8" metalness={0.9} roughness={0.2} />
          </mesh>
          {/* Rod Big End (Around Crankshaft Pin) */}
          <mesh position={[-xDir * 0.54, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.088, 0.088, 0.14, 16]} />
            <meshStandardMaterial color="#475569" metalness={0.92} roughness={0.2} />
          </mesh>
        </group>
      </group>

      {/* Cylinder Head Cap */}
      <mesh position={[xDir * 0.78, 0, 0]} rotation={[0, 0, rotZ]}>
        <cylinderGeometry args={[0.31, 0.27, 0.24, 20]} />
        <meshStandardMaterial color={isSelected ? '#00F0FF' : '#3B4B5F'} metalness={0.82} roughness={0.3} />
      </mesh>

      {/* Cooling Fins */}
      {[0,1,2,3,4].map(fi => (
        <mesh key={fi} position={[xDir * (0.05 + fi * 0.26), 0, 0]} rotation={[0, 0, rotZ]}>
          <cylinderGeometry args={[0.35, 0.35, 0.045, 20]} />
          <meshStandardMaterial color="#273040" metalness={0.72} roughness={0.55} />
        </mesh>
      ))}

      {/* Spark Plug & Fuel Injector Port */}
      <mesh position={[xDir * 0.55, 0.32, 0.08]}>
        <cylinderGeometry args={[0.022, 0.022, 0.38, 8]} />
        <meshStandardMaterial color="#F59E0B" metalness={0.92} roughness={0.1}
          emissive="#F59E0B" emissiveIntensity={0.45} />
      </mesh>

      {/* Exhaust Flange */}
      <mesh position={[xDir * 0.12, -0.28, 0.18]} rotation={[0.38, 0, 0.28 * xDir]}>
        <cylinderGeometry args={[0.065, 0.055, 0.48, 8]} />
        <meshStandardMaterial color="#7C3AED" metalness={0.62} roughness={0.6} />
      </mesh>

      {/* Inspection Wireframe & HUD Overlay */}
      {isSelected && (
        <>
          <mesh position={[xDir * 0.05, 0, 0]} rotation={[0, 0, rotZ]}>
            <cylinderGeometry args={[0.42, 0.42, 1.7, 20]} />
            <meshBasicMaterial color="#00F0FF" wireframe />
          </mesh>
          <InlineLabel pos={[xDir * 1.6, 0.9, 0]} rows={[
            { value: `${compId} • PISTON & CYLINDER`, color: '#00F0FF' },
            { label: 'EGT', value: `${egt.toFixed(1)}°C`, color: egtRes > 40 ? '#EF4444' : egtRes > 15 ? '#F59E0B' : '#10B981' },
            { label: 'CHT', value: `${cht.toFixed(1)}°C` },
            { label: 'Piston Speed', value: `${(((tel?.engine?.rpm || 4800) * 2 * 0.061) / 60).toFixed(1)} m/s` },
            { label: 'Piston Ring', value: isBlowBy ? '⚠ BLOW-BY LEAK' : 'SEALED (100%)', color: isBlowBy ? '#EF4444' : '#10B981' },
            ...(isFault ? [{ value: '⚠ FAULT DETECTED', color: '#EF4444' }] : []),
          ]} />
        </>
      )}
    </group>
  );
};

export const TurboAssembly = ({ isSelected, onClick, basePos, ef = 0, tel, vm }) => {
  const af     = tel?.health?.activeFault || 'NONE';
  const isFault = af === 'TURBO_WASTEGATE_STUCK';
  const mapRes  = Math.abs(tel?.residuals?.mapResidual ?? 0);

  const col = vm === 'THERMAL' ? thermalColor(tel?.engine?.oilTempC || 98, 80, 160)
            : vm === 'HEALTH'  ? healthColor(tel?.health?.index || 100)
            : statusColor(mapRes * 80, isFault, '#00B4D8');

  const expOff = REGISTRY.TURBO_01.expOff;
  const pos = [basePos[0]+expOff[0]*ef, basePos[1]+expOff[1]*ef, basePos[2]+expOff[2]*ef];

  const compRef = useRef();
  useFrame((_, dt) => {
    if (compRef.current) {
      compRef.current.rotation.z += (((tel?.engine?.rpm || 4800) * 4.5 / 60) * Math.PI * 2) * dt * 0.004;
    }
  });

  return (
    <group position={pos} onClick={e => { e.stopPropagation(); onClick?.('TURBO_01'); }}>
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
      {isSelected && (
        <>
          <mesh>
            <sphereGeometry args={[0.72, 12, 12]} />
            <meshBasicMaterial color="#00F0FF" wireframe />
          </mesh>
          <InlineLabel pos={[0, 1.1, 0]} rows={[
            { value: 'TURBO_01' },
            { label: 'MAP',     value: `${(tel?.engine?.mapBar || 1.42).toFixed(3)} bar` },
            ...(isFault ? [{ value: '⚠ WASTEGATE STUCK', color: '#EF4444' }] : []),
          ]} />
        </>
      )}
    </group>
  );
};

export const IntercoolerAssembly = ({ isSelected, onClick, basePos, ef = 0, tel, vm }) => {
  const expOff = REGISTRY.INTERCOOLER.expOff;
  const pos = [basePos[0]+expOff[0]*ef, basePos[1]+expOff[1]*ef, basePos[2]+expOff[2]*ef];
  const iat  = (tel?.mission?.ambientTempC || 15) + 55 + ((tel?.engine?.mapBar || 1.42) - 1.0) * 28;
  const col  = vm === 'THERMAL' ? thermalColor(iat, 20, 120) : (isSelected ? '#00F0FF' : '#0369A1');

  return (
    <group position={pos} onClick={e => { e.stopPropagation(); onClick?.('INTERCOOLER'); }}>
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
      {isSelected && (
        <InlineLabel pos={[0, 0.8, 0]} rows={[
          { value: 'INTERCOOLER' },
          { label: 'IAT (est.)', value: `${iat.toFixed(1)}°C` },
        ]} />
      )}
    </group>
  );
};

export const OilSystemAssembly = ({ isSelected, onClick, basePos, ef = 0, tel, vm }) => {
  const af      = tel?.health?.activeFault || 'NONE';
  const isFault = af === 'OIL_PUMP_CAVITATION' || af === 'BLOW_BY';

  const col = vm === 'THERMAL' ? thermalColor(tel?.engine?.oilTempC || 98, 80, 150)
            : vm === 'HEALTH'  ? healthColor(tel?.health?.index || 100)
            : (isFault ? '#EF4444' : '#D97706');

  const expOff = REGISTRY.OIL_SYSTEM.expOff;
  const pos = [basePos[0]+expOff[0]*ef, basePos[1]+expOff[1]*ef, basePos[2]+expOff[2]*ef];

  return (
    <group position={pos} onClick={e => { e.stopPropagation(); onClick?.('OIL_SYSTEM'); }}>
      <mesh>
        <boxGeometry args={[1.15, 0.38, 1.3]} />
        <meshStandardMaterial {...matProps(col, isSelected, isFault ? 0.72 : 0.3)} />
      </mesh>
      {isSelected && (
        <InlineLabel pos={[0, 0.7, 0]} rows={[
          { value: 'OIL_SYSTEM' },
          { label: 'Pressure', value: `${(tel?.engine?.oilPressBar || 3.85).toFixed(2)} bar`, color: isFault ? '#EF4444' : '#10B981' },
          { label: 'Temp',     value: `${(tel?.engine?.oilTempC || 98).toFixed(1)}°C` },
          ...(isFault ? [{ value: '⚠ OIL DISTRESS', color: '#EF4444' }] : []),
        ]} />
      )}
    </group>
  );
};

export const FuelRailAssembly = ({ isSelected, onClick, basePos, ef = 0, tel }) => {
  const expOff = REGISTRY.FUEL_RAIL.expOff;
  const pos = [basePos[0]+expOff[0]*ef, basePos[1]+expOff[1]*ef, basePos[2]+expOff[2]*ef];
  const col = isSelected ? '#00F0FF' : '#0EA5E9';

  return (
    <group position={pos} onClick={e => { e.stopPropagation(); onClick?.('FUEL_RAIL'); }}>
      <mesh rotation={[0, Math.PI / 2, 0]}>
        <cylinderGeometry args={[0.048, 0.048, 1.9, 8]} />
        <meshStandardMaterial color={col} metalness={0.85} roughness={0.28} emissive={col} emissiveIntensity={0.25} />
      </mesh>
      {isSelected && (
        <InlineLabel pos={[0, 0.5, 0]} rows={[
          { value: 'FUEL_RAIL' },
          { label: 'Flow', value: `${(tel?.engine?.fuelFlowLph || 26.4).toFixed(1)} L/h` },
        ]} />
      )}
    </group>
  );
};

export const FadecUnit = ({ compId, lane, isSelected, onClick, basePos, ef = 0, tel }) => {
  const expOff = REGISTRY[compId].expOff;
  const pos = [basePos[0]+expOff[0]*ef, basePos[1]+expOff[1]*ef, basePos[2]+expOff[2]*ef];
  const col = isSelected ? '#00F0FF' : '#1D4ED8';

  return (
    <group position={pos} onClick={e => { e.stopPropagation(); onClick?.(compId); }}>
      <mesh>
        <boxGeometry args={[0.52, 0.32, 0.7]} />
        <meshStandardMaterial color={col} emissive={col} emissiveIntensity={0.42} metalness={0.72} roughness={0.4} />
      </mesh>
      {isSelected && (
        <InlineLabel pos={[0, 0.7, 0]} rows={[
          { value: compId },
          { label: `Lane ${lane}`, value: 'ACTIVE' },
        ]} />
      )}
    </group>
  );
};

export const PrgbAssembly = ({ isSelected, onClick, basePos, ef = 0, tel, vm }) => {
  const expOff = REGISTRY.PRGB_GEARBOX.expOff;
  const pos = [basePos[0]+expOff[0]*ef, basePos[1]+expOff[1]*ef, basePos[2]+expOff[2]*ef];
  const isFault = tel?.health?.activeFault === 'PRGB_DEGRADATION';
  const col = vm === 'HEALTH' ? healthColor(tel?.health?.index || 100) : (isFault ? '#EF4444' : '#475569');

  return (
    <group position={pos} onClick={e => { e.stopPropagation(); onClick?.('PRGB_GEARBOX'); }}>
      <mesh rotation={[Math.PI/2, 0, 0]}>
        <cylinderGeometry args={[0.5, 0.65, 0.5, 32]} />
        <meshStandardMaterial {...matProps(col, isSelected, isFault ? 0.65 : 0.1)} />
      </mesh>
      {isSelected && (
        <InlineLabel pos={[1.2, 0, 0]} rows={[
          { value: 'PRGB_GEARBOX' },
          { label: 'Vibration', value: `${(tel?.engine?.vibrationGrms || 0.28).toFixed(2)} g` }
        ]} />
      )}
    </group>
  );
};

export const GeneratorAssembly = ({ isSelected, onClick, basePos, ef = 0, tel, vm }) => {
  const expOff = REGISTRY.UAV_GENERATOR_28V.expOff;
  const pos = [basePos[0]+expOff[0]*ef, basePos[1]+expOff[1]*ef, basePos[2]+expOff[2]*ef];
  const isFault = tel?.health?.activeFault === 'GENERATOR_FAILURE';
  const col = isFault ? '#EF4444' : '#D97706';

  return (
    <group position={pos} onClick={e => { e.stopPropagation(); onClick?.('UAV_GENERATOR_28V'); }}>
      <mesh rotation={[0, 0, Math.PI/2]}>
        <cylinderGeometry args={[0.25, 0.25, 0.6, 16]} />
        <meshStandardMaterial {...matProps(col, isSelected, isFault ? 0.65 : 0.2)} />
      </mesh>
    </group>
  );
};

export const RadiatorAssembly = ({ isSelected, onClick, basePos, ef = 0, tel, vm }) => {
  const expOff = REGISTRY.COOLANT_RADIATOR.expOff;
  const pos = [basePos[0]+expOff[0]*ef, basePos[1]+expOff[1]*ef, basePos[2]+expOff[2]*ef];
  const isFault = tel?.health?.activeFault === 'COOLING_DEGRADATION';
  const temp = tel?.engine?.coolantTempC || 88.5;
  const col = isFault ? '#EF4444' : (isSelected ? '#00F0FF' : '#0F172A');

  return (
    <group position={pos} onClick={e => { e.stopPropagation(); onClick?.('COOLANT_RADIATOR'); }}>
      <mesh>
        <boxGeometry args={[1.2, 0.6, 0.1]} />
        <meshStandardMaterial {...matProps(col, isSelected, isFault ? 0.5 : 0.1)} />
      </mesh>
    </group>
  );
};

export const FlowPipes = ({ ef = 0 }) => {
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
      <mesh position={[1.65,-0.55,0.68]} rotation={[0.72,0,-0.28]}>
        <cylinderGeometry args={[0.052,0.052,0.85,8]} />
        <meshStandardMaterial {...exh} />
      </mesh>
      <mesh position={[0,0.60,0]} rotation={[0,Math.PI/2,0]}>
        <cylinderGeometry args={[0.052,0.052,2.05,8]} />
        <meshStandardMaterial {...inh} />
      </mesh>
    </group>
  );
};

export const CadGrid = () => (
  <group position={[0,-2.4,0]} rotation={[-Math.PI/2,0,0]}>
    <gridHelper args={[28,56,'#00F0FF','#0D1F35']} rotation={[Math.PI/2,0,0]} />
    <mesh position={[0,0,-0.01]}>
      <ringGeometry args={[4.8,4.84,64]} />
      <meshBasicMaterial color="#00F0FF" opacity={0.12} transparent side={THREE.DoubleSide} />
    </mesh>
  </group>
);

// ─────────────────────────────────────────────────────────────
// ENGINE DIGITAL TWIN — Composite Scene
// ─────────────────────────────────────────────────────────────
export const EngineDigitalTwin = ({ sel, onSel, ef = 0, vm = 'DEFAULT', camTargetRef, ctrlRef, tel }) => {
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

  const ptLightCol = tel?.health?.status==='CRITICAL' ? '#EF4444'
                   : tel?.health?.status==='DEGRADED'  ? '#F59E0B'
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

      <PropellerAssembly rpm={tel?.engine?.rpm || 4800} isSelected={sel==='PROP_01'}
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
