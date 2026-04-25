import { Redirect } from "expo-router";

// Root index — immediately redirects to the auth flow.
// Authentication guards will redirect to (customer) once the user is signed in.
// Note: "/(auth)" cast is safe — typed routes are generated on first `expo start`.
export default function RootIndex() {
  return <Redirect href={"/(auth)" as any} />;
}
