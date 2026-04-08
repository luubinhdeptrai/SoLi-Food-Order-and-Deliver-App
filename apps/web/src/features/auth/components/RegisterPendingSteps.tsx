export function RegisterPendingSteps() {
  return (
    <div className="bg-surface-container rounded-xl p-8">
      <h3 className="text-xl font-bold mb-8 flex items-center gap-2 font-headline">
        <span className="material-symbols-outlined">map</span>
        What happens next?
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="space-y-4">
          <div className="w-10 h-10 rounded-full bg-surface-container-lowest flex items-center justify-center font-bold text-primary shadow-sm border border-outline-variant/20">
            1
          </div>
          <h5 className="font-bold font-headline">Verification</h5>
          <p className="text-sm text-on-surface-variant">Admin reviews your business license and store location mapping.</p>
        </div>
        <div className="space-y-4">
          <div className="w-10 h-10 rounded-full bg-surface-container-lowest flex items-center justify-center font-bold text-primary shadow-sm border border-outline-variant/20">
            2
          </div>
          <h5 className="font-bold font-headline">Notification</h5>
          <p className="text-sm text-on-surface-variant">Receive a system alert confirming your account is ready for use.</p>
        </div>
        <div className="space-y-4">
          <div className="w-10 h-10 rounded-full bg-surface-container-lowest flex items-center justify-center font-bold text-primary shadow-sm border border-outline-variant/20">
            3
          </div>
          <h5 className="font-bold font-headline">Menu Setup</h5>
          <p className="text-sm text-on-surface-variant">Log in to manage your menu, pricing, and start accepting orders.</p>
        </div>
      </div>
    </div>
  );
}
