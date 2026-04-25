import { useRouter } from "expo-router";
import { SignUpScreen } from "@/src/features/auth";
import type { SignUpFormData } from "@/src/features/auth";

export default function SignUpPage() {
  const router = useRouter();

  const handleBack = () => {
    router.back();
  };

  const handleContinue = (data: SignUpFormData) => {
    // TODO: Implement sign-up logic with better-auth
    console.log("Sign-up data:", data);
  };

  const handleLogIn = () => {
    router.back(); // Navigate back to the welcome/login screen
  };

  const handleTermsPress = () => {
    // TODO: Navigate to Terms & Conditions
    console.log("Terms & Conditions pressed");
  };

  const handlePrivacyPress = () => {
    // TODO: Navigate to Privacy Policy
    console.log("Privacy Policy pressed");
  };

  return (
    <SignUpScreen
      onBack={handleBack}
      onContinue={handleContinue}
      onLogIn={handleLogIn}
      onTermsPress={handleTermsPress}
      onPrivacyPress={handlePrivacyPress}
    />
  );
}
