import { useRouter } from "expo-router";
import { SignInScreen } from "@/src/features/auth";
import type { SignInFormData } from "@/src/features/auth";

export default function SignInPage() {
  const router = useRouter();

  const handleBack = () => {
    router.back();
  };

  const handleSignIn = (data: SignInFormData) => {
    // TODO: Implement sign-in logic with better-auth
    console.log("Sign-in data:", data);
  };

  const handleForgotPassword = () => {
    // TODO: Navigate to Forgot Password screen
    console.log("Forgot Password pressed");
  };

  const handleGoogleSignIn = () => {
    // TODO: Implement Google OAuth with better-auth
    console.log("Google Sign-In pressed");
  };

  const handleSignUp = () => {
    router.push("/(auth)/sign-up");
  };

  return (
    <SignInScreen
      onBack={handleBack}
      onSignIn={handleSignIn}
      onForgotPassword={handleForgotPassword}
      onGoogleSignIn={handleGoogleSignIn}
      onSignUp={handleSignUp}
    />
  );
}
