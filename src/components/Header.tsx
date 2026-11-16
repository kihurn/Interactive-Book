import type { SiteConfig } from '../config/theme';

interface HeaderProps {
  config: SiteConfig;
  onOpenContact: () => void;
  onResetToStart?: () => void;
}

export function Header({ config, onOpenContact, onResetToStart }: HeaderProps) {
  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-30 flex items-center justify-between px-5 py-4 sm:px-8 sm:py-6">
      <button
        type="button"
        onClick={onResetToStart}
        className="pointer-events-auto inline-flex min-h-[44px] items-center gap-2.5 rounded-sm px-1.5 py-1 text-left text-[#f5f2eb] transition-opacity hover:opacity-80"
        aria-label={`${config.brandName} portfolio home`}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          className="shrink-0"
        >
          <circle cx="12" cy="12" r="10" fill="#f5f2eb" />
          <circle cx="12" cy="12" r="4.2" fill="#0b0a09" />
          <circle cx="14.4" cy="10.8" r="1.8" fill="#f5f2eb" />
        </svg>
        <span className="text-[17px] font-semibold tracking-tight whitespace-nowrap">
          {config.brandName}
        </span>
      </button>

      <button
        type="button"
        onClick={onOpenContact}
        className="pointer-events-auto inline-flex min-h-[44px] items-center justify-center rounded-sm bg-[#f5f2eb] px-5 py-2.5 text-[13px] font-semibold tracking-tight text-[#141416] shadow-sm transition-colors hover:bg-[#e7e1d5] whitespace-nowrap shrink-0"
      >
        {config.contactButtonLabel}
      </button>
    </header>
  );
}
