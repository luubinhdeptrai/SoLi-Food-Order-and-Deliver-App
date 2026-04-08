export function RegisterPendingMobileNav() {
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-surface/80 backdrop-blur-md h-16 flex items-center justify-around z-50 border-t border-outline-variant/20 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
      <button className="flex flex-col items-center gap-1 text-on-surface-variant/70 hover:text-on-surface transition-colors focus:outline-none">
        <span className="material-symbols-outlined">person_add</span>
        <span className="text-[10px] font-medium font-label">Account</span>
      </button>
      <button className="flex flex-col items-center gap-1 text-on-surface-variant/70 hover:text-on-surface transition-colors focus:outline-none">
        <span className="material-symbols-outlined">storefront</span>
        <span className="text-[10px] font-medium font-label">Profile</span>
      </button>
      <button className="flex flex-col items-center gap-1 text-on-surface-variant/70 hover:text-on-surface transition-colors focus:outline-none">
        <span className="material-symbols-outlined">map</span>
        <span className="text-[10px] font-medium font-label">Location</span>
      </button>
      <button className="flex flex-col items-center gap-1 text-primary focus:outline-none">
        <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>
          pending_actions
        </span>
        <span className="text-[10px] font-bold font-label">Status</span>
      </button>
    </nav>
  );
}
