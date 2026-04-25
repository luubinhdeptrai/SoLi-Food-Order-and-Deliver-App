import { useRouter } from "expo-router";
import { WelcomeScreen } from "@/src/features/auth";

export default function WelcomePage() {
  const router = useRouter();

  const handleGoogleSignIn = () => {
    // TODO: Implement Google OAuth with better-auth
    console.log("Google Sign-In pressed");
  };

  const handleGetStarted = () => {
    router.push("/(auth)/sign-up");
  };

  return (
    <WelcomeScreen
      onGoogleSignIn={handleGoogleSignIn}
      onGetStarted={handleGetStarted}
    />
  );
}
