import { useCallback, useEffect, useRef, useState } from 'react';
import { BookControlsBar } from './components/BookControlsBar';
import { ContactModal } from './components/ContactModal';
import { CustomCursor } from './components/CustomCursor';
import { FallbackPortfolio } from './components/FallbackPortfolio';
import { Header } from './components/Header';
import { IntroOverlay } from './components/IntroOverlay';
import { ProjectDetailModal } from './components/ProjectDetailModal';
import { LAMPLIT_DESK_THEME, SITE_CONFIG } from './config/theme';
import { BOOK_SPREADS, PHYSICAL_SPREAD_COUNT, type ProjectItem } from './data/projects';
import { BookSceneController } from './engine/BookSceneController';
import {
  createInitialBookState,
  type BookControllerState,
  type PageSide,
} from './engine/bookState';

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<BookSceneController | null>(null);
  const lastTriggerRef = useRef<HTMLElement | null>(null);

  const initialParams =
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const autostart = initialParams?.get('autostart') === '1';
  const forceFallback = initialParams?.get('fallback') === 'html';

  const [bookState, setBookState] = useState<BookControllerState>(() =>
    createInitialBookState(BOOK_SPREADS.length, autostart, PHYSICAL_SPREAD_COUNT),
  );
  const [sceneReady, setSceneReady] = useState(false);
  const [webglError, setWebglError] = useState<string | null>(
    forceFallback ? 'HTML portfolio mode active' : null,
  );
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 680 : false,
  );
  const [reducedMotion, setReducedMotion] = useState<boolean>(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  );

  const [hoveredProject, setHoveredProject] = useState<ProjectItem | null>(null);
  const [hoveredSide, setHoveredSide] = useState<PageSide | null>(null);
  const [cursorSceneInteractive, setCursorSceneInteractive] = useState(false);
  const [selectedProject, setSelectedProject] = useState<ProjectItem | null>(null);
  const [contactOpen, setContactOpen] = useState(false);

  const handleOpenProjectModal = useCallback(
    (project: ProjectItem, triggerEl: HTMLElement | null = null) => {
      lastTriggerRef.current =
        triggerEl ?? (document.activeElement as HTMLElement | null);
      setSelectedProject(project);
    },
    [],
  );

  const handleCloseProjectModal = useCallback(() => {
    setSelectedProject(null);
    const prev = lastTriggerRef.current;
    if (prev && typeof prev.focus === 'function') {
      requestAnimationFrame(() => prev.focus());
    }
  }, []);

  const handleOpenContact = useCallback(() => {
    lastTriggerRef.current = document.activeElement as HTMLElement | null;
    setContactOpen(true);
  }, []);

  const handleCloseContact = useCallback(() => {
    setContactOpen(false);
    const prev = lastTriggerRef.current;
    if (prev && typeof prev.focus === 'function') {
      requestAnimationFrame(() => prev.focus());
    }
  }, []);

  const callbacksRef = useRef({
    onStateChange: (next: BookControllerState) => setBookState(next),
    onHoverProject: (proj: ProjectItem | null, side: PageSide | null) => {
      setHoveredProject(proj);
      setHoveredSide(side);
    },
    onCursorInteractiveChange: (interactive: boolean) =>
      setCursorSceneInteractive(interactive),
    onSelectProject: (proj: ProjectItem) => handleOpenProjectModal(proj, null),
    onWebGLFailed: (reason: string) => setWebglError(reason),
    onReady: () => setSceneReady(true),
  });

  // Track viewport breakpoint & prefers-reduced-motion
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 680);
    window.addEventListener('resize', onResize);

    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMotionChange = () => {
      setReducedMotion(mq.matches);
      controllerRef.current?.setReducedMotion(mq.matches);
    };
    mq.addEventListener('change', onMotionChange);

    return () => {
      window.removeEventListener('resize', onResize);
      mq.removeEventListener('change', onMotionChange);
    };
  }, []);

  // Mount Three.js WebGL scene once
  useEffect(() => {
    if (forceFallback) return;
    const mount = canvasMountRef.current;
    if (!mount) return;

    const controller = new BookSceneController(
      mount,
      LAMPLIT_DESK_THEME,
      {
        onStateChange: (s) => callbacksRef.current.onStateChange(s),
        onHoverProject: (p, side) => callbacksRef.current.onHoverProject(p, side),
        onCursorInteractiveChange: (active) =>
          callbacksRef.current.onCursorInteractiveChange(active),
        onSelectProject: (p) => callbacksRef.current.onSelectProject(p),
        onWebGLFailed: (r) => callbacksRef.current.onWebGLFailed(r),
        onReady: () => callbacksRef.current.onReady(),
      },
      { autostart, reducedMotion },
    );
    controllerRef.current = controller;

    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceFallback]);

  // Global keyboard navigation when book is active and no dialog is open
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (selectedProject || contactOpen || webglError) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (bookState.phase === 'closed') {
        if (e.key === 'Enter' && e.target === document.body) {
          controllerRef.current?.openBook();
        }
        return;
      }

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        controllerRef.current?.step('next');
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        controllerRef.current?.step('prev');
      } else if (e.key === 'Home') {
        e.preventDefault();
        controllerRef.current?.goToSpread(0, 'left');
      } else if (e.key === 'Escape') {
        e.preventDefault();
        controllerRef.current?.closeBook();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [bookState.phase, selectedProject, contactOpen, webglError]);

  const handleTogglePreview = useCallback(
    (side: PageSide) => {
      const currentlyPreviewing = hoveredSide === side;
      controllerRef.current?.triggerManualPreview(currentlyPreviewing ? null : side);
    },
    [hoveredSide],
  );

  const showIntro = bookState.phase === 'closed';
  const currentSpreadObj = BOOK_SPREADS[bookState.currentSpread] ?? BOOK_SPREADS[0];

  return (
    <div
      className="relative h-screen w-screen overflow-hidden bg-[#090807] text-[#f5f2eb]"
      data-book-state={bookState.phase}
      data-spread={bookState.currentSpread}
      data-mobile-side={bookState.mobileSide}
    >
      <Header
        config={SITE_CONFIG}
        onOpenContact={handleOpenContact}
        onResetToStart={() => {
          if (bookState.phase === 'open') {
            controllerRef.current?.closeBook();
          }
        }}
      />

      {webglError ? (
        <div className="h-full w-full overflow-y-auto">
          <FallbackPortfolio
            reason={forceFallback ? null : webglError}
            onSelectProject={handleOpenProjectModal}
          />
        </div>
      ) : (
        <main className="relative h-full w-full">
          {/* Dedicated isolated WebGL canvas mount */}
          <div
            ref={canvasMountRef}
            data-testid="book-canvas-mount"
            className="h-full w-full"
          />

          {/* Loading curtain until first WebGL frame */}
          {!sceneReady && (
            <div
              role="status"
              aria-label="Preparing interactive book"
              className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-[#090807] text-[#d9d2c5]"
            >
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-[#e6b873]" />
              <p className="mt-4 text-[13px] tracking-wide text-[#a8a194]">
                Preparing desk & portfolio spreads...
              </p>
            </div>
          )}

          <IntroOverlay
            config={SITE_CONFIG}
            visible={sceneReady && showIntro}
            onOpenPortfolio={() => controllerRef.current?.openBook()}
          />

          <BookControlsBar
            bookState={bookState}
            isMobile={isMobile}
            hoveredProject={hoveredProject}
            hoveredSide={hoveredSide}
            onPrev={() => controllerRef.current?.step('prev')}
            onNext={() => controllerRef.current?.step('next')}
            onContents={() => controllerRef.current?.goToSpread(0, 'left')}
            onCloseBook={() => controllerRef.current?.closeBook()}
            onSelectSpread={(idx, side) => controllerRef.current?.goToSpread(idx, side)}
            onSetMobileSide={(side) => controllerRef.current?.setMobileSide(side)}
            onTogglePreview={handleTogglePreview}
            onViewProject={handleOpenProjectModal}
          />

          {/* Screen-reader live region describing active spread */}
          <div className="sr-only" aria-live="polite">
            {bookState.phase === 'open'
              ? `Open book spread ${bookState.currentSpread + 1} of ${bookState.totalSpreads}: ${currentSpreadObj.label}`
              : 'Book closed on desk'}
          </div>
        </main>
      )}

      <ProjectDetailModal
        project={selectedProject}
        reducedMotion={reducedMotion}
        onClose={handleCloseProjectModal}
      />

      <ContactModal
        config={SITE_CONFIG}
        open={contactOpen}
        onClose={handleCloseContact}
      />

      <CustomCursor
        sceneInteractive={cursorSceneInteractive}
        disabled={reducedMotion}
      />
    </div>
  );
}
