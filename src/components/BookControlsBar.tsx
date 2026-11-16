import { useState } from 'react';
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Eye,
  ExternalLink,
  List,
  X,
} from 'lucide-react';
import {
  BOOK_SPREADS,
  DEMO_PROJECTS,
  PHYSICAL_PAGE_COUNT,
  type ProjectItem,
} from '../data/projects';
import type { BookControllerState, PageSide } from '../engine/bookState';

interface BookControlsBarProps {
  bookState: BookControllerState;
  isMobile: boolean;
  hoveredProject: ProjectItem | null;
  hoveredSide: PageSide | null;
  onPrev: () => void;
  onNext: () => void;
  onContents: () => void;
  onCloseBook: () => void;
  onSelectSpread: (spreadIndex: number, side?: PageSide) => void;
  onSetMobileSide: (side: PageSide) => void;
  onTogglePreview: (side: PageSide) => void;
  onViewProject: (project: ProjectItem, triggerEl: HTMLElement | null) => void;
}

export function BookControlsBar({
  bookState,
  isMobile,
  hoveredProject,
  hoveredSide,
  onPrev,
  onNext,
  onContents,
  onCloseBook,
  onSelectSpread,
  onSetMobileSide,
  onTogglePreview,
  onViewProject,
}: BookControlsBarProps) {
  const [indexOpen, setIndexOpen] = useState(false);
  const isVisible = bookState.phase !== 'closed' && bookState.phase !== 'closing';
  const spread = BOOK_SPREADS[bookState.currentSpread] ?? BOOK_SPREADS[0];
  const isAtStart =
    bookState.currentSpread === 0 && (!isMobile || bookState.mobileSide === 'left');
  const isAtEnd =
    bookState.currentSpread === bookState.totalSpreads - 1 &&
    (!isMobile || bookState.mobileSide === 'right');

  // Visible project(s) on current spread for accessible HTML actions outside canvas
  const leftProject = spread.left.kind === 'project' ? spread.left.project : null;
  const rightProject = spread.right.kind === 'project' ? spread.right.project : null;
  const activeMobileProject =
    bookState.mobileSide === 'left' ? leftProject : rightProject;
  const focusedProjects: Array<{ project: ProjectItem; side: PageSide }> = isMobile
    ? activeMobileProject
      ? [{ project: activeMobileProject, side: bookState.mobileSide }]
      : []
    : [
        ...(leftProject ? [{ project: leftProject, side: 'left' as const }] : []),
        ...(rightProject ? [{ project: rightProject, side: 'right' as const }] : []),
      ];

  return (
    <div
      aria-hidden={!isVisible}
      className={`pointer-events-none fixed inset-x-0 bottom-0 z-25 flex flex-col items-center gap-2 px-3 pb-3 transition-all duration-300 sm:px-6 sm:pb-5 ${
        isVisible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
      }`}
    >
      {/* Collapsible accessible project index */}
      {isVisible && indexOpen && (
        <nav
          aria-label="Project index"
          className="pointer-events-auto flex max-w-2xl flex-wrap items-center justify-center gap-1 rounded-sm border border-white/14 bg-[#141311]/95 px-3 py-2 text-[12px] text-[#d5cfc4] shadow-xl"
        >
          {DEMO_PROJECTS.map((proj) => (
            <button
              key={proj.id}
              type="button"
              onClick={() => {
                setIndexOpen(false);
                onSelectSpread(proj.spreadIndex, proj.side);
              }}
              className="min-h-[38px] rounded-sm px-2.5 py-1 text-[12px] text-[#e7e1d6] transition-colors hover:bg-white/10 hover:text-[#f5d08a] whitespace-nowrap"
            >
              {proj.indexNumber}. {proj.title}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setIndexOpen(false);
              onSelectSpread(BOOK_SPREADS.length - 1, 'left');
            }}
            className="min-h-[38px] rounded-sm px-2.5 py-1 text-[12px] text-[#a8a194] transition-colors hover:bg-white/10 hover:text-[#f5d08a] whitespace-nowrap"
          >
            06+. Coming soon
          </button>
        </nav>
      )}

      {/* Accessible Preview & View project actions OR Coming-Soon boundary note */}
      {isVisible && focusedProjects.length > 0 && (
        <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2">
          {focusedProjects.map(({ project, side }) => {
            const isPreviewing = hoveredProject?.id === project.id && hoveredSide === side;
            return (
              <div
                key={project.id}
                className="flex items-center gap-2 rounded-sm border border-white/14 bg-[#141311]/94 px-3 py-1"
              >
                <span className="max-w-[140px] truncate text-[12px] font-medium text-[#f5f2eb] sm:max-w-[200px]">
                  {project.title}
                </span>
                <span aria-hidden="true" className="text-[#6d685f]">
                  ·
                </span>
                <button
                  type="button"
                  tabIndex={isVisible ? 0 : -1}
                  aria-pressed={isPreviewing}
                  onClick={() => onTogglePreview(side)}
                  onFocus={() => {
                    if (!isPreviewing) onTogglePreview(side);
                  }}
                  onBlur={() => {
                    if (isPreviewing) onTogglePreview(side);
                  }}
                  className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-sm px-2.5 py-1 text-[12px] font-medium transition-colors whitespace-nowrap ${
                    isPreviewing
                      ? 'bg-[#e6b873] text-[#141311]'
                      : 'text-[#d8d2c7] hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{isPreviewing ? 'Previewing' : 'Preview'}</span>
                </button>
                <button
                  type="button"
                  tabIndex={isVisible ? 0 : -1}
                  onClick={(e) => onViewProject(project, e.currentTarget)}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-sm bg-[#f5f2eb] px-3 py-1 text-[12px] font-semibold text-[#141416] transition-colors hover:bg-[#e6b873] whitespace-nowrap"
                >
                  <span>View project</span>
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
      )}
      {isVisible && spread.left.kind === 'coming-soon' && (
        <div className="pointer-events-auto rounded-sm border border-white/12 bg-[#141311]/92 px-3.5 py-2 text-[12px] text-[#c7c1b6]">
          More works coming soon · Pages 08–20 reserved
        </div>
      )}

      {/* Primary Book Navigation Dock */}
      <nav
        aria-label="Book navigation"
        className="pointer-events-auto flex flex-wrap items-center justify-center gap-1.5 rounded-sm border border-white/15 bg-[#12110f]/95 px-2.5 py-1.5 shadow-lg sm:gap-2 sm:px-3.5"
      >
        <button
          type="button"
          tabIndex={isVisible ? 0 : -1}
          disabled={isAtStart}
          onClick={onPrev}
          aria-label="Previous page"
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-sm px-3 py-2 text-[13px] font-medium text-[#f5f2eb] transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35 whitespace-nowrap"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          <span>Previous</span>
        </button>

        <button
          type="button"
          tabIndex={isVisible ? 0 : -1}
          onClick={() => {
            if (bookState.currentSpread === 0) {
              setIndexOpen((v) => !v);
            } else {
              onContents();
            }
          }}
          aria-expanded={bookState.currentSpread === 0 ? indexOpen : undefined}
          aria-label="Go to Contents"
          className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-sm px-3 py-2 text-[13px] font-medium transition-colors whitespace-nowrap ${
            bookState.currentSpread === 0 && (!isMobile || bookState.mobileSide === 'left')
              ? 'bg-white/12 text-[#f5d08a]'
              : 'text-[#e5dfd4] hover:bg-white/10'
          }`}
        >
          <List className="h-4 w-4" aria-hidden="true" />
          <span>Contents</span>
        </button>

        {isMobile && (
          <div className="flex items-center rounded-sm border border-white/10 bg-black/35 p-0.5">
            <button
              type="button"
              tabIndex={isVisible ? 0 : -1}
              onClick={() => onSetMobileSide('left')}
              className={`min-h-[44px] rounded-sm px-3 text-[12px] font-medium whitespace-nowrap ${
                bookState.mobileSide === 'left'
                  ? 'bg-[#f5f2eb] text-[#141416]'
                  : 'text-[#c9c3b8]'
              }`}
            >
              Left
            </button>
            <button
              type="button"
              tabIndex={isVisible ? 0 : -1}
              onClick={() => onSetMobileSide('right')}
              className={`min-h-[44px] rounded-sm px-3 text-[12px] font-medium whitespace-nowrap ${
                bookState.mobileSide === 'right'
                  ? 'bg-[#f5f2eb] text-[#141416]'
                  : 'text-[#c9c3b8]'
              }`}
            >
              Right
            </button>
          </div>
        )}

        <div
          className="hidden items-center gap-2 px-2 text-[12px] text-[#a8a296] sm:flex"
          aria-live="polite"
        >
          <BookOpen className="h-3.5 w-3.5 text-[#878176]" aria-hidden="true" />
          <span className="font-mono-tabular">
            {bookState.currentSpread + 1} / {bookState.totalSpreads} · {PHYSICAL_PAGE_COUNT} pp
          </span>
        </div>

        <button
          type="button"
          tabIndex={isVisible ? 0 : -1}
          disabled={isAtEnd}
          onClick={onNext}
          aria-label="Next page"
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-sm px-3 py-2 text-[13px] font-medium text-[#f5f2eb] transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35 whitespace-nowrap"
        >
          <span>Next</span>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>

        <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-white/15" />

        <button
          type="button"
          tabIndex={isVisible ? 0 : -1}
          onClick={() => {
            setIndexOpen(false);
            onCloseBook();
          }}
          aria-label="Close book"
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-sm px-3 py-2 text-[13px] font-medium text-[#d8d2c7] transition-colors hover:bg-white/10 hover:text-white whitespace-nowrap"
        >
          <X className="h-4 w-4" aria-hidden="true" />
          <span>Close book</span>
        </button>
      </nav>
    </div>
  );
}
