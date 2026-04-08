import { TrendingUp, BadgeCheck } from "lucide-react";

export function RegisterEditorial() {
  return (
    <div className="hidden lg:block space-y-8">
      <div className="relative group">
        <div className="absolute -inset-4 bg-primary/5 rounded-3xl -z-10 transition-transform group-hover:scale-105" />
        <h1 className="font-headline font-extrabold text-5xl text-on-surface leading-tight tracking-tight">
          Elevate your <span className="text-primary">culinary</span>{" "}
          reach.
        </h1>
        <p className="mt-6 text-xl text-on-surface-variant leading-relaxed max-w-md">
          Join thousands of elite restaurant partners using UITfood to
          scale their delivery experience.
        </p>
      </div>

      {/* Bento Cards */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-surface-container-low p-6 rounded-xl space-y-4 ">
          <TrendingUp className="text-primary w-8 h-8" />
          <div className="font-headline font-bold text-lg text-on-surface">
            Grow Faster
          </div>
          <p className="text-sm text-on-surface-variant">
            Tap into our network of over 2 million hungry customers.
          </p>
        </div>
        <div className="bg-primary-300 p-6 rounded-xl space-y-4">
          <BadgeCheck className="text-on-primary-fixed w-8 h-8" />
          <div className="font-headline font-bold text-lg text-on-primary-fixed">
            Verified Quality
          </div>
          <p className="text-sm text-on-primary-fixed-variant">
            A platform that values artisan presentation and flavor.
          </p>
        </div>
      </div>
    </div>
  );
}
