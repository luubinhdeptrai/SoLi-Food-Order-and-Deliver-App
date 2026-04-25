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
import {
  ArrowLeft,
  User,
  Mail,
  Phone,
  ChevronRight,
  Check,
  Sprout,
} from "lucide-react-native";

import { SignUpField } from "@/src/features/auth/components";
import type { SignUpScreenProps } from "@/src/features/auth/types";

// ─── Component ───────────────────────────────────────────────────────────────

export function SignUpScreen({
  onBack,
  onContinue,
  onLogIn,
  onTermsPress,
  onPrivacyPress,
}: SignUpScreenProps) {
  const insets = useSafeAreaInsets();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);

  const handleContinue = () => {
    onContinue?.({ fullName, email, phone });
  };

  return (
    <View className="flex-1 bg-surface">
      <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />


      {/* ── Header ───────────────────────────────────────────────────── */}
      <View
        className="flex-row items-center justify-between px-6 bg-surface"
        style={{ paddingTop: insets.top + 12, paddingBottom: 12 }}
      >
        <TouchableOpacity onPress={onBack} activeOpacity={0.7}>
          <ArrowLeft size={24} color="#1a6b20" />
        </TouchableOpacity>

        <Text
          className="text-lg text-[#1a4d20] absolute left-0 right-0 text-center"
          style={{ fontFamily: "PlusJakartaSans_700Bold", top: insets.top + 16 }}
          pointerEvents="none"
        >
          Harvest Market
        </Text>

        {/* Symmetry spacer */}
        <View className="w-10" />
      </View>

      {/* ── Scrollable Body ──────────────────────────────────────────── */}
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
            className="w-20 h-20 rounded-2xl bg-primary-fixed items-center justify-center mb-6"
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
            style={{ fontFamily: "PlusJakartaSans_700Bold", letterSpacing: -0.5 }}
          >
            Create your account
          </Text>
          <Text
            className="text-[#40493d] text-center leading-relaxed px-4"
            style={{ fontFamily: "Inter_400Regular", fontSize: 14 }}
          >
            Join our community of fresh produce lovers and local growers.
          </Text>
        </View>

        {/* Form Fields */}
        <View className="gap-y-5">
          <SignUpField
            label="Full Name"
            icon={<User size={20} color="#707a6c" />}
            isFocused={focusedField === "name"}
            placeholder="Enter your full name"
            value={fullName}
            onChangeText={setFullName}
            onFocus={() => setFocusedField("name")}
            onBlur={() => setFocusedField(null)}
            autoCapitalize="words"
            autoComplete="name"
          />

          <SignUpField
            label="Email Address"
            icon={<Mail size={20} color="#707a6c" />}
            isFocused={focusedField === "email"}
            placeholder="name@example.com"
            value={email}
            onChangeText={setEmail}
            onFocus={() => setFocusedField("email")}
            onBlur={() => setFocusedField(null)}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />

          <SignUpField
            label="Phone Number"
            icon={<Phone size={20} color="#707a6c" />}
            isFocused={focusedField === "phone"}
            placeholder="+1 (555) 000-0000"
            value={phone}
            onChangeText={setPhone}
            onFocus={() => setFocusedField("phone")}
            onBlur={() => setFocusedField(null)}
            keyboardType="phone-pad"
            autoComplete="tel"
          />

          {/* Terms & Conditions */}
          <View className="flex-row items-start gap-x-3 px-1 py-2">
            <TouchableOpacity
              onPress={() => setTermsAccepted((v) => !v)}
              activeOpacity={0.8}
              className="mt-0.5"
            >
              <View
                className="w-5 h-5 rounded items-center justify-center"
                style={{
                  backgroundColor: termsAccepted ? "#0d631b" : "#e8e8e8",
                  borderWidth: termsAccepted ? 0 : 1.5,
                  borderColor: "#bfcaba",
                }}
              >
                {termsAccepted && <Check size={12} color="#ffffff" strokeWidth={3} />}
              </View>
            </TouchableOpacity>

            <Text
              className="flex-1 text-[#40493d] leading-relaxed"
              style={{ fontFamily: "Inter_400Regular", fontSize: 13 }}
            >
              I agree to the{" "}
              <Text
                className="text-[#0d631b] underline"
                style={{ fontFamily: "Inter_600SemiBold" }}
                onPress={onTermsPress}
              >
                Terms & Conditions
              </Text>
              {" "}and{" "}
              <Text
                className="text-[#0d631b] underline"
                style={{ fontFamily: "Inter_600SemiBold" }}
                onPress={onPrivacyPress}
              >
                Privacy Policy
              </Text>
              {" "}of Harvest Market.
            </Text>
          </View>

          {/* Continue CTA */}
          <View className="pt-2">
            <TouchableOpacity
              onPress={handleContinue}
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
                  Continue
                </Text>
                <ChevronRight size={20} color="#ffffff" />
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>

        {/* Footer — Log in link */}
        <View className="mt-8 items-center">
          <Text
            className="text-[#40493d] text-sm"
            style={{ fontFamily: "Inter_400Regular" }}
          >
            Already have an account?{" "}
            <Text
              className="text-[#0d631b]"
              style={{ fontFamily: "PlusJakartaSans_700Bold" }}
              onPress={onLogIn}
            >
              Log in
            </Text>
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
