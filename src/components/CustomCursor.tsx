import { useEffect, useRef, useState } from 'react';

interface CustomCursorProps {
  /** True when raycaster hovers clickable 3D book faces (closed cover, pages, contents entries). */
  sceneInteractive: boolean;
  /** Disable custom cursor hiding inside modals if preferred, or keep synchronized everywhere. */
  disabled?: boolean;
}

/**
 * Translucent white circular pointer overlay that follows desktop mouse movement
 * smoothly and expands gently when hovering clickable 3D book surfaces or HTML controls.
 */
export function CustomCursor({ sceneInteractive, disabled = false }: CustomCursorProps) {
  const ringRef = useRef<HTMLDivElement>(null);
  const currentPosRef = useRef({ x: -100, y: -100 });
  const [visible, setVisible] = useState(false);
  const [htmlInteractive, setHtmlInteractive] = useState(false);
  const [suppressedOverNative, setSuppressedOverNative] = useState(false);

  useEffect(() => {
    if (disabled) return;
    const isCoarse = window.matchMedia('(pointer: coarse)').matches;
    if (isCoarse) return;

    const root = document.documentElement;
    root.classList.add('has-custom-cursor');

    const target = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const current = { x: target.x, y: target.y };
    let rafId = 0;
    let isShown = false;

    const tick = () => {
      current.x += (target.x - current.x) * 0.24;
      current.y += (target.y - current.y) * 0.24;
      currentPosRef.current.x = current.x;
      currentPosRef.current.y = current.y;

      if (ringRef.current) {
        ringRef.current.style.transform = `translate3d(${current.x}px, ${current.y}px, 0)`;
      }

      if (
        Math.abs(target.x - current.x) > 0.2 ||
        Math.abs(target.y - current.y) > 0.2
      ) {
        rafId = requestAnimationFrame(tick);
      } else {
        rafId = 0;
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      target.x = e.clientX;
      target.y = e.clientY;
      if (!isShown) {
        isShown = true;
        current.x = e.clientX;
        current.y = e.clientY;
        currentPosRef.current.x = e.clientX;
        currentPosRef.current.y = e.clientY;
        setVisible(true);
      }
      if (ringRef.current) {
        ringRef.current.style.transform = `translate3d(${current.x}px, ${current.y}px, 0)`;
      }

      const el = e.target as HTMLElement | null;
      const isNativeField = Boolean(el?.closest('input, textarea, select, iframe'));
      setSuppressedOverNative(isNativeField);
      const isButtonOrLink = Boolean(
        !isNativeField && el?.closest('button:not(:disabled), a[href], [role="button"]'),
      );
      setHtmlInteractive(isButtonOrLink);

      if (!rafId) {
        rafId = requestAnimationFrame(tick);
      }
    };

    const onPointerLeave = () => {
      isShown = false;
      setVisible(false);
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('mouseleave', onPointerLeave);

    return () => {
      root.classList.remove('has-custom-cursor');
      cancelAnimationFrame(rafId);
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('mouseleave', onPointerLeave);
    };
  }, [disabled]);

  if (disabled || !visible || suppressedOverNative) return null;

  const active = sceneInteractive || htmlInteractive;

  return (
    <div
      ref={ringRef}
      aria-hidden="true"
      style={{
        transform: `translate3d(${currentPosRef.current.x}px, ${currentPosRef.current.y}px, 0)`,
      }}
      className="pointer-events-none fixed left-0 top-0 z-[70] -ml-2 -mt-2 will-change-transform"
    >
      <div
        className={`h-4 w-4 rounded-full border transition-all duration-150 ease-out ${
          active
            ? 'scale-125 border-white/90 bg-white/22'
            : 'scale-100 border-white/65 bg-white/10'
        }`}
      />
    </div>
  );
}
