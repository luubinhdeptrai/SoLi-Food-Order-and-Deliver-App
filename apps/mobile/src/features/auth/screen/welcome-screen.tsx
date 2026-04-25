import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StatusBar,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import Svg, { Path } from "react-native-svg";

// ─── Google Icon ─────────────────────────────────────────────────────────────
const GoogleIcon = () => (
  <Svg width={20} height={20} viewBox="0 0 48 48">
    <Path
      fill="#FFC107"
      d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
    />
    <Path
      fill="#FF3D00"
      d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
    />
    <Path
      fill="#4CAF50"
      d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
    />
    <Path
      fill="#1976D2"
      d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
    />
  </Svg>
);

// ─── Types ────────────────────────────────────────────────────────────────────
export interface WelcomeScreenProps {
  onGoogleSignIn?: () => void;
  onGetStarted?: () => void;
  onTermsPress?: () => void;
  onPrivacyPress?: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────
export function WelcomeScreen({
  onGoogleSignIn,
  onGetStarted,
  onTermsPress,
  onPrivacyPress,
}: WelcomeScreenProps) {
  const insets = useSafeAreaInsets();

  return (
    <View className="flex-1 bg-[#0d631b]">
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />

      {/* ── Hero Image ──────────────────────────────────────────────────── */}
      <View className="flex-1">
        <Image
          source={require("../../../../assets/images/welcome-hero.png")}
          style={{ flex: 1, width: "100%" }}
          contentFit="cover"
        />

        {/* Gradient overlay — fades hero into the green bottom section */}
        <LinearGradient
          colors={[
            "transparent",
            "rgba(13, 99, 27, 0.20)",
            "rgba(13, 99, 27, 0.72)",
            "#0d631b",
          ]}
          locations={[0, 0.3, 0.62, 1]}
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: "75%",
          }}
        />

        {/* Tagline text overlaid on the hero */}
        <View className="absolute bottom-8 left-6 right-6">
          <Text
            className="text-white/90 text-sm font-medium text-center tracking-wide"
            style={{ fontFamily: "Inter_500Medium" }}
          >
            Fresh · Local · Delivered Fast
          </Text>
        </View>
      </View>

      {/* ── Bottom Sheet ────────────────────────────────────────────────── */}
      <View
        className="bg-white rounded-t-[28px]"
        style={{
          paddingBottom: insets.bottom + 20,
          shadowColor: "#1a1c1c",
          shadowOffset: { width: 0, height: -6 },
          shadowOpacity: 0.07,
          shadowRadius: 24,
          elevation: 14,
        }}
      >
        {/* Drag handle */}
        <View className="items-center pt-3 pb-1">
          <View className="w-10 h-1 rounded-full bg-[#e2e2e2]" />
        </View>

        {/* App badge pill */}
        <View className="items-center pt-4 pb-1">
          <View className="flex-row items-center gap-x-1.5 bg-[#a3f69c] rounded-full px-4 py-1.5">
            <View className="w-2 h-2 rounded-full bg-[#0d631b]" />
            <Text
              className="text-[#0d631b] text-xs font-semibold tracking-widest uppercase"
              style={{ fontFamily: "Inter_600SemiBold" }}
            >
              UIT Food
            </Text>
          </View>
        </View>

        {/* Headline */}
        <View className="px-6 pt-4 pb-3">
          <Text
            className="text-[#1a1c1c] text-[1.9rem] leading-tight font-bold text-center"
            style={{ fontFamily: "PlusJakartaSans_700Bold" }}
          >
            Fresh from our fields{"\n"}to your home.
          </Text>
        </View>

        {/* Subtitle */}
        <View className="px-10 pb-7">
          <Text
            className="text-[#40493d] text-sm text-center leading-relaxed"
            style={{ fontFamily: "Inter_400Regular" }}
          >
            Discover the finest local harvest at your fingertips. Premium quality, fast delivery.
          </Text>
        </View>

        {/* Google Sign-In Button */}
        <View className="px-6 pb-3">
          <TouchableOpacity
            onPress={onGoogleSignIn}
            activeOpacity={0.8}
            className="flex-row items-center justify-center bg-white rounded-full py-[15px] gap-x-3"
            style={{
              borderWidth: 1.5,
              borderColor: "rgba(191, 202, 186, 0.8)",
              shadowColor: "#1a1c1c",
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.06,
              shadowRadius: 8,
              elevation: 3,
            }}
          >
            <GoogleIcon />
            <Text
              className="text-[#1a1c1c] text-[15px] font-semibold"
              style={{ fontFamily: "PlusJakartaSans_600SemiBold" }}
            >
              Continue with Google
            </Text>
          </TouchableOpacity>
        </View>

        {/* Divider */}
        <View className="flex-row items-center px-6 py-3 gap-x-3">
          <View className="flex-1 h-px bg-[#eeeeee]" />
          <Text
            className="text-[#707a6c] text-xs"
            style={{ fontFamily: "Inter_400Regular" }}
          >
            or
          </Text>
          <View className="flex-1 h-px bg-[#eeeeee]" />
        </View>

        {/* Primary CTA — Get Started */}
        <View className="px-6 pb-5">
          <TouchableOpacity
            onPress={onGetStarted}
            activeOpacity={0.88}
            className="rounded-full overflow-hidden"
          >
            <LinearGradient
              colors={["#0d631b", "#2e7d32"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{ paddingVertical: 16, alignItems: "center" }}
            >
              <Text
                className="text-white text-[15px] font-bold tracking-wide"
                style={{ fontFamily: "PlusJakartaSans_700Bold" }}
              >
                Get Started
              </Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>

        {/* Terms & Privacy */}
        <View className="px-8">
          <Text
            className="text-[#707a6c] text-[11px] text-center leading-relaxed"
            style={{ fontFamily: "Inter_400Regular" }}
          >
            By continuing, you agree to UIT Food's{" "}
            <Text
              className="text-[#0d631b] font-medium underline"
              style={{ fontFamily: "Inter_500Medium" }}
              onPress={onTermsPress}
            >
              Terms of Service
            </Text>
            {" "}and{" "}
            <Text
              className="text-[#0d631b] font-medium underline"
              style={{ fontFamily: "Inter_500Medium" }}
              onPress={onPrivacyPress}
            >
              Privacy Policy
            </Text>
          </Text>
        </View>
      </View>
    </View>
  );
}
