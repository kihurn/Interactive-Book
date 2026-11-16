import { useEffect, useRef } from 'react';
import { ArrowRight, BookOpen } from 'lucide-react';
import { SITE_CONFIG } from '../config/theme';
import { DEMO_PROJECTS, type ProjectItem } from '../data/projects';
import { createPageTextureHandle } from '../engine/textures';

interface FallbackPortfolioProps {
  reason?: string | null;
  onSelectProject: (project: ProjectItem, triggerEl: HTMLElement | null) => void;
}

function ProjectThumbnailCanvas({ project }: { project: ProjectItem }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.innerHTML = '';
    const handle = createPageTextureHandle(
      { kind: 'project', project },
      project.side,
      SITE_CONFIG.brandName,
      1,
    );
    handle.canvas.className = 'w-full h-auto block';
    host.appendChild(handle.canvas);
    return () => {
      handle.dispose();
      host.innerHTML = '';
    };
  }, [project]);

  return <div ref={hostRef} className="overflow-hidden bg-[#11100e]" />;
}

/**
 * Accessible HTML portfolio fallback rendered when WebGL is unavailable or fails.
 */
export function FallbackPortfolio({ reason, onSelectProject }: FallbackPortfolioProps) {
  return (
    <main
      id="html-fallback-portfolio"
      className="min-h-screen bg-[#0d0c0a] px-5 pb-16 pt-28 text-[#f5f2eb] sm:px-8"
    >
      <div className="mx-auto max-w-5xl">
        <div className="border-b border-white/12 pb-8">
          <div className="flex items-center gap-2 text-[12px] font-medium text-[#b5ae9f]">
            <BookOpen className="h-4 w-4 text-[#e6b873]" aria-hidden="true" />
            <span>Editorial HTML Edition</span>
            {reason && (
              <>
                <span aria-hidden="true">·</span>
                <span>{reason}</span>
              </>
            )}
          </div>
          <h1 className="mt-3 text-[clamp(2rem,4vw,3.4rem)] font-semibold leading-tight tracking-tight text-balance">
            {SITE_CONFIG.introHeading}
          </h1>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-[#b8b2a6]">
            {SITE_CONFIG.introSupport} Viewing the accessible HTML portfolio collection.
          </p>
        </div>

        <section aria-label="Selected demo works" className="mt-10 grid gap-8 md:grid-cols-2">
          {DEMO_PROJECTS.map((project) => (
            <article
              key={project.id}
              className="group flex flex-col justify-between border border-white/12 bg-[#141311] transition-colors hover:border-[#e6b873]/60"
            >
              <div>
                <ProjectThumbnailCanvas project={project} />
                <div className="p-5">
                  <div className="flex items-center gap-2 text-[12px] text-[#9b9589]">
                    <span className="font-mono-tabular">{project.indexNumber}</span>
                    <span aria-hidden="true">·</span>
                    <span>{project.category}</span>
                    <span aria-hidden="true">·</span>
                    <span>Demo</span>
                  </div>
                  <h2 className="mt-2 font-editorial text-2xl font-medium text-[#f5f2eb]">
                    {project.title}
                  </h2>
                  <p className="mt-2 text-[14px] leading-relaxed text-[#beb8ac]">
                    {project.summary}
                  </p>
                </div>
              </div>

              <div className="px-5 pb-5">
                <button
                  type="button"
                  onClick={(e) => onSelectProject(project, e.currentTarget)}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-sm bg-[#f5f2eb] px-4 py-2 text-[13px] font-semibold text-[#141416] transition-colors hover:bg-[#e6b873]"
                >
                  <span>View project</span>
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
