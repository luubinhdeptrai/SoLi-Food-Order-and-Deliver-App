import { BadgeCheck, ShieldCheck } from 'lucide-react';

export function LoginFooter() {
  return (
    <div className="mt-6 flex items-center justify-center gap-6 text-on-surface-variant">
      <div className="flex items-center gap-2">
        <BadgeCheck className="text-primary w-4 h-4" strokeWidth={1.5} />
        <span className="text-xs font-bold uppercase tracking-widest">
          ISO 27001 Certified
        </span>
      </div>
      <div className="w-1 h-1 rounded-full bg-outline-variant"></div>
      <div className="flex items-center gap-2">
        <ShieldCheck className="text-primary w-4 h-4" strokeWidth={1.5} />
        <span className="text-xs font-bold uppercase tracking-widest">
          GDPR Compliant
        </span>
      </div>
    </div>
  );
}
