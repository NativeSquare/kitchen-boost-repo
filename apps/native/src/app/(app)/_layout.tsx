import { Stack } from "expo-router";
import { View } from "react-native";

export default function AppLayout() {
  return (
    <View className="flex-1 bg-background">
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: "transparent" },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
    </View>
  );
}
