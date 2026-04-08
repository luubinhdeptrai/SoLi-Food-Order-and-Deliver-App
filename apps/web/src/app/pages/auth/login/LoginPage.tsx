import { LoginForm } from "@/features/auth/components/LoginForm";
import { LoginAlternativeMethods } from "@/features/auth/components/LoginAlternativeMethods";
import { LoginFooter } from "@/features/auth/components/LoginFooter";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export function LoginPage() {
  return (
    <main className="pb-20 px-6 max-w-7xl mx-auto flex flex-col items-center justify-center min-h-screen">
      <Card className="p-4 space-y-4">
        <div className="text-center space-y-2">
          <CardHeader className="font-headline text-2xl font-extrabold text-on-surface">
            Login
          </CardHeader>
          <CardDescription className="font-body text-sm text-on-surface-variant">
            Please authenticate to continue to your workspace.
          </CardDescription>
        </div>
        <CardContent className="space-y-4">
          <LoginForm />
          <LoginAlternativeMethods />
        </CardContent>

        <LoginFooter />
      </Card>
    </main>
  );
}
