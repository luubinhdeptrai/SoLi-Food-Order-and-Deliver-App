import {
  MapPin,
  LocateFixed,
  Utensils,
  Plus,
  Minus,
  Lightbulb,
} from "lucide-react";

export function RegisterBusinessMap() {
  return (
    <div className="xl:col-span-5 xl:sticky xl:top-12">
      <div className="bg-white rounded-2xl overflow-hidden border border-slate-200 shadow-md">
        <div className="p-5 border-b border-slate-100 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-primary" />
            <span className="font-bold text-slate-800">Pinpoint Accuracy</span>
          </div>
          <button className="p-2 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-colors">
            <LocateFixed className="w-4 h-4" />
          </button>
        </div>

        <div className="relative aspect-[4/5] bg-slate-200">
          <img
            alt="Location Map"
            className="w-full h-full object-cover"
            src="https://lh3.googleusercontent.com/aida-public/AB6AXuBMZf1C7mmgAEqw4LiAPdP-ymZRcDA-7Vv7g3ArSHzGK5cryqh2vQPQr4iB66mMLblbenazyDAcg09cnnQWI8zfXde7Q3hACEURVnAF4rkxDdDaOqBJfDEkqBeVn4JjRxolJy3ne1KiithP0c2Eon6wT-akrYOtG9pk9BRX2KQ082UMxtdyHWPxGR_nhRFxX_AYYybHkXARRFwJn2_bzkqJQugohe2bPshw47NZD02dqRn1id8iJgr9gj8GqYp_W0MQPmTF5wMDh98"
          />

          {/* Map Marker */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="relative">
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-4 h-1.5 bg-black/20 blur-[2px] rounded-full"></div>
              <div className="relative bg-primary text-white p-3 rounded-2xl rounded-bl-none -rotate-45 shadow-2xl animate-bounce">
                <Utensils className="w-6 h-6 rotate-45" />
              </div>
            </div>
          </div>

          {/* Map Controls */}
          <div className="absolute bottom-6 right-6 flex flex-col gap-2">
            <button className="w-10 h-10 bg-white/80 backdrop-blur-md border border-white/20 rounded-xl flex items-center justify-center text-slate-800 shadow-xl hover:bg-white transition-colors">
              <Plus className="w-5 h-5" />
            </button>
            <button className="w-10 h-10 bg-white/80 backdrop-blur-md border border-white/20 rounded-xl flex items-center justify-center text-slate-800 shadow-xl hover:bg-white transition-colors">
              <Minus className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-6 bg-primary/5 border-t border-slate-100">
          <div className="flex gap-4">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Lightbulb className="w-4 h-4 text-primary" />
            </div>
            <p className="text-sm text-slate-700 leading-relaxed">
              <span className="font-bold">Pro Tip:</span> Drag the pin to your
              restaurant's main delivery entrance. This helps couriers find you
              faster and reduces delivery times.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
