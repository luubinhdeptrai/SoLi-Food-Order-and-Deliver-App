import React, { ReactNode, useState } from "react";
import { View, Text, TextInput, TextInputProps, TouchableOpacity } from "react-native";
import { Eye, EyeOff } from "lucide-react-native";

interface SignInFieldProps extends TextInputProps {
  label: string;
  icon: ReactNode;
  isFocused: boolean;
  isPassword?: boolean;
}

export function SignInField({
  label,
  icon,
  isFocused,
  isPassword = false,
  ...inputProps
}: SignInFieldProps) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <View className="gap-y-2">
      {!!label && (
        <Text
          className="text-[#40493d] text-sm ml-1"
          style={{ fontFamily: "PlusJakartaSans_600SemiBold" }}
        >
          {label}
        </Text>
      )}

      <View
        className="flex-row items-center rounded-xl overflow-hidden"
        style={{
          backgroundColor: isFocused ? "#ffffff" : "#e8e8e8",
          borderWidth: isFocused ? 2 : 0,
          borderColor: isFocused ? "rgba(13, 99, 27, 0.3)" : "transparent",
        }}
      >
        <View className="pl-4 pr-2">{icon}</View>
        <TextInput
          className="flex-1 py-4 pr-4 text-[#1a1c1c]"
          style={{ fontFamily: "Inter_400Regular", fontSize: 15 }}
          placeholderTextColor="#9ca3a0"
          secureTextEntry={isPassword && !isVisible}
          {...inputProps}
        />
        {isPassword && (
          <TouchableOpacity
            onPress={() => setIsVisible((v) => !v)}
            activeOpacity={0.7}
            className="pr-4"
          >
            {isVisible ? (
              <EyeOff size={20} color="#707a6c" />
            ) : (
              <Eye size={20} color="#707a6c" />
            )}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}
