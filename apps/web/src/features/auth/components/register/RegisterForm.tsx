import { useState } from 'react';
import { Eye, EyeOff, ArrowRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

export function RegisterForm() {
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = (e: React.SubmitEvent) => {
    e.preventDefault();
    navigate('/auth/register/business', { state: { step1Completed: true } });
  };

  return (
    <div className="bg-surface-container-lowest rounded-xl p-8 md:p-10 shadow-sm border border-outline-variant/10">
      <div className="mb-10 text-center lg:text-left">
        <h2 className="font-headline font-bold text-3xl text-on-surface">
          Create Account
        </h2>
        <p className="text-on-surface-variant mt-2">
          Start your journey as a UITfood Partner
        </p>
      </div>

      <form className="space-y-6" onSubmit={handleSubmit}>
        {/* Email */}
        <div className="space-y-2">
          <Label
            htmlFor="emailInput"
            className="font-label font-semibold text-xs text-on-surface-variant uppercase tracking-wider ml-1"
          >
            Email Address
          </Label>
          <Input
            id="emailInput"
            type="email"
            placeholder="chef@restaurant.com"
            className="w-full h-14 px-4 bg-surface-container-high border-0 rounded-lg focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:bg-surface-container-lowest transition-all placeholder:text-stone-400"
            required
          />
        </div>

        {/* Phone */}
        <div className="space-y-2">
          <Label
            htmlFor="phoneInput"
            className="font-label font-semibold text-xs text-on-surface-variant uppercase tracking-wider ml-1"
          >
            Phone Number
          </Label>
          <Input
            id="phoneInput"
            type="tel"
            placeholder="+1 (555) 000-0000"
            className="w-full h-14 px-4 bg-surface-container-high border-0 rounded-lg focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:bg-surface-container-lowest transition-all placeholder:text-stone-400"
            required
          />
        </div>

        {/* Password */}
        <div className="space-y-2">
          <Label
            htmlFor="passwordInput"
            className="font-label font-semibold text-xs text-on-surface-variant uppercase tracking-wider ml-1"
          >
            Password
          </Label>
          <div className="relative">
            <Input
              id="passwordInput"
              type={showPassword ? 'text' : 'password'}
              placeholder="••••••••"
              className="w-full h-14 px-4 pr-12 bg-surface-container-high border-0 rounded-lg focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:bg-surface-container-lowest transition-all placeholder:text-stone-400"
              required
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-primary hover:bg-transparent transition-colors"
            >
              {showPassword ? (
                <EyeOff className="w-5 h-5" />
              ) : (
                <Eye className="w-5 h-5" />
              )}
            </Button>
          </div>
        </div>

        {/* Submit CTA */}
        <div className="pt-4">
          <Button
            type="submit"
            className="editorial-gradient w-full h-14 rounded-full text-white font-headline font-bold text-lg shadow-lg hover:opacity-90 active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            Create Account
            <ArrowRight className="w-5 h-5" />
          </Button>
        </div>
      </form>

      {/* Divider */}
      <div className="relative my-10">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-surface-container-high" />
        </div>
        <div className="relative flex justify-center text-xs uppercase tracking-widest font-bold">
          <span className="px-4 bg-surface-container-lowest text-on-surface-variant">
            Or continue with
          </span>
        </div>
      </div>

      {/* OAuth Buttons */}
      <div className="grid grid-cols-2 gap-4">
        {/* Google */}
        <Button
          type="button"
          variant="outline"
          className="h-14 flex items-center justify-center gap-3 border border-outline-variant/30 rounded-full hover:bg-stone-50 active:scale-95 transition-all"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
          <span className="font-semibold text-sm">Google</span>
        </Button>

        {/* Apple */}
        <Button
          type="button"
          variant="outline"
          className="h-14 flex items-center justify-center gap-3 border border-outline-variant/30 rounded-full hover:bg-stone-50 active:scale-95 transition-all"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M17.05 20.28c-.96.95-2.18 1.78-3.66 1.78-1.5 0-2.35-.91-3.74-.91-1.38 0-2.26.89-3.72.89-1.46 0-2.68-.82-3.64-1.76C.32 17.34-1.19 13.78.78 10.46c.96-1.67 2.64-2.65 4.43-2.7 1.46-.04 2.84.93 3.74.93.9 0 2.59-1.16 4.36-.98.74.03 2.82.3 4.16 2.27-3.63 2.17-3.04 7.82.58 9.3zm-3.1-17.1c-.87 1.04-2.27 1.84-3.64 1.73-.19-1.38.5-2.82 1.3-3.72.9-1.03 2.37-1.81 3.6-1.86.16 1.42-.41 2.83-1.26 3.85z" />
          </svg>
          <span className="font-semibold text-sm">Apple</span>
        </Button>
      </div>

      {/* Sign-in link */}
      <div className="mt-8 text-center">
        <p className="text-sm text-on-surface-variant">
          Already have an account?{' '}
          <a href="#" className="text-primary font-bold hover:underline ml-1">
            Sign In
          </a>
        </p>
      </div>
    </div>
  );
}
