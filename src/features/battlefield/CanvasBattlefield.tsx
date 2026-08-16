"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { CameraController } from "@/features/battlefield/engine/camera";
import {
  attractShots,
  beatPose,
  chapterPoseAt,
  overviewPose,
} from "@/features/battlefield/engine/direction";
import { BattleParticles } from "@/features/battlefield/engine/particles";
import { BattlefieldScene, type FormationScreenAnchor } from "@/features/battlefield/engine/scene";
import { useBattleStore } from "@/lib/battle/store";
import type { ScenarioDataBundle } from "@/lib/battle/types";

interface CanvasBattlefieldProps {
  bundle: ScenarioDataBundle;
  attract: boolean;
  reducedMotion: boolean;
}

interface PointerRecord {
  x: number;
  y: number;
}

function resolveDisplayFont(): string {
  if (typeof window === "undefined") {
    return "Georgia, serif";
  }

  const custom = getComputedStyle(document.body).getPropertyValue("--font-display").trim();
  return custom ? `${custom}, Georgia, serif` : "Georgia, serif";
}

export default function CanvasBattlefield({ bundle, attract, reducedMotion }: CanvasBattlefieldProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const cameraRef = useRef<CameraController | null>(null);
  const anchorsRef = useRef<FormationScreenAnchor[]>([]);
  const pointersRef = useRef<Map<number, PointerRecord>>(new Map());
  const dragRef = useRef<{ moved: number; pinchDist: number | null }>({ moved: 0, pinchDist: null });
  const attractRef = useRef({ index: 0, elapsed: 0 });
  const overrideRef = useRef<{ active: boolean; chapterId: string | null }>({
    active: false,
    chapterId: null,
  });
  const frameStatsRef = useRef({ emaDt: 16 });
  const hoveredRef = useRef<string | null>(null);

  const [hoveredFormationId, setHoveredFormationId] = useState<string | null>(null);
  const [cameraOverridden, setCameraOverridden] = useState(false);

  const scene = useMemo(() => new BattlefieldScene(bundle), [bundle]);
  const particles = useMemo(() => new BattleParticles(), []);

  const attractStateRef = useRef(attract);
  const reducedMotionRef = useRef(reducedMotion);

  useEffect(() => {
    attractStateRef.current = attract;
  }, [attract]);

  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
  }, [reducedMotion]);

  useEffect(() => {
    hoveredRef.current = hoveredFormationId;
  }, [hoveredFormationId]);

  useEffect(() => {
    scene.setFontFamily(resolveDisplayFont());
  }, [scene]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    let width = canvas.clientWidth;
    let height = canvas.clientHeight;
    let dpr = Math.min(2, window.devicePixelRatio || 1);

    const applySize = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
    };

    applySize();

    const initialPose = overviewPose(scene.projection, width, height);
    if (!cameraRef.current) {
      cameraRef.current = new CameraController(initialPose);
    } else {
      cameraRef.current.jumpTo(initialPose);
    }
    const camera = cameraRef.current;
    camera.minScale = initialPose.scale * 0.62;

    const resizeObserver = new ResizeObserver(() => {
      applySize();
    });
    resizeObserver.observe(canvas);

    let rafId = 0;
    let lastFrame = 0;
    const shots = attractShots(scene.projection);

    const frame = (now: number) => {
      const dtMs = lastFrame === 0 ? 16 : Math.min(80, now - lastFrame);
      lastFrame = now;

      const stats = frameStatsRef.current;
      stats.emaDt = stats.emaDt * 0.94 + dtMs * 0.06;
      const effectsBudget = stats.emaDt > 30 ? 0.35 : stats.emaDt > 22 ? 0.7 : 1;

      const store = useBattleStore.getState();
      const { simulationState, uiState, storyState, data } = store;

      if (simulationState.isPlaying) {
        store.advanceTimeline(dtMs);
      }

      const viewport = { width, height };

      // A manual override lasts until the story moves to another chapter (or
      // the intro attract loop takes over again).
      const override = overrideRef.current;
      if (
        override.active
        && (attractStateRef.current || storyState.activeChapterId !== override.chapterId)
      ) {
        override.active = false;
        setCameraOverridden(false);
      }

      // --- Camera direction -------------------------------------------------
      if (attractStateRef.current) {
        const attractState = attractRef.current;
        attractState.elapsed += dtMs;
        const shot = shots[attractState.index % shots.length];
        if (attractState.elapsed > shot.holdMs) {
          attractState.elapsed = 0;
          attractState.index += 1;
        }
        camera.stiffness = 0.24;
        camera.easeTo(shots[attractState.index % shots.length]);
      } else if (!override.active && data) {
        camera.stiffness = reducedMotionRef.current ? 14 : 2.6;

        if (uiState.guidedMode) {
          const lockedId = storyState.lockedFormationId;
          const chapter = storyState.activeChapterId
            ? data.chapters.find((entry) => entry.id === storyState.activeChapterId) ?? null
            : null;
          const beat = storyState.activeBeatId
            ? data.narrativeBeats.find((entry) => entry.id === storyState.activeBeatId) ?? null
            : null;

          if (lockedId) {
            const followed = scene.formationWorldAt(lockedId, simulationState.simTimeMs);
            if (followed) {
              camera.easeTo({ x: followed.x, y: followed.y });
            }
          } else if (chapter) {
            const pose = chapterPoseAt(chapter, simulationState.simTimeMs, scene.projection);
            if (pose) {
              camera.easeTo(pose);
            }
          } else if (beat) {
            camera.easeTo(beatPose(beat, scene.projection));
          } else {
            camera.easeTo(overviewPose(scene.projection, width, height));
          }
        }
      }

      camera.update(dtMs);

      // --- Particles + paint ------------------------------------------------
      particles.update(dtMs);

      const beatForFocus = storyState.activeBeatId && uiState.guidedMode
        ? data?.narrativeBeats.find((entry) => entry.id === storyState.activeBeatId) ?? null
        : null;
      const focusWorld = beatForFocus
        ? scene.projection.toWorld(beatForFocus.cameraPose.lat, beatForFocus.cameraPose.lng)
        : null;

      anchorsRef.current = scene.draw(
        ctx,
        camera,
        viewport,
        particles,
        {
          timeMs: simulationState.simTimeMs,
          dtMs,
          selectedFormationId: uiState.selectedFormationId,
          hoveredFormationId: hoveredRef.current,
          focusWorld,
          isPlaying: simulationState.isPlaying,
          reducedMotion: reducedMotionRef.current,
          effectsBudget,
        },
        dpr,
      );

      // Keep the hover tooltip glued to its formation while the map animates.
      const tooltip = tooltipRef.current;
      if (tooltip && hoveredRef.current) {
        const anchor = anchorsRef.current.find((entry) => entry.formationId === hoveredRef.current);
        if (anchor) {
          tooltip.style.transform =
            `translate(${Math.round(anchor.x)}px, ${Math.round(anchor.y - anchor.radiusPx - 14)}px)`;
        }
      }

      rafId = requestAnimationFrame(frame);
    };

    rafId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
    };
  }, [particles, scene]);

  // --- Pointer interactions -------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const findAnchor = (x: number, y: number): FormationScreenAnchor | null => {
      let best: FormationScreenAnchor | null = null;
      let bestDistance = Infinity;

      for (const anchor of anchorsRef.current) {
        const distance = Math.hypot(anchor.x - x, anchor.y - y);
        if (distance < Math.max(26, anchor.radiusPx) && distance < bestDistance) {
          best = anchor;
          bestDistance = distance;
        }
      }

      return best;
    };

    const markOverride = () => {
      if (!attractStateRef.current && !overrideRef.current.active) {
        const { uiState, storyState } = useBattleStore.getState();
        if (uiState.guidedMode) {
          overrideRef.current = {
            active: true,
            chapterId: storyState.activeChapterId,
          };
          setCameraOverridden(true);
        }
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      if (attractStateRef.current) {
        return;
      }
      canvas.setPointerCapture(event.pointerId);
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      dragRef.current.moved = 0;
      if (pointersRef.current.size === 2) {
        const [a, b] = [...pointersRef.current.values()];
        dragRef.current.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      if (attractStateRef.current) {
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;

      const tracked = pointersRef.current.get(event.pointerId);
      if (!tracked) {
        const anchor = findAnchor(localX, localY);
        const nextHover = anchor?.formationId ?? null;
        if (nextHover !== hoveredRef.current) {
          setHoveredFormationId(nextHover);
        }
        canvas.style.cursor = anchor ? "pointer" : "grab";
        return;
      }

      const camera = cameraRef.current;
      if (!camera) {
        return;
      }

      if (pointersRef.current.size === 2) {
        pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const [a, b] = [...pointersRef.current.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const previous = dragRef.current.pinchDist ?? dist;
        if (previous > 0) {
          const midX = (a.x + b.x) / 2 - rect.left;
          const midY = (a.y + b.y) / 2 - rect.top;
          camera.zoomAround(midX, midY, dist / previous, { width: rect.width, height: rect.height });
          markOverride();
        }
        dragRef.current.pinchDist = dist;
        return;
      }

      const dx = event.clientX - tracked.x;
      const dy = event.clientY - tracked.y;
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      dragRef.current.moved += Math.abs(dx) + Math.abs(dy);

      if (dragRef.current.moved > 4) {
        camera.panBy(dx, dy);
        canvas.style.cursor = "grabbing";
        markOverride();
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      if (attractStateRef.current) {
        return;
      }

      const wasDrag = dragRef.current.moved > 6;
      pointersRef.current.delete(event.pointerId);
      dragRef.current.pinchDist = null;
      canvas.style.cursor = "grab";

      if (!wasDrag) {
        const rect = canvas.getBoundingClientRect();
        const anchor = findAnchor(event.clientX - rect.left, event.clientY - rect.top);
        useBattleStore.getState().selectFormation(anchor?.formationId ?? null);
      }
    };

    const onWheel = (event: WheelEvent) => {
      if (attractStateRef.current) {
        return;
      }
      event.preventDefault();

      const camera = cameraRef.current;
      if (!camera) {
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * 0.0016);
      camera.zoomAround(
        event.clientX - rect.left,
        event.clientY - rect.top,
        factor,
        { width: rect.width, height: rect.height },
      );
      markOverride();
    };

    const onDoubleClick = (event: MouseEvent) => {
      if (attractStateRef.current) {
        return;
      }
      const camera = cameraRef.current;
      if (!camera) {
        return;
      }
      const rect = canvas.getBoundingClientRect();
      camera.zoomAround(
        event.clientX - rect.left,
        event.clientY - rect.top,
        1.7,
        { width: rect.width, height: rect.height },
      );
      markOverride();
    };

    const onPointerLeave = () => {
      setHoveredFormationId(null);
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("dblclick", onDoubleClick);

    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("dblclick", onDoubleClick);
    };
  }, []);

  const hoveredFormation = hoveredFormationId
    ? bundle.formations.find((formation) => formation.id === hoveredFormationId) ?? null
    : null;

  return (
    <div className="canvas-stage">
      <canvas
        ref={canvasRef}
        className="battlefield-canvas"
        data-testid="battlefield-canvas"
        aria-label="Animated map of the Battle of Franklin"
        role="img"
      />
      {hoveredFormation ? (
        <div ref={tooltipRef} className="formation-tooltip" role="status">
          <span className={`tooltip-side ${hoveredFormation.side.toLowerCase()}`}>
            {hoveredFormation.side}
          </span>
          <strong>{hoveredFormation.name}</strong>
          <small>{hoveredFormation.commander}</small>
        </div>
      ) : null}
      {cameraOverridden && !attract ? (
        <button
          type="button"
          className="camera-resume"
          onClick={() => {
            overrideRef.current = { active: false, chapterId: null };
            setCameraOverridden(false);
          }}
        >
          ⟲ Resume cinematic camera
        </button>
      ) : null}
    </div>
  );
}
