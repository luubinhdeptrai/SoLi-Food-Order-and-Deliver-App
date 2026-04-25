import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StatusBar,
  ScrollView,
  Dimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import Svg, { Path } from "react-native-svg";
import {
  Truck,
  Leaf,
  ShieldCheck,
  ArrowRight,
  Sprout,
} from "lucide-react-native";

// ─── Google Icon ─────────────────────────────────────────────────────────────
const GoogleIcon = () => (
  <Svg width={20} height={20} viewBox="0 0 24 24">
    <Path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      fill="#4285F4"
    />
    <Path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <Path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
      fill="#FBBC05"
    />
    <Path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      fill="#EA4335"
    />
  </Svg>
);

// ─── Types ────────────────────────────────────────────────────────────────────
export interface WelcomeScreenProps {
  onGetStarted?: () => void;
  onSignIn?: () => void;
  onGoogleSignIn?: () => void;
  onTermsPress?: () => void;
  onPrivacyPress?: () => void;
}

// ─── Feature Badge ────────────────────────────────────────────────────────────
type FeatureBadgeProps = {
  icon: React.ReactNode;
  label: string;
};

function FeatureBadge({ icon, label }: FeatureBadgeProps) {
  return (
    <View className="items-center gap-y-1.5">
      <View className="w-10 h-10 rounded-full bg-[#a3f69c] items-center justify-center">
        {icon}
      </View>
      <Text
        className="text-[#707a6c] text-center uppercase tracking-wider"
        style={{ fontFamily: "Inter_700Bold", fontSize: 8 }}
      >
        {label}
      </Text>
    </View>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────
export function WelcomeScreen({
  onGetStarted,
  onSignIn,
  onGoogleSignIn,
  onTermsPress,
  onPrivacyPress,
}: WelcomeScreenProps) {
  const insets = useSafeAreaInsets();
  const screenHeight = Dimensions.get("window").height;
  const heroHeight = screenHeight * 0.45;

  return (
    <View className="flex-1 bg-[#f9f9f9] items-center">
      <StatusBar
        translucent
        backgroundColor="transparent"
        barStyle="dark-content"
      />

      <View className="w-full max-w-md flex-1 bg-[#f9f9f9] overflow-hidden">
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* ── Hero Section ──────────────────────────────────────────────── */}
          <View
            style={{ height: heroHeight }}
            className="relative w-full overflow-hidden"
          >
            <Image
              source={require("../../../../assets/images/welcome-hero.png")}
              style={{ width: "100%", height: "100%" }}
              contentFit="cover"
            />

            {/* Gradient fade to background color */}
            <LinearGradient
              colors={[
                "rgba(249, 249, 249, 0)",
                "rgba(249, 249, 249, 0.9)",
                "rgba(249, 249, 249, 1)",
              ]}
              locations={[0, 0.6, 1]}
              style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                right: 0,
                height: "100%",
              }}
            />

            {/* Floating logo pill */}
            <View
              className="absolute left-0 right-0 items-center"
              style={{ top: insets.top + 24 }}
            >
              <View
                className="flex-row items-center gap-x-2 px-5 py-2 rounded-full"
                style={{
                  backgroundColor: "rgba(255, 255, 255, 0.8)",
                  backdropFilter: "blur(12px)",
                  shadowColor: "#1a1c1c",
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.06,
                  shadowRadius: 8,
                  elevation: 3,
                }}
              >
                <Sprout size={20} color="#00490e" />
                <Text
                  className="text-[#00490e] text-lg tracking-tight"
                  style={{ fontFamily: "PlusJakartaSans_800ExtraBold" }}
                >
                  Harvest Market
                </Text>
              </View>
            </View>
          </View>

          {/* ── Content Section ───────────────────────────────────────────── */}
          <View
            className="flex-1 px-6 z-10 text-center items-center"
            style={{ marginTop: -64 }}
          >
            {/* Headline + Subtitle */}
            <View className="mb-6 items-center" style={{ gap: 10 }}>
              <Text
                className="text-[#1a1c1c] text-3xl text-center leading-tight tracking-tight"
                style={{ fontFamily: "PlusJakartaSans_800ExtraBold" }}
              >
                Fresh from our fields{"\n"}to your home.
              </Text>
              <Text
                className="text-[#40493d] text-base text-center leading-relaxed px-2"
                style={{ fontFamily: "Inter_400Regular" }}
              >
                Discover the finest local harvest at your fingertips.
              </Text>
            </View>

            {/* ── Buttons ───────────────────────────────────────────────── */}
            <View className="w-full" style={{ gap: 10 }}>
              {/* Get Started */}
              <TouchableOpacity
                onPress={onGetStarted}
                activeOpacity={0.88}
                className="w-full rounded-full overflow-hidden flex-row items-center justify-center"
                style={{
                  shadowColor: "#0d631b",
                  shadowOffset: { width: 0, height: 10 },
                  shadowOpacity: 0.3,
                  shadowRadius: 25,
                  elevation: 8,
                }}
              >
                <LinearGradient
                  colors={["#00490e", "#0d631b"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={{
                    width: "100%",
                    paddingVertical: 16,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                  }}
                >
                  <Text
                    className="text-white text-base"
                    style={{ fontFamily: "PlusJakartaSans_700Bold" }}
                  >
                    Get Started
                  </Text>
                  <ArrowRight size={18} color="#ffffff" />
                </LinearGradient>
              </TouchableOpacity>

              {/* Sign In */}
              <TouchableOpacity
                onPress={onSignIn}
                activeOpacity={0.8}
                className="w-full rounded-full py-4 items-center justify-center bg-[#ffffff]"
                style={{
                  borderWidth: 2,
                  borderColor: "rgba(0, 73, 14, 0.05)",
                }}
              >
                <Text
                  className="text-[#00490e] text-base"
                  style={{ fontFamily: "PlusJakartaSans_700Bold" }}
                >
                  Sign In
                </Text>
              </TouchableOpacity>

              {/* Continue with Google */}
              <TouchableOpacity
                onPress={onGoogleSignIn}
                activeOpacity={0.8}
                className="w-full rounded-full flex-row items-center justify-center bg-white"
                style={{
                  paddingVertical: 14,
                  gap: 12,
                  borderWidth: 1,
                  borderColor: "rgba(191, 202, 186, 0.5)",
                }}
              >
                <GoogleIcon />
                <Text
                  className="text-[#1a1c1c] text-base"
                  style={{ fontFamily: "PlusJakartaSans_700Bold" }}
                >
                  Continue with Google
                </Text>
              </TouchableOpacity>
            </View>

            {/* ── Feature Badges ────────────────────────────────────────── */}
            <View
              className="w-full flex-row items-center justify-center mt-6 mb-4"
              style={{ gap: 16 }}
            >
              <FeatureBadge
                icon={<Truck size={20} color="#005312" />}
                label="Fast Delivery"
              />

              {/* Divider */}
              <View
                className="w-px h-6 bg-[#bfcaba]"
                style={{ opacity: 0.3 }}
              />

              <FeatureBadge
                icon={<Leaf size={20} color="#005312" />}
                label="100% Organic"
              />

              {/* Divider */}
              <View
                className="w-px h-6 bg-[#bfcaba]"
                style={{ opacity: 0.3 }}
              />

              <FeatureBadge
                icon={<ShieldCheck size={20} color="#005312" />}
                label="Farm Verified"
              />
            </View>
          </View>

          {/* ── Terms Footer ──────────────────────────────────────────────── */}
          <View
            className="items-center px-6"
            style={{ paddingBottom: insets.bottom + 16 }}
          >
            <Text
              className="text-[#707a6c] text-center leading-tight"
              style={{
                fontFamily: "Inter_400Regular",
                fontSize: 10,
                maxWidth: 240,
              }}
            >
              By continuing, you agree to Harvest Market's
              <Text
                className="text-[#0d631b]"
                style={{ fontFamily: "Inter_500Medium" }}
                onPress={onTermsPress}
              >
                Terms of Service
              </Text>{" "}
              and{" "}
              <Text
                className="text-[#0d631b]"
                style={{ fontFamily: "Inter_500Medium" }}
                onPress={onPrivacyPress}
              >
                Privacy Policy
              </Text>
              .
            </Text>
          </View>
        </ScrollView>
      </View>
    </View>
  );
}
