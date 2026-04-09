import {
  MapPin,
  LocateFixed,
  Utensils,
  Plus,
  Minus,
  Lightbulb,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export function RegisterBusinessMap() {
  return (
    <div className="xl:col-span-5 xl:sticky xl:top-12">
      <div className="bg-surface-container-lowest rounded-2xl overflow-hidden border border-outline-variant/20 shadow-md">
        <div className="p-5 border-b border-outline-variant/10 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-primary" />
            <span className="font-bold text-on-surface">Pinpoint Accuracy</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="p-2 bg-surface-container text-on-surface-variant rounded-lg hover:bg-surface-container-high transition-colors"
          >
            <LocateFixed className="w-4 h-4" />
          </Button>
        </div>

        <div className="relative aspect-[4/5] bg-surface-container">
          <img
            alt="Location Map"
            className="w-full h-full object-cover"
            src="https://lh3.googleusercontent.com/aida-public/AB6AXuBMZf1C7mmgAEqw4LiAPdP-ymZRcDA-7Vv7g3ArSHzGK5cryqh2vQPQr4iB66mMLblbenazyDAcg09cnnQWI8zfXde7Q3hACEURVnAF4rkxDdDaOqBJfDEkqBeVn4JjRxolJy3ne1KiithP0c2Eon6wT-akrYOtG9pk9BRX2KQ082UMxtdyHWPxGR_nhRFxX_AYYybHkXARRFwJn2_bzkqJQugohe2bPshw47NZD02dqRn1id8iJgr9gj8GqYp_W0MQPmTF5wMDh98"
          />

          {/* Map Marker */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="relative">
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-4 h-1.5 bg-black/20 blur-[2px] rounded-full" />
              <div className="relative bg-primary text-on-primary p-3 rounded-2xl rounded-bl-none -rotate-45 shadow-2xl animate-bounce">
                <Utensils className="w-6 h-6 rotate-45" />
              </div>
            </div>
          </div>

          {/* Map Controls */}
          <div className="absolute bottom-6 right-6 flex flex-col gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="w-10 h-10 bg-surface-container-lowest/80 backdrop-blur-md border border-outline-variant/20 rounded-xl text-on-surface shadow-xl hover:bg-surface-container-lowest transition-colors"
            >
              <Plus className="w-5 h-5" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="w-10 h-10 bg-surface-container-lowest/80 backdrop-blur-md border border-outline-variant/20 rounded-xl text-on-surface shadow-xl hover:bg-surface-container-lowest transition-colors"
            >
              <Minus className="w-5 h-5" />
            </Button>
          </div>
        </div>

        <div className="p-6 bg-primary/5 border-t border-outline-variant/10">
          <div className="flex gap-4">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Lightbulb className="w-4 h-4 text-primary" />
            </div>
            <p className="text-sm text-on-surface-variant leading-relaxed">
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
