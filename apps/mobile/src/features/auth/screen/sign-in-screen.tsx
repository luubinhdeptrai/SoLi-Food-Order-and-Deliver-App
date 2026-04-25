import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StatusBar,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowLeft, ArrowRight, Mail, Lock, Sprout } from "lucide-react-native";
import Svg, { Path } from "react-native-svg";

import { SignInField } from "@/src/features/auth/components";
import type { SignInScreenProps } from "@/src/features/auth/types";

// ─── Google Icon ──────────────────────────────────────────────────────────────
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

// ─── Component ───────────────────────────────────────────────────────────────

export function SignInScreen({
  onBack,
  onSignIn,
  onForgotPassword,
  onGoogleSignIn,
  onSignUp,
}: SignInScreenProps) {
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [focusedField, setFocusedField] = useState<string | null>(null);

  const handleSignIn = () => {
    onSignIn?.({ email, password });
  };

  return (
    <View className="flex-1 bg-surface">
      <StatusBar
        translucent
        backgroundColor="transparent"
        barStyle="dark-content"
      />

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View
        className="flex-row items-center justify-between px-6 bg-surface"
        style={{ paddingTop: insets.top + 12, paddingBottom: 12 }}
      >
        <TouchableOpacity onPress={onBack} activeOpacity={0.7}>
          <ArrowLeft size={24} color="#1a6b20" />
        </TouchableOpacity>

        <Text
          className="text-lg text-[#1a4d20] absolute left-0 right-0 text-center"
          style={{
            fontFamily: "PlusJakartaSans_700Bold",
            top: insets.top + 16,
          }}
          pointerEvents="none"
        >
          Harvest Market
        </Text>

        {/* Symmetry spacer */}
        <View className="w-10" />
      </View>

      {/* ── Scrollable Body ───────────────────────────────────────────────── */}
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingBottom: insets.bottom + 32,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Hero / Branding */}
        <View className="items-center mb-10 mt-6">
          <View
            className="w-20 h-20 rounded-full bg-primary-fixed items-center justify-center mb-6"
            style={{
              shadowColor: "#1a1c1c",
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.08,
              shadowRadius: 8,
              elevation: 4,
            }}
          >
            <Sprout size={40} color="#0d631b" />
          </View>

          <Text
            className="text-[#1a1c1c] text-3xl font-bold text-center mb-2"
            style={{
              fontFamily: "PlusJakartaSans_800ExtraBold",
              letterSpacing: -0.5,
            }}
          >
            Welcome back!
          </Text>
          <Text
            className="text-[#40493d] text-center leading-relaxed px-4"
            style={{ fontFamily: "Inter_400Regular", fontSize: 14 }}
          >
            Log in to your local pantry
          </Text>
        </View>

        {/* ── Form Fields ──────────────────────────────────────────────────── */}
        <View className="gap-y-5">
          <SignInField
            label="Email Address"
            icon={<Mail size={20} color="#707a6c" />}
            isFocused={focusedField === "email"}
            placeholder="hello@example.com"
            value={email}
            onChangeText={setEmail}
            onFocus={() => setFocusedField("email")}
            onBlur={() => setFocusedField(null)}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />

          {/* Password with inline "Forgot Password?" */}
          <View className="gap-y-2">
            <View className="flex-row items-center justify-between ml-1 mr-1">
              <Text
                className="text-[#40493d] text-sm"
                style={{ fontFamily: "PlusJakartaSans_600SemiBold" }}
              >
                Password
              </Text>
              <TouchableOpacity onPress={onForgotPassword} activeOpacity={0.7}>
                <Text
                  className="text-[#0d631b] text-xs"
                  style={{ fontFamily: "Inter_600SemiBold" }}
                >
                  Forgot Password?
                </Text>
              </TouchableOpacity>
            </View>

            <SignInField
              label=""
              icon={<Lock size={20} color="#707a6c" />}
              isFocused={focusedField === "password"}
              placeholder="••••••••"
              value={password}
              onChangeText={setPassword}
              onFocus={() => setFocusedField("password")}
              onBlur={() => setFocusedField(null)}
              isPassword
              autoComplete="current-password"
            />
          </View>

          {/* ── Sign In CTA ──────────────────────────────────────────────── */}
          <View className="pt-2">
            <TouchableOpacity
              onPress={handleSignIn}
              activeOpacity={0.88}
              className="rounded-full overflow-hidden"
              style={{
                shadowColor: "#0d631b",
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.25,
                shadowRadius: 12,
                elevation: 6,
              }}
            >
              <LinearGradient
                colors={["#0d631b", "#2e7d32"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{
                  paddingVertical: 16,
                  paddingHorizontal: 24,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                <Text
                  className="text-white text-[15px] font-bold"
                  style={{ fontFamily: "PlusJakartaSans_700Bold" }}
                >
                  Sign In
                </Text>
                <ArrowRight size={20} color="#ffffff" />
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Divider ──────────────────────────────────────────────────────── */}
        <View className="flex-row items-center gap-x-4 my-10">
          <View className="flex-1 h-px bg-[#e2e2e2]" />
          <Text
            className="text-[#9ca3a0] tracking-widest"
            style={{ fontFamily: "Inter_700Bold", fontSize: 10 }}
          >
            OR
          </Text>
          <View className="flex-1 h-px bg-[#e2e2e2]" />
        </View>

        {/* ── Social Login ─────────────────────────────────────────────────── */}
        <View className="items-center mb-12">
          <TouchableOpacity
            onPress={onGoogleSignIn}
            activeOpacity={0.8}
            className="w-14 h-14 rounded-full bg-white items-center justify-center"
            style={{
              shadowColor: "#1a1c1c",
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.08,
              shadowRadius: 4,
              elevation: 2,
              borderWidth: 1,
              borderColor: "rgba(191, 202, 186, 0.3)",
            }}
          >
            <GoogleIcon />
          </TouchableOpacity>
        </View>

        {/* ── Footer — Sign Up link ─────────────────────────────────────────── */}
        <View className="items-center">
          <Text
            className="text-[#40493d] text-sm"
            style={{ fontFamily: "Inter_400Regular" }}
          >
            Don't have an account?
            <Text
              className="text-[#8b5000]"
              style={{ fontFamily: "PlusJakartaSans_700Bold" }}
              onPress={onSignUp}
            >
              Sign up
            </Text>
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
