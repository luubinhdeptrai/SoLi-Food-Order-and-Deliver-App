import { Fingerprint, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";

export function LoginAlternativeMethods() {
  return (
    <>
      <div className="flex items-center gap-4 py-2">
        <div className="h-px flex-1 bg-surface-container" />
        <span className="text-xs font-bold text-outline uppercase tracking-widest">
          or sign in with
        </span>
        <div className="h-px flex-1 bg-surface-container" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Button
          type="button"
          variant="ghost"
          className="flex items-center justify-center gap-2 py-2 h-auto bg-surface-container-low rounded-xl font-bold text-sm text-on-surface hover:bg-surface-container transition-colors"
        >
          <Fingerprint className="text-primary w-4 h-4" strokeWidth={1.5} />
          Biometric
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="flex items-center justify-center gap-2 py-2 h-auto bg-surface-container-low rounded-xl font-bold text-sm text-on-surface hover:bg-surface-container transition-colors"
        >
          <KeyRound className="text-primary w-4 h-4" strokeWidth={1.5} />
          Key Card
        </Button>
      </div>
    </>
  );
}
