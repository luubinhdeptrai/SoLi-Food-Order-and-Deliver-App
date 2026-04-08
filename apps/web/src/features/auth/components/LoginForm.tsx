import { Mail, Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";

export function LoginForm() {
  return (
    <form className="space-y-4">
      <div className="space-y-2">
        <Label
          htmlFor="loginEmail"
          className="font-label text-sm font-bold text-on-surface ml-1"
        >
          Work Email
        </Label>
        <div className="relative">
          <Mail
            className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant w-5 h-5 pointer-events-none z-10"
            strokeWidth={1.5}
          />
          <Input
            id="loginEmail"
            type="email"
            placeholder="staff@atelierkitchen.com"
            className="w-full pl-12 pr-4 py-3 bg-surface-container-high border-none rounded-xl focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:bg-surface-container-lowest transition-all placeholder:text-outline text-sm"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label
          htmlFor="loginPassword"
          className="font-label text-sm font-bold text-on-surface ml-1"
        >
          Password
        </Label>
        <div className="relative">
          <Lock
            className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant w-5 h-5 pointer-events-none z-10"
            strokeWidth={1.5}
          />
          <Input
            id="loginPassword"
            type="password"
            placeholder="••••••••"
            className="w-full pl-12 pr-4 py-3 bg-surface-container-high border-none rounded-xl focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:bg-surface-container-lowest transition-all placeholder:text-outline text-sm"
          />
        </div>
      </div>

      <div className="flex items-center justify-between py-2">
        <Label
          htmlFor="rememberDevice"
          className="flex items-center gap-2 cursor-pointer"
        >
          <Checkbox id="rememberDevice" />
          <span className="text-sm font-medium text-on-surface-variant">
            Remember device
          </span>
        </Label>
        <a
          href="#"
          className="text-sm font-bold text-primary hover:text-primary-container transition-colors"
        >
          Forgot Access?
        </a>
      </div>

      <Button
        type="button"
        className="w-full py-3 h-auto bg-primary-600 font-headline font-bold text-base rounded-full shadow-lg shadow-primary/20 hover:-translate-y-[1px] hover:brightness-105 active:scale-[0.98] transition-all cursor-pointer text-white"
      >
        Authorize Access
      </Button>
    </form>
  );
}
