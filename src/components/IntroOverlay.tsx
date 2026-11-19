import { ArrowUpRight } from 'lucide-react';
import type { SiteConfig } from '../config/theme';

interface IntroOverlayProps {
  config: SiteConfig;
  visible: boolean;
  onOpenPortfolio: () => void;
}

export function IntroOverlay({ config, visible, onOpenPortfolio }: IntroOverlayProps) {
  return (
    <section
      aria-label="Portfolio introduction"
      aria-hidden={!visible}
      className={`pointer-events-none fixed inset-x-0 top-20 z-20 px-5 transition-all duration-300 ease-out sm:top-24 sm:px-8 ${
        visible ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0'
      }`}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 -left-16 h-[340px] w-[580px] rounded-full bg-[radial-gradient(ellipse_at_28%_38%,rgba(7,10,10,0.68)_0%,rgba(7,10,10,0.34)_48%,rgba(7,10,10,0)_76%)]"
      />
      <div className="relative max-w-xl">
        <h1 className="text-[clamp(1.85rem,3.6vw,3.15rem)] font-semibold leading-[1.08] tracking-tight text-[#f5f2eb] text-balance drop-shadow-[0_2px_10px_rgba(0,0,0,0.45)]">
          {config.introHeading}
        </h1>
        <p className="mt-3 max-w-md text-[14px] leading-relaxed text-[#ccc6ba] drop-shadow-[0_1px_6px_rgba(0,0,0,0.55)] sm:text-[15px]">
          {config.introSupport}
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-4">
          <button
            type="button"
            tabIndex={visible ? 0 : -1}
            onClick={onOpenPortfolio}
            className="pointer-events-auto inline-flex min-h-[44px] items-center gap-2 rounded-sm border border-[#e6b873]/45 bg-[#1b1916]/95 px-5 py-2.5 text-[13px] font-semibold text-[#f5f2eb] transition-colors hover:border-[#e6b873] hover:bg-[#27231e] whitespace-nowrap"
          >
            <span>{config.openCtaLabel}</span>
            <ArrowUpRight className="h-4 w-4 text-[#e6b873]" aria-hidden="true" />
          </button>
          <span className="text-[12px] text-[#b3ada1] drop-shadow-[0_1px_5px_rgba(0,0,0,0.65)]">
            Or click the book cover
          </span>
        </div>
      </div>
    </section>
  );
}
