export function RegisterPendingAlerts() {
  return (
    <div className="bg-primary-container text-on-primary-container rounded-xl p-8 flex flex-col items-center text-center justify-center gap-6 shadow-xl relative overflow-hidden">
      {/* Abstract glow */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-transparent pointer-events-none"></div>

      <div className="relative">
        <span
          className="material-symbols-outlined text-white"
          style={{ fontSize: "3rem", fontVariationSettings: "'FILL' 1" }}
        >
          notifications_active
        </span>
        <div className="absolute -top-1 -right-0.5 w-4 h-4 bg-secondary rounded-full border-2 border-primary-container"></div>
      </div>

      <div className="text-white">
        <h4 className="text-lg font-bold mb-2 font-headline">Enable Alerts</h4>
        <p className="text-sm opacity-90 font-medium">
          We'll send a push notification (FCM/APNs) as soon as you're approved.
        </p>
      </div>
    </div>
  );
}
