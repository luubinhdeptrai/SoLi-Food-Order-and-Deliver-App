import { useRouter } from "expo-router";
import { WelcomeScreen } from "@/src/features/auth";

export default function WelcomePage() {
  const router = useRouter();

  const handleGetStarted = () => {
    router.push("/(auth)/sign-up");
  };

  const handleSignIn = () => {
    router.push("/(auth)/sign-in");
  };

  const handleGoogleSignIn = () => {
    // TODO: Implement Google OAuth with better-auth
    console.log("Google Sign-In pressed");
  };

  return (
    <WelcomeScreen
      onGetStarted={handleGetStarted}
      onSignIn={handleSignIn}
      onGoogleSignIn={handleGoogleSignIn}
    />
  );
}
