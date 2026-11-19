import { LampDesk, Waves } from 'lucide-react';
import type { EnvironmentId } from '../scene/environments/types';

interface EnvironmentSwitcherProps {
  activeEnv: EnvironmentId;
  onChange: (env: EnvironmentId) => void;
}

const OPTIONS: Array<{ id: EnvironmentId; label: string; Icon: typeof LampDesk }> = [
  { id: 'desk', label: 'Desk', Icon: LampDesk },
  { id: 'pond', label: 'Koi Pond', Icon: Waves },
];

export function EnvironmentSwitcher({ activeEnv, onChange }: EnvironmentSwitcherProps) {
  return (
    <div
      role="group"
      aria-label="Scene environment"
      data-testid="environment-switcher"
      className="pointer-events-auto inline-flex items-center rounded-full border border-white/14 bg-[#121110]/92 p-1 shadow-lg"
    >
      {OPTIONS.map(({ id, label, Icon }) => {
        const selected = activeEnv === id;
        return (
          <button
            key={id}
            type="button"
            data-testid={`env-btn-${id}`}
            aria-pressed={selected}
            onClick={() => {
              if (!selected) onChange(id);
            }}
            className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-medium tracking-tight transition-colors whitespace-nowrap shrink-0 ${
              selected
                ? 'bg-[#f5f2eb] text-[#141416] shadow-sm'
                : 'text-[#bfb9ad] hover:bg-white/8 hover:text-[#f5f2eb]'
            }`}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
