import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Globe, Play, Square, X } from 'lucide-react';
import type { ProjectItem } from '../data/projects';
import { createPageTextureHandle } from '../engine/textures';
import { SITE_CONFIG } from '../config/theme';

interface ProjectDetailModalProps {
  project: ProjectItem | null;
  reducedMotion: boolean;
  onClose: () => void;
}

export function ProjectDetailModal({
  project,
  reducedMotion,
  onClose,
}: ProjectDetailModalProps) {
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const previewCanvasHostRef = useRef<HTMLDivElement>(null);
  const [isPlayingPreview, setIsPlayingPreview] = useState(!reducedMotion);
  const [viewMode, setViewMode] = useState<'preview' | 'live'>('preview');
  const [iframeLoading, setIframeLoading] = useState(true);

  const liveUrl = project?.media?.liveEmbedUrl || null;
  const externalUrl = project?.destinationUrl || liveUrl || null;

  useEffect(() => {
    setIsPlayingPreview(!reducedMotion);
    setViewMode(project?.media?.liveEmbedUrl ? 'live' : 'preview');
    setIframeLoading(true);
  }, [project?.id, project?.media?.liveEmbedUrl, reducedMotion]);

  // Focus management & Escape key handling
  useEffect(() => {
    if (!project) return;
    closeBtnRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [project, onClose]);

  // Render live project artwork, screenshot, or video preview inside modal canvas
  useEffect(() => {
    const host = previewCanvasHostRef.current;
    if (!project || !host || viewMode !== 'preview') return;

    host.innerHTML = '';
    const handle = createPageTextureHandle(
      { kind: 'project', project },
      project.side,
      SITE_CONFIG.brandName,
      1,
    );
    const canvas = handle.canvas;
    canvas.className = 'w-full h-auto block rounded-sm';
    host.appendChild(canvas);

    let timer = 0;
    const start = performance.now();

    if (isPlayingPreview && !reducedMotion && project.hasAnimatedPreview) {
      const tick = () => {
        const elapsed = (performance.now() - start) / 1000;
        handle.render(elapsed, false);
        timer = window.setTimeout(tick, 45);
      };
      tick();
    } else {
      handle.render(0, false);
    }

    return () => {
      clearTimeout(timer);
      handle.dispose();
      host.innerHTML = '';
    };
  }, [project, isPlayingPreview, reducedMotion, viewMode]);

  if (!project) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/82 p-4 sm:p-6"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-modal-title"
        className="relative max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-sm border border-white/15 bg-[#141311] text-[#f5f2eb] shadow-2xl"
      >
        {/* Top bar */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-[#141311] px-6 py-4">
          <div className="flex items-center gap-3 text-[12px] text-[#a7a195]">
            <span className="font-mono-tabular">{project.indexNumber}</span>
            <span aria-hidden="true">·</span>
            <span>{project.category}</span>
            <span aria-hidden="true">·</span>
            <span>{project.isDemo ? 'Demo Showcase' : project.year}</span>
          </div>

          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label={`Close ${project.title} details`}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-sm border border-white/12 text-[#d6d0c4] transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-6 p-6 sm:p-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-2xl">
              <h2
                id="project-modal-title"
                className="font-editorial text-3xl font-medium tracking-tight text-[#f5f2eb] sm:text-4xl"
              >
                {project.title}
              </h2>
              <p className="mt-2 text-[15px] leading-relaxed text-[#c6c0b4]">
                {project.summary}
              </p>
            </div>

            {liveUrl && (
              <div
                role="tablist"
                aria-label="Project view mode"
                className="inline-flex items-center rounded-sm border border-white/15 bg-[#0c0b0a] p-1"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={viewMode === 'live'}
                  onClick={() => setViewMode('live')}
                  className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-sm px-3 py-1.5 text-[12px] font-medium transition-colors whitespace-nowrap ${
                    viewMode === 'live'
                      ? 'bg-[#f5f2eb] text-[#141416]'
                      : 'text-[#bfb9ad] hover:text-white'
                  }`}
                >
                  <Globe className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Live website</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={viewMode === 'preview'}
                  onClick={() => setViewMode('preview')}
                  className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-sm px-3 py-1.5 text-[12px] font-medium transition-colors whitespace-nowrap ${
                    viewMode === 'preview'
                      ? 'bg-[#f5f2eb] text-[#141416]'
                      : 'text-[#bfb9ad] hover:text-white'
                  }`}
                >
                  <Play className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Book plate</span>
                </button>
              </div>
            )}
          </div>

          {/* Interactive Live Website Iframe OR Book Preview Plate */}
          <div className="space-y-2.5">
            {viewMode === 'live' && liveUrl ? (
              <div className="relative aspect-video w-full overflow-hidden rounded-sm border border-white/15 bg-[#0a0908]">
                {iframeLoading && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[13px] text-[#a7a195]">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-[#ebb566]" />
                    <span>Loading live site preview...</span>
                  </div>
                )}
                <iframe
                  src={liveUrl}
                  title={`${project.title} live website`}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                  loading="lazy"
                  onLoad={() => setIframeLoading(false)}
                  className="relative z-10 h-full w-full border-0 bg-white"
                />
              </div>
            ) : (
              <div
                ref={previewCanvasHostRef}
                className="overflow-hidden rounded-sm border border-white/12 bg-[#0c0b0a]"
              />
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 text-[12px] text-[#9b9589]">
              <span>
                {viewMode === 'live' && liveUrl
                  ? 'If a site blocks embedding via X-Frame-Options, use Open live project below.'
                  : project.details.clientLabel}
              </span>
              {viewMode === 'preview' && project.hasAnimatedPreview && !reducedMotion && (
                <button
                  type="button"
                  onClick={() => setIsPlayingPreview((prev) => !prev)}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-sm border border-white/15 px-3 py-1.5 text-[12px] font-medium text-[#f5f2eb] transition-colors hover:bg-white/10"
                >
                  {isPlayingPreview ? (
                    <>
                      <Square className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Show static poster</span>
                    </>
                  ) : (
                    <>
                      <Play className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Play live preview</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Editorial metadata grid */}
          <div className="grid gap-6 border-t border-white/10 pt-6 sm:grid-cols-2">
            <div>
              <h3 className="text-[12px] font-medium text-[#8d877b]">Role & Scope</h3>
              <p className="mt-1.5 text-[14px] text-[#ece6da]">{project.details.role}</p>

              <h3 className="mt-5 text-[12px] font-medium text-[#8d877b]">Deliverables</h3>
              <ul className="mt-1.5 space-y-1 text-[14px] text-[#c6c0b4]">
                {project.details.deliverables.map((item) => (
                  <li key={item}>— {item}</li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="text-[12px] font-medium text-[#8d877b]">Project Notes</h3>
              <p className="mt-1.5 text-[14px] leading-relaxed text-[#c6c0b4]">
                {project.details.overview}
              </p>

              <ul className="mt-4 space-y-1.5 text-[13px] text-[#a7a195]">
                {project.details.highlights.map((hl) => (
                  <li key={hl}>· {hl}</li>
                ))}
              </ul>
            </div>
          </div>

          {/* Demo disclosure & optional external link */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-5">
            <p className="text-[12px] text-[#8f897e]">
              {project.isDemo
                ? 'Demo placeholder — plug your liveEmbedUrl, screenshotUrl, or videoUrl into projects data anytime.'
                : 'Live portfolio entry.'}
            </p>
            {externalUrl ? (
              <a
                href={externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-sm bg-[#f5f2eb] px-4 py-2 text-[13px] font-semibold text-[#141416] transition-colors hover:bg-[#ebb566]"
              >
                <span>Open live project</span>
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </a>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="inline-flex min-h-[44px] items-center rounded-sm border border-white/15 px-4 py-2 text-[13px] font-medium text-[#f5f2eb] transition-colors hover:bg-white/10"
              >
                Return to book
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
