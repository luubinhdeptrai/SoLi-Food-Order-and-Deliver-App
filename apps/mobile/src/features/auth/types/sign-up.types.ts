// ─── Sign Up Form Data ────────────────────────────────────────────────────────

export interface SignUpFormData {
  fullName: string;
  email: string;
  phone: string;
}

// ─── Sign Up Screen Props ─────────────────────────────────────────────────────

export interface SignUpScreenProps {
  onBack?: () => void;
  onContinue?: (data: SignUpFormData) => void;
  onLogIn?: () => void;
  onTermsPress?: () => void;
  onPrivacyPress?: () => void;
}
