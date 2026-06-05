// V1 KB Orders : auth invite-only — pas de signup public.
// L'onboarding restaurateur passe par KB Manager (#393, #398) qui invite l'admin
// par email, ce dernier reçoit un lien magique et atterrit directement sur /sign-in.
// Cet écran est conservé en stub (redirige vers /sign-in) pour pouvoir le réactiver
// rapidement en V2 si on ouvre un signup public.
import { Redirect } from "expo-router";

// V1 stub : le composant SignUpForm reste exporté côté lib (apps/native/src/components/blocks/sign-up-form.tsx)
// pour réactivation V2, mais n'est plus monté ici.
/*
import { SignUpForm } from "@/components/blocks/sign-up-form";
import { ScrollView, View } from "react-native";

export default function SignUpScreen() {
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerClassName="sm:flex-1 items-center justify-center p-4 py-8 sm:py-4 sm:p-6 mt-safe"
      keyboardDismissMode="interactive"
    >
      <View className="w-full max-w-sm">
        <SignUpForm />
      </View>
    </ScrollView>
  );
}
*/

export default function SignUpScreen() {
  return <Redirect href="/sign-in" />;
}
