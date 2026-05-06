export function RegisterPendingHeader() {
  return (
    <div className="bg-surface-container-lowest rounded-xl p-8 text-center flex flex-col items-center gap-4 relative overflow-hidden">
      {/* Subtle organic background pattern */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-primary-fixed/20 rounded-full blur-3xl -mr-16 -mt-16"></div>

      <div className="w-20 h-20 bg-primary-fixed rounded-full flex items-center justify-center text-primary mb-2 shadow-lg shadow-primary/10">
        <span
          className="material-symbols-outlined text-4xl"
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          task_alt
        </span>
      </div>

      <h1 className="text-3xl font-extrabold text-on-surface tracking-tight font-headline">
        Registration Submitted
      </h1>

      <p className="text-lg text-on-surface-variant max-w-xl leading-relaxed">
        Your application is now being reviewed by our administrative team. We
        maintain high quality standards to ensure the best experience for our
        community.
      </p>
    </div>
  );
}
