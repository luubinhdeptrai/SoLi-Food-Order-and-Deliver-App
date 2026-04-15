import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ShoppingBag, Circle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface StoreVisibilityCardProps {
  initiallyOpen?: boolean;
}

export function StoreVisibilityCard({
  initiallyOpen = true,
}: StoreVisibilityCardProps) {
  const [isOpen, setIsOpen] = useState(initiallyOpen);

  return (
    <Card
      className="rounded-2xl py-0 gap-0 ring-0 transition-all duration-300"
      style={{
        background: isOpen
          ? "linear-gradient(135deg, #0d631b 0%, #2e7d32 100%)"
          : "var(--surface-container)",
      }}
    >
      <CardContent className="px-5 py-4 flex items-center justify-between">
        {/* Left: icon + text */}
        <div className="flex items-center gap-4">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-full shrink-0"
            style={{
              background: isOpen
                ? "rgba(255,255,255,0.15)"
                : "var(--surface-container-high)",
            }}
          >
            <ShoppingBag
              className="h-5 w-5"
              style={{
                color: isOpen ? "#ffffff" : "var(--on-surface-variant)",
              }}
            />
          </div>
          <div>
            <p
              className="text-sm font-semibold leading-tight"
              style={{ color: isOpen ? "#ffffff" : "var(--on-surface)" }}
            >
              Store Visibility
            </p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <Circle
                className="h-2 w-2"
                style={{
                  fill: isOpen ? "#a3f69c" : "#bfcaba",
                  color: isOpen ? "#a3f69c" : "#bfcaba",
                }}
              />
              <span
                className="text-xs font-medium"
                style={{
                  color: isOpen
                    ? "rgba(255,255,255,0.8)"
                    : "var(--on-surface-variant)",
                }}
              >
                {isOpen ? "Currently Accepting Orders" : "Store Closed"}
              </span>
            </div>
          </div>
        </div>

        {/* Right: toggle */}
        <div className="flex items-center gap-2">
          <Label
            htmlFor="store-visibility-toggle"
            className="text-xs font-medium cursor-pointer"
            style={{
              color: isOpen
                ? "rgba(255,255,255,0.7)"
                : "var(--on-surface-variant)",
            }}
          >
            {isOpen ? "Open" : "Closed"}
          </Label>
          <Switch
            id="store-visibility-toggle"
            checked={isOpen}
            onCheckedChange={setIsOpen}
            className="data-[state=checked]:bg-white/30 data-[state=unchecked]:bg-surface-container-high"
          />
        </div>
      </CardContent>
    </Card>
  );
}
