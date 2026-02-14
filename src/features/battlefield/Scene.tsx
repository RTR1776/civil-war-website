"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, Line, OrbitControls, Sky } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";

import { latLngToBattlefield, terrainHeight } from "@/lib/battle/coords";
import { getConfidenceStyle, interpolateUnitPositions } from "@/lib/battle/interpolation";
import type {
  BattleManifest,
  CameraPose,
  DivisionUnit,
  MapLabel,
  TerrainDem,
  TimeSlice,
} from "@/lib/battle/types";

interface SceneProps {
  manifest: BattleManifest;
  units: DivisionUnit[];
  timeSlices: TimeSlice[];
  mapLabels: MapLabel[];
  terrainDem: TerrainDem | null;
  selectedTime: number;
  activeBeatId: string | null;
  selectedUnitId: string | null;
  cameraPoseOverride: CameraPose | null;
  focusUnitIds: string[];
  onCameraOverrideConsumed: () => void;
  onSelectUnit: (unitId: string | null) => void;
}

const SIDE_COLORS = {
  Union: "#2f75c9",
  Confederate: "#b0402f",
} as const;

function getShortName(value: string): string {
  return value
    .replace("'s Division", "")
    .replace(" Division", "")
    .replace(" (XXIII Corps)", "")
    .replace(" (IV Corps)", "");
}

function makeCircle(radius: number, y = 0, points = 32): [number, number, number][] {
  const result: [number, number, number][] = [];
  for (let index = 0; index <= points; index += 1) {
    const theta = (index / points) * Math.PI * 2;
    result.push([Math.cos(theta) * radius, y, Math.sin(theta) * radius]);
  }
  return result;
}

function Terrain({
  manifest,
  terrainDem,
}: {
  manifest: BattleManifest;
  terrainDem: TerrainDem | null;
}) {
  const terrainGeometry = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(220, 220, 120, 120);
    const positions = geometry.attributes.position;

    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index);
      const z = positions.getY(index);
      const y = terrainHeight(x, z, manifest.terrain, terrainDem);
      positions.setZ(index, y);
    }

    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    return geometry;
  }, [manifest, terrainDem]);

  return (
    <group>
      <mesh geometry={terrainGeometry} rotation-x={-Math.PI / 2} receiveShadow>
        <meshStandardMaterial
          color="#5f7859"
          roughness={0.94}
          metalness={0.05}
          emissive="#182013"
          emissiveIntensity={0.1}
        />
      </mesh>
      <mesh geometry={terrainGeometry} rotation-x={-Math.PI / 2} position-y={0.08}>
        <meshBasicMaterial color="#12210f" wireframe opacity={0.12} transparent />
      </mesh>
    </group>
  );
}

interface CameraDirectorProps {
  bounds: BattleManifest["bounds"];
  terrain: BattleManifest["terrain"];
  terrainDem: TerrainDem | null;
  override: CameraPose | null;
  controlsRef: React.RefObject<OrbitControlsImpl | null>;
  onConsumed: () => void;
}

function CameraDirector({
  bounds,
  terrain,
  terrainDem,
  override,
  controlsRef,
  onConsumed,
}: CameraDirectorProps) {
  const { camera } = useThree();
  const consumed = useRef(false);

  useEffect(() => {
    consumed.current = false;
  }, [override]);

  useFrame((_, delta) => {
    if (!override || !controlsRef.current) {
      return;
    }

    const target2D = latLngToBattlefield(override.lat, override.lng, bounds);
    const target = new THREE.Vector3(
      target2D.x,
      terrainHeight(target2D.x, target2D.z, terrain, terrainDem) + 1,
      target2D.z,
    );

    const pitch = THREE.MathUtils.degToRad(override.pitch);
    const yaw = THREE.MathUtils.degToRad(override.yaw);

    const radial = Math.cos(pitch) * override.distance;
    const desired = new THREE.Vector3(
      target.x + Math.cos(yaw) * radial,
      target.y + Math.sin(pitch) * override.distance,
      target.z + Math.sin(yaw) * radial,
    );

    camera.position.lerp(desired, Math.min(1, delta * 2.4));
    controlsRef.current.target.lerp(target, Math.min(1, delta * 2.4));
    controlsRef.current.update();

    if (!consumed.current && camera.position.distanceTo(desired) < 0.6) {
      consumed.current = true;
      onConsumed();
    }
  });

  return null;
}

function TacticalInputs({ controlsRef }: { controlsRef: React.RefObject<OrbitControlsImpl | null> }) {
  const keys = useRef<Record<string, boolean>>({});

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      keys.current[event.code] = true;
    };

    const up = (event: KeyboardEvent) => {
      keys.current[event.code] = false;
    };

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);

    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  useFrame((state, delta) => {
    if (!controlsRef.current) {
      return;
    }

    const movement = new THREE.Vector3();
    const pointer = state.pointer;
    const speed = 18 * delta;

    if (pointer.x > 0.94) movement.x += speed;
    if (pointer.x < -0.94) movement.x -= speed;
    if (pointer.y > 0.94) movement.z -= speed;
    if (pointer.y < -0.94) movement.z += speed;

    if (keys.current.KeyW) movement.z -= speed;
    if (keys.current.KeyS) movement.z += speed;
    if (keys.current.KeyA) movement.x -= speed;
    if (keys.current.KeyD) movement.x += speed;

    if (movement.lengthSq() > 0) {
      state.camera.position.add(movement);
      controlsRef.current.target.add(movement);
      controlsRef.current.update();
    }
  });

  return null;
}

export default function Scene({
  manifest,
  units,
  timeSlices,
  mapLabels,
  terrainDem,
  selectedTime,
  activeBeatId,
  selectedUnitId,
  cameraPoseOverride,
  focusUnitIds,
  onCameraOverrideConsumed,
  onSelectUnit,
}: SceneProps) {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);

  useEffect(
    () => () => {
      document.body.style.cursor = "default";
    },
    [],
  );

  const orderedSlices = useMemo(
    () => [...timeSlices].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)),
    [timeSlices],
  );

  const positionsByUnit = useMemo(() => {
    const interpolated = interpolateUnitPositions(selectedTime, orderedSlices);
    return new Map(interpolated.map((position) => [position.unitId, position]));
  }, [orderedSlices, selectedTime]);

  const trails = useMemo(() => {
    const grouped = new Map<
      string,
      {
        points: [number, number, number][];
        progressive: [number, number, number][];
        side: DivisionUnit["side"];
      }
    >();

    for (const unit of units) {
      grouped.set(unit.id, { points: [], progressive: [], side: unit.side });
    }

    for (const slice of orderedSlices) {
      const time = Date.parse(slice.timestamp);
      for (const unitPosition of slice.unitPositions) {
        const group = grouped.get(unitPosition.unitId);
        if (!group) {
          continue;
        }

        const point = latLngToBattlefield(unitPosition.lat, unitPosition.lng, manifest.bounds);
        const y = terrainHeight(point.x, point.z, manifest.terrain, terrainDem) + 0.4;
        const asTuple: [number, number, number] = [point.x, y, point.z];
        group.points.push(asTuple);

        if (time <= selectedTime) {
          group.progressive.push(asTuple);
        }
      }
    }

    return grouped;
  }, [manifest.bounds, manifest.terrain, orderedSlices, selectedTime, terrainDem, units]);

  return (
    <div className="scene-canvas" data-testid="battlefield-scene">
      <Canvas
        camera={{
          position: [48, 64, 84],
          fov: 48,
          near: 0.1,
          far: 600,
        }}
        shadows
        onPointerMissed={() => onSelectUnit(null)}
      >
        <color attach="background" args={["#9eb7cc"]} />
        <fog attach="fog" args={["#c7b59d", 85, 360]} />
        <Sky distance={450000} sunPosition={[120, 45, 18]} turbidity={8} rayleigh={2} />
        <ambientLight intensity={0.46} />
        <directionalLight
          position={[80, 140, 60]}
          intensity={1.35}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
        />

        <Terrain manifest={manifest} terrainDem={terrainDem} />

        {units.map((unit) => {
          const position = positionsByUnit.get(unit.id);
          if (!position) {
            return null;
          }

          const battlefield = latLngToBattlefield(position.lat, position.lng, manifest.bounds);
          const y = terrainHeight(battlefield.x, battlefield.z, manifest.terrain, terrainDem) + 1.4;
          const style = getConfidenceStyle(position.confidence);
          const selected = selectedUnitId === unit.id;
          const focused = selected || focusUnitIds.includes(unit.id) || activeBeatId === null;
          const circle = makeCircle(selected ? 3.1 : focused ? 2.6 : 2.1, 0.18, 40);

          return (
            <group
              key={unit.id}
              position={[battlefield.x, y, battlefield.z]}
              scale={selected ? 1.16 : 1}
            >
              <mesh
                castShadow
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectUnit(unit.id);
                }}
                onPointerOver={(event) => {
                  event.stopPropagation();
                  document.body.style.cursor = "pointer";
                }}
                onPointerOut={() => {
                  document.body.style.cursor = "default";
                }}
              >
                <cylinderGeometry
                  args={[focused ? 1.4 : 1.2, focused ? 1.6 : 1.4, focused ? 2.6 : 2.1, 20]}
                />
                <meshStandardMaterial
                  color={SIDE_COLORS[unit.side]}
                  transparent
                  opacity={style.opacity}
                  emissive={selected ? "#f5e2b8" : focused ? SIDE_COLORS[unit.side] : "#000000"}
                  emissiveIntensity={selected ? 0.38 : focused ? 0.26 : 0.04}
                  polygonOffset
                  polygonOffsetFactor={selected ? -2 : -1}
                  polygonOffsetUnits={selected ? -3 : -1}
                />
              </mesh>
              {style.dashed ? (
                <Line points={circle} color="#f4ece2" dashed dashSize={0.4} gapSize={0.25} lineWidth={1.2} />
              ) : null}
              <Html center position={[0, 3.5, 0]} distanceFactor={14} style={{ pointerEvents: "none" }}>
                <div className={`scene-unit-label ${unit.side.toLowerCase()} ${selected ? "selected" : ""}`}>
                  {getShortName(unit.name)}
                </div>
              </Html>
            </group>
          );
        })}

        {[...trails.entries()].map(([unitId, trail]) => {
          if (trail.points.length < 2) {
            return null;
          }

          return (
            <group key={`trail-${unitId}`}>
              <Line
                points={trail.points}
                color={SIDE_COLORS[trail.side]}
                transparent
                opacity={0.16}
                lineWidth={0.8}
              />
              {trail.progressive.length >= 2 ? (
                <Line
                  points={trail.progressive}
                  color={SIDE_COLORS[trail.side]}
                  transparent
                  opacity={0.88}
                  lineWidth={1.4}
                />
              ) : null}
            </group>
          );
        })}

        {mapLabels.map((label) => {
          const point = latLngToBattlefield(label.lat, label.lng, manifest.bounds);
          const y = terrainHeight(point.x, point.z, manifest.terrain, terrainDem) + 0.9;
          return (
            <group key={label.id} position={[point.x, y, point.z]}>
              <mesh>
                <sphereGeometry args={[0.45, 12, 12]} />
                <meshStandardMaterial color="#f2d39e" emissive="#4f2d0d" emissiveIntensity={0.22} />
              </mesh>
              <Html center position={[0, 1.9, 0]} distanceFactor={26} style={{ pointerEvents: "none" }}>
                <div className={`scene-landmark-label importance-${Math.min(5, Math.max(1, label.importance))}`}>
                  {label.name}
                </div>
              </Html>
            </group>
          );
        })}

        <OrbitControls
          ref={controlsRef}
          enableDamping
          dampingFactor={0.08}
          minPolarAngle={0.42}
          maxPolarAngle={1.34}
          minDistance={26}
          maxDistance={180}
          mouseButtons={{
            LEFT: THREE.MOUSE.PAN,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.ROTATE,
          }}
        />

        <CameraDirector
          bounds={manifest.bounds}
          terrain={manifest.terrain}
          terrainDem={terrainDem}
          override={cameraPoseOverride}
          controlsRef={controlsRef}
          onConsumed={onCameraOverrideConsumed}
        />
        <TacticalInputs controlsRef={controlsRef} />
      </Canvas>
    </div>
  );
}
