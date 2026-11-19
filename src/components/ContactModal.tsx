import { useEffect, useRef, useState } from 'react';
import { Check, Copy, ExternalLink, Mail, X } from 'lucide-react';
import type { SiteConfig } from '../config/theme';

interface ContactModalProps {
  config: SiteConfig;
  open: boolean;
  onClose: () => void;
}

export function ContactModal({ config, open, onClose }: ContactModalProps) {
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const [senderName, setSenderName] = useState('');
  const [projectTopic, setProjectTopic] = useState('');
  const [message, setMessage] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedChannel, setCopiedChannel] = useState<string | null>(null);
  const [prepared, setPrepared] = useState(false);

  useEffect(() => {
    if (!open) return;
    closeBtnRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handlePrepare = (e: React.FormEvent) => {
    e.preventDefault();
    if (!senderName.trim() || !message.trim()) {
      setErrorMsg('Please enter your name and a brief project note.');
      return;
    }
    setErrorMsg(null);
    setPrepared(true);

    if (config.contact.email) {
      const subject = encodeURIComponent(
        `[${config.brandName}] ${projectTopic.trim() || 'Portfolio Inquiry'} — ${senderName.trim()}`,
      );
      const body = encodeURIComponent(message.trim());
      window.location.href = `mailto:${config.contact.email}?subject=${subject}&body=${body}`;
    }
  };

  const handleCopyChannel = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedChannel(label);
      setTimeout(() => setCopiedChannel((curr) => (curr === label ? null : curr)), 2000);
    } catch {
      setCopiedChannel(null);
    }
  };

  const handleCopySummary = async () => {
    const summary = [
      `To: ${config.contact.studioName}`,
      `From: ${senderName.trim() || '(Your Name)'}`,
      `Topic: ${projectTopic.trim() || 'Commission Inquiry'}`,
      '',
      message.trim() || '(Inquiry message)',
    ].join('\n');
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 sm:p-6"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="contact-modal-title"
        className="w-full max-w-lg rounded-sm border border-white/15 bg-[#141311] text-[#f5f2eb] shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div>
            <h2
              id="contact-modal-title"
              className="text-[18px] font-semibold tracking-tight text-[#f5f2eb]"
            >
              Get in touch
            </h2>
            <p className="text-[12px] text-[#9c968b]">{config.contact.availabilityLabel}</p>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="Close contact dialog"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-sm border border-white/12 text-[#d6d0c4] transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-5 p-6">
          {/* Contact channels with direct links & copy-to-clipboard */}
          <div className="space-y-2.5 border-b border-white/10 pb-5 text-[13px]">
            {config.contact.channels.map((ch) => (
              <div key={ch.label} className="flex items-center justify-between gap-4">
                <span className="text-[#958f83]">{ch.label}</span>
                <div className="flex items-center gap-2">
                  {ch.href ? (
                    <a
                      href={ch.href}
                      target={ch.href.startsWith('http') ? '_blank' : undefined}
                      rel={ch.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                      className="inline-flex items-center gap-1.5 font-medium text-[#f5d08a] underline-offset-4 hover:underline"
                    >
                      <span>{ch.value}</span>
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    </a>
                  ) : (
                    <span className="text-right text-[#b8b2a6]">{ch.value}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => handleCopyChannel(ch.label, ch.value)}
                    aria-label={`Copy ${ch.label}`}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-white/12 text-[#b8b2a6] transition-colors hover:bg-white/10 hover:text-white"
                  >
                    {copiedChannel === ch.label ? (
                      <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Inquiry composer */}
          <form onSubmit={handlePrepare} className="space-y-4" noValidate>
            <div>
              <label htmlFor="contact-name" className="block text-[12px] font-medium text-[#b8b2a6]">
                Your name
              </label>
              <input
                id="contact-name"
                type="text"
                value={senderName}
                onChange={(e) => setSenderName(e.target.value)}
                placeholder="Alex Mercer"
                className="mt-1.5 w-full rounded-sm border border-white/15 bg-[#0e0d0c] px-3 py-2.5 text-[14px] text-[#f5f2eb] placeholder:text-[#666157]"
              />
            </div>

            <div>
              <label htmlFor="contact-topic" className="block text-[12px] font-medium text-[#b8b2a6]">
                Project scope (optional)
              </label>
              <input
                id="contact-topic"
                type="text"
                value={projectTopic}
                onChange={(e) => setProjectTopic(e.target.value)}
                placeholder="Editorial Monograph / Spatial Web Experience"
                className="mt-1.5 w-full rounded-sm border border-white/15 bg-[#0e0d0c] px-3 py-2.5 text-[14px] text-[#f5f2eb] placeholder:text-[#666157]"
              />
            </div>

            <div>
              <label htmlFor="contact-message" className="block text-[12px] font-medium text-[#b8b2a6]">
                Message
              </label>
              <textarea
                id="contact-message"
                rows={3}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Share timeline, context, or collaboration goals."
                className="mt-1.5 w-full rounded-sm border border-white/15 bg-[#0e0d0c] px-3 py-2.5 text-[14px] text-[#f5f2eb] placeholder:text-[#666157]"
              />
            </div>

            {errorMsg && (
              <p role="alert" className="text-[12px] text-amber-300">
                {errorMsg}
              </p>
            )}

            {prepared && (
              <div
                role="status"
                className="rounded-sm border border-[#e6b873]/30 bg-[#1e1a14] px-3.5 py-2.5 text-[12px] text-[#f0dec0]"
              >
                {config.contact.email
                  ? 'Opening your configured mail client.'
                  : 'Inquiry drafted locally. Configure VITE_CONTACT_EMAIL or VITE_CONTACT_URL in .env to wire direct dispatch, or copy the draft below.'}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2.5 pt-1">
              <button
                type="button"
                onClick={handleCopySummary}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-sm border border-white/15 px-3.5 py-2 text-[13px] font-medium text-[#e5dfd4] transition-colors hover:bg-white/10"
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                    <span>Copied draft</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" aria-hidden="true" />
                    <span>Copy inquiry</span>
                  </>
                )}
              </button>

              <button
                type="submit"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-sm bg-[#f5f2eb] px-4 py-2 text-[13px] font-semibold text-[#141416] transition-colors hover:bg-[#e6b873]"
              >
                <Mail className="h-4 w-4" aria-hidden="true" />
                <span>{config.contact.email ? 'Send email' : 'Prepare inquiry'}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
