import { RegisterEditorial } from '@/features/auth/components/register/RegisterEditorial';
import { RegisterForm } from '@/features/auth/components/register/RegisterForm';

export function RegisterPage() {
  return (
    <div className="bg-surface font-body text-on-surface antialiased">
      <main className="min-h-screen flex">
        {/* Content Canvas */}
        <div className="flex-1 flex items-center justify-center p-6 md:p-12 lg:p-24 bg-surface">
          <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <RegisterEditorial />
            <RegisterForm />
          </div>
        </div>
      </main>

      {/* Bottom accent bar — primary → primary-container → secondary */}
      <div className="fixed bottom-0 left-0 w-full h-1 bg-gradient-to-r from-primary via-primary-container to-secondary-container" />
    </div>
  );
}
