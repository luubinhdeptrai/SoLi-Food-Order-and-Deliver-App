import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function RegisterBusinessFooter() {
  return (
    <footer className="fixed bottom-0 left-0 right-0 bg-surface/80 backdrop-blur-md border-t border-outline-variant/20 z-50">
      <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
        <Button
          variant="ghost"
          asChild
          className="flex items-center gap-2 px-6 py-3 h-auto font-bold text-on-surface-variant hover:text-on-surface transition-colors"
        >
          <Link to="/auth/register">
            <ArrowLeft className="w-5 h-5" />
            Back
          </Link>
        </Button>
        <Button
          type="submit"
          className="flex items-center gap-2 px-10 py-4 h-auto bg-primary text-on-primary font-bold rounded-xl shadow-lg shadow-primary/20 hover:bg-primary/90 hover:scale-[1.02] active:scale-95 transition-all"
        >
          Save & Continue
          <ArrowRight className="w-5 h-5" />
        </Button>
      </div>
    </footer>
  );
}
