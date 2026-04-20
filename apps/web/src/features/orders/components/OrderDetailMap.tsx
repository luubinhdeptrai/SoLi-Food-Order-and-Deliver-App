import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type OrderDetailMapProps = {
  location?: string;
  imageUrl?: string;
};

const DEFAULT_MAP_URL =
  "https://lh3.googleusercontent.com/aida-public/AB6AXuBSRB96bmkQ10LvrPV7nEALjtUBeCBMkp8rw00IDENXW8meD-PgCU1uSWXSsr1PfUPTu2hWPLFlp0leo2hem1ZKd5EVoS6rKLiLjUmHnhuxhL0Lv-0vPsHA1Go6LhZhhWGHFOJGZeuCvP1SnkMT86NthaM5H9SzqgVHS9iYqCtSJDmrgpkLbN1Fa6qACLpEz8a6YICyLv_kQt1YylrkaNOVpVXP0yexINHpcNoKhS_Udow3mp7A0huDC5cMtEDH8iCAUpsI7vK_6Mt4";

export function OrderDetailMap({ location = "Springfield, IL", imageUrl }: OrderDetailMapProps) {
  const mapSrc = imageUrl ?? DEFAULT_MAP_URL;

  return (
    <Card
      className="rounded-2xl ring-0 shadow-none bg-surface-container-lowest overflow-hidden h-64 relative group gap-0 py-0"
      aria-label={`Delivery map for ${location}`}
    >
      <img
        src={mapSrc}
        alt={`Map view of ${location}`}
        className="w-full h-full object-cover grayscale brightness-90 contrast-125"
      />

      {/* Gradient overlay */}
      <div
        className="absolute inset-0 bg-gradient-to-t from-stone-900/60 to-transparent"
        aria-hidden="true"
      />

      {/* Bottom bar */}
      <CardContent className="absolute bottom-0 left-0 right-0 p-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-white">
          <span className="material-symbols-outlined text-sm" aria-hidden="true">
            location_on
          </span>
          <span className="text-xs font-bold uppercase tracking-widest font-body">
            Live Delivery Tracking
          </span>
        </div>

        {/* shadcn Button ghost-style glassmorphism */}
        <Button
          variant="ghost"
          size="sm"
          className="bg-white/20 backdrop-blur-md text-white text-[10px] font-bold px-3 py-1 h-auto rounded-full border border-white/30 hover:bg-white/30 hover:text-white"
        >
          Expand Map
        </Button>
      </CardContent>
    </Card>
  );
}
