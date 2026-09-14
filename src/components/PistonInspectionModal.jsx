import React, { useState, useRef, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import {
  X, Play, Pause, RotateCcw, Activity, Flame, AlertTriangle,
  Eye
} from 'lucide-react';

/**
 * High-precision single cylinder and piston 3D cutaway
 */
const SingleCylinderCutaway = ({
  crankAngle,
  isBlowBy,
  pistonTempC = 115
}) => {
  const r = 0.61;
  const l = 2.2;

  const theta = (crankAngle * Math.PI) / 180;
  const sinTheta = Math.sin(theta);
  const cosTheta = Math.cos(theta);
  const pistonDisp = r * (1 - cosTheta) + l - Math.sqrt(Math.max(0.01, l * l - (r * sinTheta) * (r * sinTheta)));
  const pistonY = 1.4 - (pistonDisp * 0.95);
  const rodAngle = Math.asin(Math.max(-0.95, Math.min(0.95, (r / l) * sinTheta)));

  let intakeLift = 0;
  if (crankAngle >= 0 && crankAngle < 180) {
    intakeLift = Math.sin((crankAngle / 180) * Math.PI) * 0.22;
  }

  let exhaustLift = 0;
  if (crankAngle >= 540 && crankAngle < 720) {
    exhaustLift = Math.sin(((crankAngle - 540) / 180) * Math.PI) * 0.22;
  }

  const isSparkFiring = crankAngle >= 355 && crankAngle <= 375;
  const isCombustionFlame = crankAngle >= 360 && crankAngle <= 450;
  const flameIntensity = isCombustionFlame ? Math.sin(((crankAngle - 360) / 90) * Math.PI) : 0;
  const blowByFlame = isBlowBy && (crankAngle >= 360 && crankAngle <= 500);

  return (
    <group position={[0, -0.4, 0]}>
      {/* 1. CUTAWAY CYLINDER BARREL & COOLING FINS */}
      <mesh position={[0, 0.7, 0]} rotation={[0, Math.PI * 0.25, 0]}>
        <cylinderGeometry args={[0.92, 0.92, 2.6, 32, 1, false, 0, Math.PI * 1.5]} />
        <meshStandardMaterial
          color="#1E293B"
          metalness={0.7}
          roughness={0.4}
          side={THREE.DoubleSide}
        />
      </mesh>

      <mesh position={[0, 0.7, 0]} rotation={[0, Math.PI * 0.25, 0]}>
        <cylinderGeometry args={[0.845, 0.845, 2.58, 32, 1, false, 0, Math.PI * 1.5]} />
        <meshStandardMaterial
          color="#64748B"
          metalness={0.92}
          roughness={0.2}
          side={THREE.BackSide}
        />
      </mesh>

      {[-0.3, 0.1, 0.5, 0.9, 1.3, 1.7].map((finY, fi) => (
        <mesh key={fi} position={[0, finY, 0]} rotation={[0, Math.PI * 0.25, 0]}>
          <cylinderGeometry args={[1.2, 1.2, 0.05, 32, 1, false, 0, Math.PI * 1.5]} />
          <meshStandardMaterial color="#0F172A" metalness={0.8} roughness={0.4} side={THREE.DoubleSide} />
        </mesh>
      ))}

      {/* 2. CYLINDER HEAD & VALVES */}
      <mesh position={[0, 2.15, 0]}>
        <cylinderGeometry args={[0.98, 0.98, 0.35, 32]} />
        <meshStandardMaterial color="#334155" metalness={0.85} roughness={0.3} />
      </mesh>

      <group position={[0, 2.35, 0]}>
        <mesh position={[0, 0.15, 0]}>
          <cylinderGeometry args={[0.07, 0.07, 0.45, 12]} />
          <meshStandardMaterial color="#F8FAFC" metalness={0.2} roughness={0.1} />
        </mesh>
        <mesh position={[0, 0.35, 0]}>
          <cylinderGeometry args={[0.04, 0.04, 0.15, 8]} />
          <meshStandardMaterial color="#D97706" metalness={0.9} roughness={0.2} />
        </mesh>
        <mesh position={[0, -0.25, 0]}>
          <cylinderGeometry args={[0.02, 0.02, 0.12, 8]} />
          <meshStandardMaterial
            color={isSparkFiring ? '#38BDF8' : '#64748B'}
            emissive={isSparkFiring ? '#38BDF8' : '#000000'}
            emissiveIntensity={isSparkFiring ? 5.0 : 0}
          />
        </mesh>
        {isSparkFiring && (
          <pointLight position={[0, -0.3, 0]} color="#38BDF8" intensity={4} distance={1.5} />
        )}
      </group>

      <group position={[-0.38, 2.05 - intakeLift, 0]}>
        <mesh position={[0, 0.3, 0]}>
          <cylinderGeometry args={[0.035, 0.035, 0.7, 12]} />
          <meshStandardMaterial color="#94A3B8" metalness={0.9} roughness={0.2} />
        </mesh>
        <mesh position={[0, -0.05, 0]}>
          <cylinderGeometry args={[0.26, 0.04, 0.08, 16]} />
          <meshStandardMaterial
            color={intakeLift > 0.02 ? '#0284C7' : '#CBD5E1'}
            metalness={0.92}
            roughness={0.15}
          />
        </mesh>
        {intakeLift > 0.04 && (
          <mesh position={[0, -0.15, 0]}>
            <sphereGeometry args={[0.15, 12, 12]} />
            <meshBasicMaterial color="#00F0FF" transparent opacity={0.35} />
          </mesh>
        )}
      </group>

      <group position={[0.38, 2.05 - exhaustLift, 0]}>
        <mesh position={[0, 0.3, 0]}>
          <cylinderGeometry args={[0.035, 0.035, 0.7, 12]} />
          <meshStandardMaterial color="#94A3B8" metalness={0.9} roughness={0.2} />
        </mesh>
        <mesh position={[0, -0.05, 0]}>
          <cylinderGeometry args={[0.24, 0.04, 0.08, 16]} />
          <meshStandardMaterial
            color={exhaustLift > 0.02 ? '#EF4444' : '#CBD5E1'}
            metalness={0.92}
            roughness={0.15}
          />
        </mesh>
        {exhaustLift > 0.04 && (
          <mesh position={[0, -0.15, 0]}>
            <sphereGeometry args={[0.16, 12, 12]} />
            <meshBasicMaterial color="#EF4444" transparent opacity={0.4} />
          </mesh>
        )}
      </group>

      {isCombustionFlame && (
        <group position={[0, 1.85, 0]}>
          <mesh>
            <sphereGeometry args={[0.55 * (0.6 + flameIntensity * 0.4), 16, 16]} />
            <meshBasicMaterial
              color={isBlowBy ? '#EF4444' : '#F59E0B'}
              transparent
              opacity={0.65 * flameIntensity}
            />
          </mesh>
          <pointLight
            position={[0, 0, 0]}
            color={isBlowBy ? '#EF4444' : '#F59E0B'}
            intensity={flameIntensity * 4.5}
            distance={2.5}
          />
        </group>
      )}

      {/* 3. RECIPROCATING PISTON ASSEMBLY */}
      <group position={[0, pistonY, 0]}>
        <mesh position={[0, 0, 0]}>
          <cylinderGeometry args={[0.835, 0.835, 0.95, 32]} />
          <meshStandardMaterial
            color={isBlowBy ? '#F59E0B' : '#E2E8F0'}
            metalness={0.92}
            roughness={0.18}
            emissive={isBlowBy ? '#EF4444' : '#000000'}
            emissiveIntensity={isBlowBy ? 0.35 : 0}
          />
        </mesh>

        <mesh position={[0, 0.48, 0]}>
          <cylinderGeometry args={[0.836, 0.836, 0.04, 32]} />
          <meshStandardMaterial
            color={isCombustionFlame ? '#EF4444' : '#94A3B8'}
            metalness={0.94}
            roughness={0.2}
            emissive={isCombustionFlame ? '#F59E0B' : '#000000'}
            emissiveIntensity={isCombustionFlame ? flameIntensity * 0.8 : 0}
          />
        </mesh>

        <mesh position={[0, 0.49, 0]}>
          <cylinderGeometry args={[0.45, 0.38, 0.05, 24]} />
          <meshStandardMaterial color="#475569" metalness={0.85} roughness={0.3} />
        </mesh>

        {/* Rings */}
        <mesh position={[0, 0.35, 0]}>
          <cylinderGeometry args={[0.855, 0.855, 0.035, 32]} />
          <meshStandardMaterial
            color={blowByFlame ? '#EF4444' : '#1E293B'}
            metalness={0.98}
            roughness={0.08}
            emissive={blowByFlame ? '#EF4444' : '#000000'}
            emissiveIntensity={blowByFlame ? 0.95 : 0}
          />
        </mesh>
        <mesh position={[0, 0.24, 0]}>
          <cylinderGeometry args={[0.855, 0.855, 0.035, 32]} />
          <meshStandardMaterial
            color={blowByFlame ? '#F97316' : '#334155'}
            metalness={0.98}
            roughness={0.1}
            emissive={blowByFlame ? '#F97316' : '#000000'}
            emissiveIntensity={blowByFlame ? 0.75 : 0}
          />
        </mesh>
        <mesh position={[0, 0.12, 0]}>
          <cylinderGeometry args={[0.852, 0.852, 0.05, 32]} />
          <meshStandardMaterial
            color={blowByFlame ? '#F59E0B' : '#475569'}
            metalness={0.95}
            roughness={0.15}
            emissive={blowByFlame ? '#F59E0B' : '#000000'}
            emissiveIntensity={blowByFlame ? 0.6 : 0}
          />
        </mesh>

        {blowByFlame && (
          <group position={[0, 0.15, 0.4]}>
            {[-0.2, 0, 0.2].map((x, i) => (
              <mesh key={i} position={[x, -0.25 - i * 0.1, 0]}>
                <sphereGeometry args={[0.08, 8, 8]} />
                <meshBasicMaterial color="#EF4444" transparent opacity={0.7} />
              </mesh>
            ))}
          </group>
        )}

        <mesh position={[0, -0.22, 0.35]}>
          <boxGeometry args={[0.65, 0.42, 0.18]} />
          <meshStandardMaterial color="#0F172A" roughness={0.9} />
        </mesh>
        <mesh position={[0, -0.22, -0.35]}>
          <boxGeometry args={[0.65, 0.42, 0.18]} />
          <meshStandardMaterial color="#0F172A" roughness={0.9} />
        </mesh>

        <mesh position={[0, -0.08, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.13, 0.13, 0.88, 20]} />
          <meshStandardMaterial color="#64748B" metalness={0.98} roughness={0.08} />
        </mesh>

        {/* 4. CONNECTING ROD */}
        <group position={[0, -0.08, 0]} rotation={[0, 0, rodAngle]}>
          <mesh position={[0, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.20, 0.20, 0.38, 20]} />
            <meshStandardMaterial color="#CBD5E1" metalness={0.9} roughness={0.2} />
          </mesh>
          <mesh position={[0, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.145, 0.145, 0.40, 16]} />
            <meshStandardMaterial color="#D97706" metalness={0.92} roughness={0.3} />
          </mesh>
          <mesh position={[0, -1.05, 0]}>
            <boxGeometry args={[0.22, 1.8, 0.22]} />
            <meshStandardMaterial color="#64748B" metalness={0.88} roughness={0.25} />
          </mesh>
          <mesh position={[0, -1.05, 0.08]}>
            <boxGeometry args={[0.12, 1.6, 0.08]} />
            <meshStandardMaterial color="#334155" metalness={0.85} roughness={0.35} />
          </mesh>
          <mesh position={[0, -1.05, -0.08]}>
            <boxGeometry args={[0.12, 1.6, 0.08]} />
            <meshStandardMaterial color="#334155" metalness={0.85} roughness={0.35} />
          </mesh>
          <mesh position={[0, -2.1, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.32, 0.32, 0.44, 24]} />
            <meshStandardMaterial color="#475569" metalness={0.92} roughness={0.18} />
          </mesh>
          <mesh position={[-0.24, -2.1, 0]}>
            <cylinderGeometry args={[0.045, 0.045, 0.52, 12]} />
            <meshStandardMaterial color="#F8FAFC" metalness={0.95} roughness={0.1} />
          </mesh>
          <mesh position={[0.24, -2.1, 0]}>
            <cylinderGeometry args={[0.045, 0.045, 0.52, 12]} />
            <meshStandardMaterial color="#F8FAFC" metalness={0.95} roughness={0.1} />
          </mesh>
        </group>
      </group>

      {/* 5. CRANKSHAFT CRANKPIN */}
      <group position={[0, -1.9, 0]}>
        <mesh position={[0, 0, -0.35]} rotation={[0, 0, theta]}>
          <cylinderGeometry args={[0.65, 0.65, 0.22, 24, 1, false, 0, Math.PI]} />
          <meshStandardMaterial color="#334155" metalness={0.9} roughness={0.25} />
        </mesh>
        <mesh position={[r * sinTheta, -r * cosTheta, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.22, 0.22, 0.48, 20]} />
          <meshStandardMaterial color="#CBD5E1" metalness={0.98} roughness={0.08} />
        </mesh>
      </group>
    </group>
  );
};

/**
 * Interactive P-V Indicator Diagram
 */
const PvIndicatorDiagram = ({ crankAngle, isBlowBy, rpm = 4800 }) => {
  const deg = crankAngle % 720;
  let pressureBar = 1.4;
  let strokeName = 'INTAKE';
  let strokeColor = '#0284C7';

  if (deg < 180) {
    strokeName = 'INTAKE';
    strokeColor = '#0284C7';
    pressureBar = 1.35 + Math.sin((deg / 180) * Math.PI) * 0.15;
  } else if (deg < 360) {
    strokeName = 'COMPRESSION';
    strokeColor = '#10B981';
    const compRatio = 1 + ((deg - 180) / 180) * 8.0;
    pressureBar = 1.45 * Math.pow(compRatio, 1.33);
  } else if (deg < 540) {
    strokeName = 'COMBUSTION / POWER';
    strokeColor = '#F59E0B';
    const peakMax = isBlowBy ? 92.5 : 134.8;
    if (deg < 380) {
      const t = (deg - 360) / 20;
      pressureBar = 32 + (peakMax - 32) * Math.sin(t * (Math.PI / 2));
    } else {
      const t = (deg - 380) / 160;
      pressureBar = peakMax * Math.pow(Math.max(0.01, 1 - t * 0.82), 1.3);
    }
  } else {
    strokeName = 'EXHAUST';
    strokeColor = '#EF4444';
    pressureBar = 4.8 - ((deg - 540) / 180) * 3.4;
  }

  const normVolume = 0.5 - 0.5 * Math.cos((deg * Math.PI) / 180);
  const volumeCc = 39.3 + normVolume * 353.5;

  const svgX = 35 + ((volumeCc - 39.3) / 353.5) * 200;
  const maxP = 145;
  const svgY = 145 - (Math.min(maxP, pressureBar) / maxP) * 125;

  const pathD = "M 35 120 C 90 120, 180 125, 235 128 L 235 124 C 160 115, 80 85, 35 105 L 35 25 C 60 40, 140 85, 235 118 L 235 125 Z";

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-col gap-2 shadow-xs">
      <div className="flex items-center justify-between text-[11px] font-mono">
        <span className="font-bold text-slate-800 flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5 text-sky-600" />
          INDICATOR P-V DIAGRAM (OTTO CYCLE)
        </span>
        <span className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ backgroundColor: strokeColor + '20', color: strokeColor }}>
          {strokeName}
        </span>
      </div>

      <div className="relative w-full h-[150px] bg-slate-50 rounded-lg border border-slate-200 flex items-center justify-center overflow-hidden">
        <svg viewBox="0 0 280 160" className="w-full h-full">
          <line x1="35" y1="20" x2="35" y2="145" stroke="#CBD5E1" strokeWidth="1" strokeDasharray="2,2" />
          <line x1="35" y1="145" x2="255" y2="145" stroke="#CBD5E1" strokeWidth="1" />
          <line x1="235" y1="20" x2="235" y2="145" stroke="#CBD5E1" strokeWidth="1" strokeDasharray="2,2" />

          <text x="35" y="156" fill="#64748B" fontSize="8" fontFamily="monospace" textAnchor="middle">TDC (39cc)</text>
          <text x="235" y="156" fill="#64748B" fontSize="8" fontFamily="monospace" textAnchor="middle">BDC (393cc)</text>
          <text x="14" y="30" fill="#64748B" fontSize="8" fontFamily="monospace" textAnchor="middle">140b</text>
          <text x="14" y="145" fill="#64748B" fontSize="8" fontFamily="monospace" textAnchor="middle">0b</text>

          <path d={pathD} fill="rgba(2, 132, 199, 0.12)" stroke="#0284C7" strokeWidth="1.8" />

          {isBlowBy && (
            <path
              d="M 35 120 C 90 120, 180 125, 235 128 L 235 124 C 160 115, 80 85, 35 105 L 35 55 C 60 70, 140 100, 235 122 Z"
              fill="rgba(239, 68, 68, 0.15)"
              stroke="#EF4444"
              strokeWidth="1.5"
              strokeDasharray="3,3"
            />
          )}

          <circle cx={svgX} cy={svgY} r="5" fill={strokeColor} className="animate-pulse" />
          <circle cx={svgX} cy={svgY} r="9" fill="none" stroke={strokeColor} strokeWidth="1.5" opacity="0.6" />
        </svg>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center text-[10px] font-mono">
        <div className="bg-slate-50 p-1.5 rounded-lg border border-slate-200">
          <div className="text-slate-500 text-[9px] font-bold">CYL PRESSURE</div>
          <div className="font-bold text-slate-900 text-xs">{pressureBar.toFixed(1)} bar</div>
        </div>
        <div className="bg-slate-50 p-1.5 rounded-lg border border-slate-200">
          <div className="text-slate-500 text-[9px] font-bold">CHAMBER VOL</div>
          <div className="font-bold text-sky-700 text-xs">{volumeCc.toFixed(0)} cc</div>
        </div>
        <div className="bg-slate-50 p-1.5 rounded-lg border border-slate-200">
          <div className="text-slate-500 text-[9px] font-bold">CRANK ANGLE</div>
          <div className="font-bold text-amber-700 text-xs">{deg.toFixed(0)}°</div>
        </div>
      </div>
    </div>
  );
};

/**
 * Main Exported Piston Inspection Lab Modal
 */
export const PistonInspectionModal = ({ isOpen, onClose, tel }) => {
  const [isPlaying, setIsPlaying] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState(0.25);
  const [crankAngle, setCrankAngle] = useState(360);
  const [isBlowBy, setIsBlowBy] = useState(false);
  const [selectedCompTab, setSelectedCompTab] = useState('ANATOMY');

  useEffect(() => {
    if (!isOpen || !isPlaying) return;
    const rpm = tel?.engine?.rpm || 4800;
    const degPerSec = (rpm * 360 / 60) * playbackSpeed;
    let lastTime = performance.now();

    const interval = setInterval(() => {
      const now = performance.now();
      const deltaSec = (now - lastTime) / 1000;
      lastTime = now;
      setCrankAngle(prev => (prev + degPerSec * deltaSec) % 720);
    }, 16);

    return () => clearInterval(interval);
  }, [isOpen, isPlaying, playbackSpeed, tel]);

  if (!isOpen) return null;

  const currentStroke = Math.floor(crankAngle / 180) % 4;
  const strokeNames = [
    { name: '1. INTAKE', desc: 'Induction of turbocharged charge air & atomized fuel mixture (1.48 bar MAP)', col: 'text-cyan-400' },
    { name: '2. COMPRESSION', desc: '9.0:1 compression squish against NiCaSil walls to 32 bar', col: 'text-emerald-400' },
    { name: '3. POWER / EXPANSION', desc: 'Dual spark plugs ignite. Peak 135 bar gas explosion forces piston downward', col: 'text-amber-400' },
    { name: '4. EXHAUST', desc: 'Exhaust valves scavenge 860°C gas directly to the turbocharger turbine', col: 'text-red-400' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/50 backdrop-blur-xs">
      <div className="relative w-full max-w-5xl h-[90vh] bg-white border border-slate-200 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-800 font-sans">
        
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-sky-50 border border-sky-200 flex items-center justify-center text-sky-600 shadow-2xs">
              <Eye className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold tracking-wide flex items-center gap-2 text-slate-900">
                ROTAX 915 iS • PISTON & 4-STROKE DIAGNOSTIC LABORATORY
                <span className="px-2 py-0.5 rounded text-[10px] bg-sky-50 border border-sky-200 text-sky-700 font-mono font-bold">
                  84mm × 61mm BOXER-4
                </span>
              </h2>
              <p className="text-[11px] text-slate-500">
                Interactive single-cylinder cutaway, 0°–720° crank kinematic scrubber, and real-time P-V cycle thermodynamics
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-white hover:bg-slate-100 text-slate-500 hover:text-slate-800 border border-slate-200 transition-all shadow-2xs"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Main Content Body */}
        <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
          
          {/* Left: 3D Single Cylinder Cutaway View */}
          <div className="flex-1 relative bg-[#F1F5F9] flex flex-col min-h-[350px]">
            
            <div className="flex-1 relative cursor-grab active:cursor-grabbing">
              <Canvas camera={{ position: [0, 1.2, 4.2], fov: 38 }} gl={{ antialias: true, alpha: true }}>
                <color attach="background" args={['#F1F5F9']} />
                <ambientLight intensity={0.75} />
                <directionalLight position={[5, 8, 5]} intensity={1.5} />
                <directionalLight position={[-5, 4, -5]} intensity={0.6} color="#0284C7" />
                <pointLight position={[0, -1, 2]} intensity={1.2} color="#0284C7" />
                
                <SingleCylinderCutaway
                  crankAngle={crankAngle}
                  isBlowBy={isBlowBy}
                  pistonTempC={tel?.engine?.cht?.[0] || 108}
                />
                
                <OrbitControls enableDamping dampingFactor={0.06} minDistance={2} maxDistance={10} />
              </Canvas>

              {/* Stroke Badge */}
              <div className="absolute top-3 left-3 pointer-events-none">
                <div className="bg-white/90 border border-slate-200 backdrop-blur-md rounded-lg p-2.5 max-w-xs shadow-md">
                  <div className={`text-xs font-mono font-bold ${strokeNames[currentStroke].col}`}>
                    {strokeNames[currentStroke].name}
                  </div>
                  <div className="text-[10px] text-slate-600 mt-0.5 leading-snug">
                    {strokeNames[currentStroke].desc}
                  </div>
                </div>
              </div>

              {/* Angle Readout */}
              <div className="absolute top-3 right-3 pointer-events-none">
                <div className="bg-white/90 border border-slate-200 rounded-lg px-3 py-1.5 font-mono text-center shadow-md">
                  <div className="text-[9px] text-slate-500 uppercase font-bold">Crank Position</div>
                  <div className="text-sm font-bold text-sky-700">{crankAngle.toFixed(1)}° CA</div>
                </div>
              </div>
            </div>

            {/* Bottom Controls Bar */}
            <div className="p-3 bg-white/95 border-t border-slate-200 flex flex-col gap-2">
              
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-mono text-slate-500 font-bold w-12">0° TDC</span>
                <input
                  type="range"
                  min={0}
                  max={720}
                  step={0.5}
                  value={crankAngle}
                  onChange={(e) => {
                    setIsPlaying(false);
                    setCrankAngle(parseFloat(e.target.value));
                  }}
                  className="flex-1 h-2 bg-slate-200 rounded-lg accent-sky-600 cursor-pointer"
                />
                <span className="text-[10px] font-mono text-slate-500 font-bold w-12 text-right">720°</span>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setIsPlaying(!isPlaying)}
                    className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 font-bold transition-all shadow-xs ${
                      isPlaying
                        ? 'bg-amber-500 hover:bg-amber-600 text-white'
                        : 'bg-sky-600 hover:bg-sky-700 text-white'
                    }`}
                  >
                    {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    {isPlaying ? 'PAUSE' : 'ANIMATE'}
                  </button>
                  <button
                    onClick={() => { setCrankAngle(360); setIsPlaying(false); }}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 flex items-center gap-1 transition-all font-semibold"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> TDC (Power)
                  </button>
                </div>

                <div className="flex items-center gap-1 bg-slate-50 p-1 rounded-lg border border-slate-200">
                  <span className="text-[10px] text-slate-500 px-1 font-bold">SPEED:</span>
                  {[
                    { label: '0.05×', val: 0.05 },
                    { label: '0.25×', val: 0.25 },
                    { label: '0.5×', val: 0.5 },
                    { label: '1.0× (RPM)', val: 1.0 }
                  ].map(s => (
                    <button
                      key={s.val}
                      onClick={() => { setPlaybackSpeed(s.val); setIsPlaying(true); }}
                      className={`px-2 py-0.5 rounded text-[10px] transition-all ${
                        playbackSpeed === s.val
                          ? 'bg-sky-600 text-white font-bold'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => setIsBlowBy(!isBlowBy)}
                  className={`px-2.5 py-1.5 rounded-lg border flex items-center gap-1.5 transition-all ${
                    isBlowBy
                      ? 'bg-rose-50 border-rose-300 text-rose-700 font-bold shadow-2xs'
                      : 'bg-slate-100 border-slate-200 text-slate-700 hover:text-slate-900 font-semibold'
                  }`}
                >
                  <Flame className="w-3.5 h-3.5" />
                  {isBlowBy ? 'BLOW-BY LEAK ACTIVE' : 'SIMULATE BLOW-BY'}
                </button>
              </div>
            </div>
          </div>

          {/* Right: Technical Anatomy, Indicator Diagram & Specs */}
          <div className="w-full lg:w-[380px] bg-slate-50 border-t lg:border-t-0 lg:border-l border-slate-200 p-4 flex flex-col gap-3 overflow-y-auto">
            
            <PvIndicatorDiagram
              crankAngle={crankAngle}
              isBlowBy={isBlowBy}
              rpm={tel?.engine?.rpm || 4800}
            />

            <div className="flex border-b border-slate-200 text-xs font-mono">
              <button
                onClick={() => setSelectedCompTab('ANATOMY')}
                className={`flex-1 py-1.5 text-center font-bold border-b-2 transition-all ${
                  selectedCompTab === 'ANATOMY'
                    ? 'border-sky-600 text-sky-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                COMPONENTS
              </button>
              <button
                onClick={() => setSelectedCompTab('SPECS')}
                className={`flex-1 py-1.5 text-center font-bold border-b-2 transition-all ${
                  selectedCompTab === 'SPECS'
                    ? 'border-sky-600 text-sky-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                KINEMATICS & SPECS
              </button>
            </div>

            {selectedCompTab === 'ANATOMY' ? (
              <div className="flex flex-col gap-2 text-xs font-mono">
                
                <div className="p-2.5 rounded-lg bg-white border border-slate-200 shadow-2xs">
                  <div className="flex justify-between items-center text-sky-700 font-bold mb-1">
                    <span>1. PISTON CROWN (4032 ALLOY)</span>
                    <span className="text-[10px] text-slate-400">84.0 mm</span>
                  </div>
                  <p className="text-[10px] text-slate-600 leading-relaxed">
                    Forged high-silicon aluminum with thermal barrier top coating. Recessed dish combustion bowl optimized for dual-spark flame propagation.
                  </p>
                </div>

                <div className={`p-2.5 rounded-lg border transition-all ${
                  isBlowBy ? 'bg-rose-50 border-rose-300' : 'bg-white border-slate-200 shadow-2xs'
                }`}>
                  <div className="flex justify-between items-center font-bold mb-1">
                    <span className={isBlowBy ? 'text-rose-700' : 'text-amber-700'}>2. THREE-PIECE RING PACK</span>
                    <span className="text-[10px] text-slate-400">{isBlowBy ? 'LEAKING' : 'SEALED'}</span>
                  </div>
                  <ul className="text-[10px] text-slate-600 space-y-1">
                    <li>• <strong>Top Ring:</strong> 1.2 mm Nitrided Steel (Seals 135 bar gas)</li>
                    <li>• <strong>2nd Ring:</strong> 1.2 mm Tapered Ductile Iron Scraper</li>
                    <li>• <strong>Oil Ring:</strong> 2.5 mm Chrome-plated with expander coil</li>
                  </ul>
                  {isBlowBy && (
                    <div className="mt-1.5 p-1.5 bg-rose-100 rounded border border-rose-300 text-[9px] text-rose-800 flex items-center gap-1 font-medium">
                      <AlertTriangle className="w-3 h-3 text-rose-600 shrink-0" />
                      Combustion blow-by gas leaks into crankcase, degrading oil to 132°C.
                    </div>
                  )}
                </div>

                <div className="p-2.5 rounded-lg bg-white border border-slate-200 shadow-2xs">
                  <div className="flex justify-between items-center text-slate-800 font-bold mb-1">
                    <span>3. GUDGEON / WRIST PIN</span>
                    <span className="text-[10px] text-slate-400">20 mm ∅</span>
                  </div>
                  <p className="text-[10px] text-slate-600 leading-relaxed">
                    Case-hardened 16MnCr5 alloy steel with Diamond-Like Carbon (DLC) coating, floating in a bronze connecting rod eye bushing.
                  </p>
                </div>

                <div className="p-2.5 rounded-lg bg-white border border-slate-200 shadow-2xs">
                  <div className="flex justify-between items-center text-sky-700 font-bold mb-1">
                    <span>4. FORGED H-BEAM CON-ROD</span>
                    <span className="text-[10px] text-slate-400">110 mm C-to-C</span>
                  </div>
                  <p className="text-[10px] text-slate-600 leading-relaxed">
                    4340 Chrome-Molybdenum forged steel with shot-peened surface. Rated for 3,250 g reciprocating acceleration at 5,800 RPM.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2 text-[11px] font-mono">
                <div className="bg-white p-2.5 rounded-lg border border-slate-200 flex flex-col gap-1.5 shadow-2xs">
                  <div className="text-sky-700 font-bold border-b border-slate-200 pb-1 flex items-center justify-between">
                    <span>ENGINE SPECIFICATION</span>
                    <span>ROTAX 915 iS</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Bore × Stroke:</span>
                    <span className="font-bold text-slate-900">84.0 mm × 61.0 mm</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Displacement (Per Cyl):</span>
                    <span className="font-bold text-slate-900">353.5 cc</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Total Engine Displacement:</span>
                    <span className="font-bold text-slate-900">1,414 cc (Boxer-4)</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Compression Ratio:</span>
                    <span className="font-bold text-slate-900">9.0 : 1</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Max Continuous RPM:</span>
                    <span className="font-bold text-slate-900">5,500 RPM</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Max Takeoff RPM:</span>
                    <span className="font-bold text-slate-900">5,800 RPM (5 min limit)</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Mean Piston Speed @ 5800:</span>
                    <span className="font-bold text-sky-700">11.8 m/s</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Peak Piston Acceleration:</span>
                    <span className="font-bold text-amber-700">31,850 m/s² (3,246 g)</span>
                  </div>
                </div>

                <div className="bg-white p-2.5 rounded-lg border border-slate-200 text-[10px] leading-relaxed text-slate-600 shadow-2xs">
                  <span className="text-sky-700 font-bold block mb-1">BOXER-4 VIBRATION BALANCE:</span>
                  The horizontally opposed boxer layout provides perfect primary mechanical balance because opposing pistons reach TDC and BDC simultaneously, cancelling out first-order inertial shaking forces.
                </div>
              </div>
            )}

          </div>

        </div>

      </div>
    </div>
  );
};