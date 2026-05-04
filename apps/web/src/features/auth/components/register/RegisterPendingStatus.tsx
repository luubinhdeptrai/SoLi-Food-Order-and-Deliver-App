export function RegisterPendingStatus() {
  return (
    <div className="md:col-span-2 bg-surface-container-lowest rounded-xl p-8 flex flex-col justify-between">
      <div>
        <div className="flex items-center gap-3 mb-6">
          <span className="material-symbols-outlined text-secondary">
            hourglass_empty
          </span>
          <h3 className="text-xl font-bold font-headline">
            Current Status: Pending Approval
          </h3>
        </div>
        <div className="space-y-4">
          <p className="text-on-surface-variant leading-relaxed">
            A System Administrator is manually verifying your documentation and
            restaurant profile. This process typically takes{' '}
            <span className="font-bold text-primary">24-48 business hours</span>
            .
          </p>
          <div className="p-4 bg-surface-container-low rounded-lg border-l-4 border-secondary">
            <p className="text-sm font-medium italic text-on-secondary-container">
              "Manual verification ensures the authenticity of all UITfood
              partners, protecting both you and our customers."
            </p>
          </div>
        </div>
      </div>
      <div className="mt-8 flex flex-wrap items-center gap-4 text-sm text-on-surface-variant font-medium">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-primary-fixed-dim"></span>{' '}
          Application Received
        </span>
        <span className="material-symbols-outlined text-xs">chevron_right</span>
        <span className="flex items-center gap-1 text-primary">
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse"></span>{' '}
          Under Review
        </span>
        <span className="material-symbols-outlined text-xs">chevron_right</span>
        <span className="flex items-center gap-1 opacity-40">
          <span className="w-2 h-2 rounded-full bg-stone-300"></span> Live
        </span>
      </div>
    </div>
  );
}
