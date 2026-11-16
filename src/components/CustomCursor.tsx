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
  const posRef = useRef({ x: -100, y: -100 });
  const visibleRef = useRef(false);
  const htmlInteractiveRef = useRef(false);
  const suppressedRef = useRef(false);
  const [visible, setVisible] = useState(false);
  const [htmlInteractive, setHtmlInteractive] = useState(false);
  const [suppressedOverNative, setSuppressedOverNative] = useState(false);

  useEffect(() => {
    if (disabled) return;
    const isCoarse = window.matchMedia('(pointer: coarse)').matches;
    if (isCoarse) return;

    const root = document.documentElement;
    root.classList.add('has-custom-cursor');

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      posRef.current.x = e.clientX;
      posRef.current.y = e.clientY;

      if (ringRef.current) {
        ringRef.current.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;
      }

      if (!visibleRef.current) {
        visibleRef.current = true;
        setVisible(true);
      }

      const el = e.target as HTMLElement | null;
      const isNativeField = Boolean(el?.closest('input, textarea, select, iframe'));
      if (isNativeField !== suppressedRef.current) {
        suppressedRef.current = isNativeField;
        setSuppressedOverNative(isNativeField);
      }

      const isButtonOrLink = Boolean(
        !isNativeField && el?.closest('button:not(:disabled), a[href], [role="button"]'),
      );
      if (isButtonOrLink !== htmlInteractiveRef.current) {
        htmlInteractiveRef.current = isButtonOrLink;
        setHtmlInteractive(isButtonOrLink);
      }
    };

    const onPointerLeave = () => {
      if (visibleRef.current) {
        visibleRef.current = false;
        setVisible(false);
      }
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('mouseleave', onPointerLeave);

    return () => {
      root.classList.remove('has-custom-cursor');
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
        transform: `translate3d(${posRef.current.x}px, ${posRef.current.y}px, 0)`,
      }}
      className="pointer-events-none fixed left-0 top-0 z-[70] -ml-2 -mt-2 will-change-transform"
    >
      <div
        className={`h-4 w-4 rounded-full border transition-[transform,background-color,border-color] duration-150 ease-out ${
          active
            ? 'scale-125 border-white/90 bg-white/22'
            : 'scale-100 border-white/65 bg-white/10'
        }`}
      />
    </div>
  );
}
