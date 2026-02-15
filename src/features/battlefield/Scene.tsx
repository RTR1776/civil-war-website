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

function makeCircle(radius: number, y = 0, points = 48): [number, number, number][] {
  const result: [number, number, number][] = [];
  for (let index = 0; index <= points; index += 1) {
    const theta = (index / points) * Math.PI * 2;
    result.push([Math.cos(theta) * radius, y, Math.sin(theta) * radius]);
  }
  return result;
}

function buildTroopOffsets(strengthEstimate: number): [number, number][] {
  const count = Math.max(10, Math.min(42, Math.round(strengthEstimate / 165)));
  const offsets: [number, number][] = [];

  for (let index = 0; index < count; index += 1) {
    const row = Math.floor(index / 6);
    const col = index % 6;
    const jitterX = ((index * 7) % 5) * 0.05;
    const jitterZ = ((index * 11) % 7) * 0.05;
    const x = (col - 2.5) * 0.5 + jitterX;
    const z = (row - Math.floor(count / 12)) * 0.5 + jitterZ;
    offsets.push([x, z]);
  }

  return offsets;
}

function Terrain({
  manifest,
  terrainDem,
}: {
  manifest: BattleManifest;
  terrainDem: TerrainDem | null;
}) {
  const terrainGeometry = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(220, 220, 140, 140);
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
          color="#5f7d58"
          roughness={0.98}
          metalness={0.02}
          emissive="#141a13"
          emissiveIntensity={0.08}
        />
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
        const y = terrainHeight(point.x, point.z, manifest.terrain, terrainDem) + 0.9;
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
        <fog attach="fog" args={["#c9bcaa", 95, 390]} />
        <Sky distance={450000} sunPosition={[120, 45, 18]} turbidity={8} rayleigh={2} />
        <ambientLight intensity={0.52} />
        <directionalLight
          position={[80, 140, 60]}
          intensity={1.25}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
        />

        <Terrain manifest={manifest} terrainDem={terrainDem} />

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
                opacity={0.1}
                lineWidth={0.65}
                depthWrite={false}
                depthTest={false}
              />
              {trail.progressive.length >= 2 ? (
                <Line
                  points={trail.progressive}
                  color={SIDE_COLORS[trail.side]}
                  transparent
                  opacity={0.74}
                  lineWidth={1.35}
                  depthWrite={false}
                  depthTest={false}
                />
              ) : null}
            </group>
          );
        })}

        {units.map((unit) => {
          const position = positionsByUnit.get(unit.id);
          if (!position) {
            return null;
          }

          const battlefield = latLngToBattlefield(position.lat, position.lng, manifest.bounds);
          const y = terrainHeight(battlefield.x, battlefield.z, manifest.terrain, terrainDem) + 0.85;
          const style = getConfidenceStyle(position.confidence);
          const selected = selectedUnitId === unit.id;
          const focused = selected || focusUnitIds.includes(unit.id) || activeBeatId === null;
          const offsets = buildTroopOffsets(unit.strengthEstimate);

          return (
            <group key={unit.id} position={[battlefield.x, y, battlefield.z]}>
              <mesh
                rotation-x={-Math.PI / 2}
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
                <circleGeometry args={[selected ? 5.4 : 4.6, 44]} />
                <meshBasicMaterial color="#0d0f12" transparent opacity={selected ? 0.32 : 0.2} depthWrite={false} />
              </mesh>

              {offsets.map(([offsetX, offsetZ], index) => (
                <mesh
                  key={`${unit.id}-troop-${index}`}
                  position={[offsetX, 0.2, offsetZ]}
                  castShadow={selected}
                  renderOrder={selected ? 3 : 2}
                >
                  <sphereGeometry args={[selected ? 0.26 : focused ? 0.23 : 0.2, 10, 10]} />
                  <meshStandardMaterial
                    color={SIDE_COLORS[unit.side]}
                    transparent
                    opacity={style.opacity * (focused ? 0.98 : 0.78)}
                    emissive={selected ? "#ffe3ac" : "#000000"}
                    emissiveIntensity={selected ? 0.22 : 0}
                  />
                </mesh>
              ))}

              <Line
                points={makeCircle(selected ? 5.2 : 4.4, 0.12)}
                color={selected ? "#ffe3ac" : SIDE_COLORS[unit.side]}
                dashed={style.dashed}
                dashSize={0.38}
                gapSize={0.28}
                lineWidth={selected ? 1.8 : 1.2}
                transparent
                opacity={selected ? 0.95 : 0.55}
                depthWrite={false}
                depthTest={false}
              />

              <Html center position={[0, selected ? 3.8 : 3.4, 0]} distanceFactor={15} style={{ pointerEvents: "none" }}>
                <div className={`scene-unit-label ${unit.side.toLowerCase()} ${selected ? "selected" : ""}`}>
                  {getShortName(unit.name)}
                </div>
              </Html>
            </group>
          );
        })}

        {mapLabels.map((label) => {
          const point = latLngToBattlefield(label.lat, label.lng, manifest.bounds);
          const y = terrainHeight(point.x, point.z, manifest.terrain, terrainDem) + 0.95;
          return (
            <group key={label.id} position={[point.x, y, point.z]}>
              <mesh>
                <sphereGeometry args={[0.24, 10, 10]} />
                <meshBasicMaterial color="#f3d7a4" />
              </mesh>
              <Html center position={[0, 1.55, 0]} distanceFactor={26} style={{ pointerEvents: "none" }}>
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
