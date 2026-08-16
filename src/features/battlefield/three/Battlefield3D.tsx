"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { createProjection } from "@/features/battlefield/engine/projection";
import { Armies3D } from "@/features/battlefield/three/armies3d";
import { Effects3D } from "@/features/battlefield/three/effects3d";
import { BattlefieldWorld } from "@/features/battlefield/three/scene3d";
import { vantagePoints, type Vantage } from "@/features/battlefield/three/viewpoints";
import { useBattleStore } from "@/lib/battle/store";
import { nightness } from "@/lib/battle/time";
import type { ScenarioDataBundle } from "@/lib/battle/types";

interface Battlefield3DProps {
  bundle: ScenarioDataBundle;
  reducedMotion: boolean;
}

interface IntensityCurve {
  segments: Array<{ t0: number; t1: number; rate: number }>;
  maxRate: number;
}

/** Casualty-rate curve in numeric time — constant per bundle, built once. */
function buildIntensityCurve(bundle: ScenarioDataBundle): IntensityCurve {
  const ticks = bundle.casualtyTimeline;
  const segments: IntensityCurve["segments"] = [];
  let maxRate = 1e-9;

  for (let index = 0; index < ticks.length - 1; index += 1) {
    const t0 = Date.parse(ticks[index].time);
    const t1 = Date.parse(ticks[index + 1].time);
    const rate = (ticks[index + 1].cumulativeCasualties - ticks[index].cumulativeCasualties)
      / Math.max(1, t1 - t0);
    segments.push({ t0, t1, rate });
    maxRate = Math.max(maxRate, rate);
  }

  return { segments, maxRate };
}

function intensityAt(curve: IntensityCurve, timeMs: number): number {
  for (const segment of curve.segments) {
    if (timeMs >= segment.t0 && timeMs <= segment.t1) {
      return Math.min(1, segment.rate / curve.maxRate);
    }
  }
  return 0;
}

export default function Battlefield3D({ bundle, reducedMotion }: Battlefield3DProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [webglFailed, setWebglFailed] = useState(false);
  const [activeVantage, setActiveVantage] = useState<string>("salient");
  const vantageRef = useRef<Vantage | null>(null);
  const followRef = useRef<string | null>(null);
  const applyVantageRef = useRef<(vantage: Vantage) => void>(() => {});

  const reducedMotionRef = useRef(reducedMotion);
  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
  }, [reducedMotion]);

  const vantages = useMemo(
    () => vantagePoints(createProjection(bundle.manifest.bounds)),
    [bundle.manifest.bounds],
  );

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return;
    }

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    } catch {
      setWebglFailed(true);
      return;
    }

    const scene = new THREE.Scene();
    const intensityCurve = buildIntensityCurve(bundle);
    const world = new BattlefieldWorld(bundle, scene);
    const armies = new Armies3D(bundle, world.terrainModel, world.batteries);
    const effects = new Effects3D();
    scene.add(armies.group);
    scene.add(effects.group);

    const camera = new THREE.PerspectiveCamera(
      52,
      mount.clientWidth / Math.max(1, mount.clientHeight),
      2,
      30000,
    );

    renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio || 1));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.touchAction = "none";

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI * 0.472;
    controls.minDistance = 60;
    controls.maxDistance = 5200;
    controls.zoomSpeed = 1.1;

    const applyVantage = (vantage: Vantage) => {
      const groundAtCamera = world.groundHeight(vantage.position.x, vantage.position.z);
      const groundAtTarget = world.groundHeight(vantage.target.x, vantage.target.z);
      camera.position.set(
        vantage.position.x,
        groundAtCamera + vantage.position.y,
        vantage.position.z,
      );
      controls.target.set(
        vantage.target.x,
        groundAtTarget + vantage.target.y,
        vantage.target.z,
      );
      followRef.current = vantage.followFormationId ?? null;
      controls.update();
    };
    applyVantageRef.current = applyVantage;

    const initial = vantages.find((entry) => entry.id === "salient") ?? vantages[0];
    if (initial) {
      vantageRef.current = initial;
      applyVantage(initial);
    }

    // Once the user drags, stop tracking a followed formation.
    const onControlStart = () => {
      followRef.current = null;
    };
    controls.addEventListener("start", onControlStart);

    // Click-to-inspect: raycast the army meshes.
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downAt: { x: number; y: number } | null = null;

    const onPointerDown = (event: PointerEvent) => {
      downAt = { x: event.clientX, y: event.clientY };
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!downAt) {
        return;
      }
      const moved = Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y);
      downAt = null;
      if (moved > 6) {
        return;
      }

      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(armies.raycastTargets, false);

      const hit = hits[0];
      const store = useBattleStore.getState();
      if (hit && hit.instanceId !== undefined) {
        const formationId = armies.formationAt(hit.object, hit.instanceId);
        store.selectFormation(formationId);
      } else {
        store.selectFormation(null);
      }
    };

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);

    const resizeObserver = new ResizeObserver(() => {
      const width = mount.clientWidth;
      const height = Math.max(1, mount.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    });
    resizeObserver.observe(mount);

    let rafId = 0;
    let lastFrame = 0;
    const followTarget = new THREE.Vector3();

    const frame = (now: number) => {
      const dtMs = lastFrame === 0 ? 16 : Math.min(90, now - lastFrame);
      lastFrame = now;

      const store = useBattleStore.getState();
      const { simulationState } = store;

      if (simulationState.isPlaying) {
        store.advanceTimeline(dtMs);
      }

      const timeMs = useBattleStore.getState().simulationState.simTimeMs;

      armies.update(timeMs);
      world.updateLighting(timeMs);

      const night = nightness(timeMs);
      effects.update(
        dtMs,
        armies.fronts,
        armies.gunSlots,
        (x, y) => world.groundHeight(x, y),
        intensityAt(intensityCurve, timeMs),
        night,
        reducedMotionRef.current,
      );

      // Camera follow: keep the orbit target on the tracked formation.
      if (followRef.current) {
        const followed = armies.worldPositionOf(followRef.current);
        if (followed) {
          followTarget.set(followed.x, followed.y + 6, followed.z);
          controls.target.lerp(followTarget, reducedMotionRef.current ? 1 : 0.08);
        }
      }

      controls.update();
      renderer.render(scene, camera);
      rafId = requestAnimationFrame(frame);
    };

    rafId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      controls.removeEventListener("start", onControlStart);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      controls.dispose();
      world.dispose();
      armies.dispose();
      effects.dispose();
      renderer.dispose();
      // dispose() frees three.js caches but leaves the GL context alive until
      // GC; browsers cap live contexts, so release it now — mode toggles
      // mount/unmount this component repeatedly.
      renderer.forceContextLoss();
      if (renderer.domElement.parentElement === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
    // The 3D world is rebuilt only when the scenario bundle changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle]);

  if (webglFailed) {
    return (
      <div className="webgl-fallback" data-testid="webgl-fallback">
        <h3>3D view unavailable</h3>
        <p>This browser could not start WebGL. The 2D map remains fully functional.</p>
      </div>
    );
  }

  return (
    <div className="stage-3d" data-testid="battlefield-3d">
      <div ref={mountRef} className="mount-3d" />
      <div className="vantage-chips" role="group" aria-label="Vantage points">
        {vantages.map((vantage) => (
          <button
            key={vantage.id}
            type="button"
            className={activeVantage === vantage.id ? "active" : ""}
            data-testid={`vantage-${vantage.id}`}
            onClick={() => {
              setActiveVantage(vantage.id);
              vantageRef.current = vantage;
              applyVantageRef.current(vantage);
            }}
          >
            {vantage.label}
          </button>
        ))}
      </div>
      <p className="figure-legend">1 figure ≈ 18 infantry · 24 troopers — drag to orbit, scroll to zoom, click a line to inspect</p>
    </div>
  );
}

