import re

with open('src/components/UavBlueprintTab.jsx', 'r') as f:
    content = f.read()

# 1. Replace UavModel
uav_model_new = """// 3D Procedural Radial/Rotary Engine Model
const UavModel = ({ isExploded, selectedHotspot, onSelectHotspot, telemetry }) => {
  const engineRef = React.useRef();

  const egtRes = telemetry.residuals.egtResiduals;
  const activeFault = telemetry.health.activeFault;

  // Animate whole engine (rotary engine)
  useFrame((state, delta) => {
    if (engineRef.current) {
      engineRef.current.rotation.z -= (telemetry.engine.rpm / 60) * delta * 0.1;
    }
  });

  const explodedOffset = isExploded ? 0.8 : 0.0;

  const getCylColor = (index) => {
    const res = egtRes[index % 4];
    let fault = false;
    if (index === 0 && activeFault === 'COOLING_DEGRADATION') fault = true;
    if (index === 1 && (activeFault === 'COOLING_DEGRADATION' || activeFault === 'BLOW_BY')) fault = true;
    if (index === 2 && activeFault === 'CYL3_INJECTOR') fault = true;
    if (index === 3 && activeFault === 'COOLING_DEGRADATION') fault = true;
    return getHotspotColor(res, fault, '#10B981');
  };

  const turboColor = getHotspotColor(0, activeFault === 'TURBO_WASTEGATE_STUCK', '#00F0FF');
  const oilColor = getHotspotColor(telemetry.residuals.oilTempResidual, activeFault === 'OIL_PUMP_CAVITATION' || activeFault === 'BLOW_BY', '#00F0FF');

  const numCylinders = 7;
  const cylinders = Array.from({ length: numCylinders }).map((_, i) => {
    const angle = (i * Math.PI * 2) / numCylinders;
    const radius = 1.3 + explodedOffset;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    const rotZ = angle - Math.PI / 2;
    const cylId = `CYLINDER_${i + 1}`;
    const color = getCylColor(i);
    const isSelected = selectedHotspot === cylId;

    return (
      <group key={cylId} position={[x, y, 0]} rotation={[0, 0, rotZ]}>
        <mesh onClick={(e) => { e.stopPropagation(); onSelectHotspot(cylId); }}>
          <cylinderGeometry args={[0.25, 0.25, 1.2, 16]} />
          <meshStandardMaterial 
            color={color} 
            emissive={color} 
            emissiveIntensity={isSelected ? 0.8 : (activeFault === 'CYL3_INJECTOR' && i===2 ? 0.8 : 0.2)} 
            wireframe={isExploded}
          />
        </mesh>
        {/* Cooling Fins */}
        {[-0.2, -0.05, 0.1, 0.25, 0.4].map(finY => (
          <mesh key={finY} position={[0, finY, 0]}>
            <cylinderGeometry args={[0.3, 0.3, 0.05, 16]} />
            <meshStandardMaterial color="#334155" metalness={0.8} />
          </mesh>
        ))}
        {/* Copper Intake/Exhaust Pipe */}
        <mesh position={[-0.2, 0.6, 0.3]} rotation={[0, 0, -0.3]}>
          <cylinderGeometry args={[0.06, 0.06, 0.8, 8]} />
          <meshStandardMaterial color="#b87333" metalness={0.9} roughness={0.3} />
        </mesh>
      </group>
    );
  });

  return (
    <group position={[0, 1, 0]}>
      {/* Rotary Engine Group */}
      <group ref={engineRef}>
        {/* Central Crankcase */}
        <mesh 
          rotation={[Math.PI / 2, 0, 0]} 
          onClick={(e) => { e.stopPropagation(); onSelectHotspot('ENGINE_BLOCK'); }}
        >
          <cylinderGeometry args={[1.0, 1.0, 0.8, 32]} />
          <meshStandardMaterial 
            color={selectedHotspot === 'ENGINE_BLOCK' ? '#00F0FF' : '#94a3b8'} 
            metalness={0.9} 
            roughness={0.3}
            wireframe={isExploded}
          />
        </mesh>
        
        {/* Cylinders */}
        {cylinders}

        {/* Propeller Hub */}
        <group position={[0, 0, 0.5 + explodedOffset]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.3, 0.3, 0.3, 16]} />
            <meshStandardMaterial color="#1e293b" metalness={0.8} />
          </mesh>
          <mesh position={[0, 0, 0.15]} rotation={[Math.PI / 2, 0, 0]}>
            <coneGeometry args={[0.3, 0.5, 16]} />
            <meshStandardMaterial color="#cbd5e1" metalness={0.9} />
          </mesh>
          {/* Propeller Blades (Wooden style) */}
          <mesh position={[0, 0, 0]}>
            <boxGeometry args={[5.5, 0.4, 0.08]} />
            <meshStandardMaterial color="#8b5a2b" roughness={0.8} />
          </mesh>
        </group>
      </group>

      {/* Turbocharger */}
      <group position={[2.5 + explodedOffset, -2.5 - explodedOffset, -1.0]}>
        <mesh onClick={(e) => { e.stopPropagation(); onSelectHotspot('TURBOCHARGER'); }}>
          <torusGeometry args={[0.4, 0.15, 16, 24]} />
          <meshStandardMaterial color={turboColor} emissive={turboColor} emissiveIntensity={0.5} />
        </mesh>
      </group>

      {/* Oil System */}
      <group position={[-2.5 - explodedOffset, -2.5 - explodedOffset, -1.0]}>
        <mesh onClick={(e) => { e.stopPropagation(); onSelectHotspot('OIL_SYSTEM'); }}>
          <boxGeometry args={[0.8, 0.5, 0.3]} />
          <meshStandardMaterial color={oilColor} emissive={oilColor} emissiveIntensity={0.5} />
        </mesh>
      </group>

      {/* Fuel System */}
      <group position={[0, 3 + explodedOffset, -1.0]}>
        <mesh onClick={(e) => { e.stopPropagation(); onSelectHotspot('FUEL_SYSTEM'); }}>
          <cylinderGeometry args={[0.25, 0.25, 0.8, 16]} rotation={[0, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#00F0FF" emissive="#00F0FF" emissiveIntensity={0.3} />
        </mesh>
      </group>
    </group>
  );
};
"""

content = re.sub(r'// 3D Procedural MALE UAV Airframe Model .*?};', uav_model_new, content, flags=re.DOTALL)


# 2. Add Cylinders 5-7 to hotspotData
new_hotspots = """
    CYLINDER_5: {
      name: 'Cylinder 5 Combustion Chamber (Radial)',
      subsystem: 'Combustion Chamber',
      spec: 'Radial Configuration',
      telemetryKey: `EGT: ${telemetry.engine.egt[0]}°C | CHT: ${telemetry.engine.cht[0]}°C`,
      residual: `EGT Residual: ${telemetry.residuals.egtResiduals[0] > 0 ? '+' : ''}${telemetry.residuals.egtResiduals[0]}°C`,
      status: 'NOMINAL',
      desc: 'Radial cylinder 5.'
    },
    CYLINDER_6: {
      name: 'Cylinder 6 Combustion Chamber (Radial)',
      subsystem: 'Combustion Chamber',
      spec: 'Radial Configuration',
      telemetryKey: `EGT: ${telemetry.engine.egt[1]}°C | CHT: ${telemetry.engine.cht[1]}°C`,
      residual: `EGT Residual: ${telemetry.residuals.egtResiduals[1] > 0 ? '+' : ''}${telemetry.residuals.egtResiduals[1]}°C`,
      status: 'NOMINAL',
      desc: 'Radial cylinder 6.'
    },
    CYLINDER_7: {
      name: 'Cylinder 7 Combustion Chamber (Radial)',
      subsystem: 'Combustion Chamber',
      spec: 'Radial Configuration',
      telemetryKey: `EGT: ${telemetry.engine.egt[2]}°C | CHT: ${telemetry.engine.cht[2]}°C`,
      residual: `EGT Residual: ${telemetry.residuals.egtResiduals[2] > 0 ? '+' : ''}${telemetry.residuals.egtResiduals[2]}°C`,
      status: 'NOMINAL',
      desc: 'Radial cylinder 7.'
    },
    TURBOCHARGER:"""

content = content.replace("TURBOCHARGER:", new_hotspots.strip())


# 3. Update the quick click buttons
buttons_old = """[
            { id: 'CYLINDER_1', label: 'CYL 1' },
            { id: 'CYLINDER_2', label: 'CYL 2' },
            { id: 'CYLINDER_3', label: 'CYL 3 (FAULT SENSOR)' },
            { id: 'CYLINDER_4', label: 'CYL 4' },
            { id: 'TURBOCHARGER', label: 'TURBO/WASTEGATE' },
            { id: 'OIL_SYSTEM', label: 'OIL RADIATOR/PUMP' },
            { id: 'FUEL_SYSTEM', label: 'FUEL PUMPS' },
            { id: 'ENGINE_BLOCK', label: 'CRANKCASE BLOCK' },
          ]"""
buttons_new = """[
            { id: 'ENGINE_BLOCK', label: 'CRANKCASE' },
            { id: 'CYLINDER_1', label: 'CYL 1' },
            { id: 'CYLINDER_2', label: 'CYL 2' },
            { id: 'CYLINDER_3', label: 'CYL 3' },
            { id: 'CYLINDER_4', label: 'CYL 4' },
            { id: 'CYLINDER_5', label: 'CYL 5' },
            { id: 'CYLINDER_6', label: 'CYL 6' },
            { id: 'CYLINDER_7', label: 'CYL 7' },
          ]"""

content = content.replace(buttons_old, buttons_new)

with open('src/components/UavBlueprintTab.jsx', 'w') as f:
    f.write(content)

print("Replaced!")
