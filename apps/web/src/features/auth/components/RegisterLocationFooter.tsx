import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";

export function RegisterLocationFooter() {
  return (
    <footer className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-md border-t border-slate-200 z-50">
      <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
        <Link 
          to="/auth/register"
          className="flex items-center gap-2 px-6 py-3 font-bold text-slate-600 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          Back
        </Link>
        <button className="flex items-center gap-2 px-10 py-4 bg-primary text-white font-bold rounded-xl shadow-lg shadow-primary/20 hover:bg-primary/90 hover:scale-[1.02] active:scale-95 transition-all">
          Save & Continue
          <ArrowRight className="w-5 h-5" />
        </button>
      </div>
    </footer>
  );
}
