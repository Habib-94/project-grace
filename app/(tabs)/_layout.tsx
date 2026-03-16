import { useAuth } from '@/context/AuthContext';
import { Ionicons } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

export default function TabsLayout() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!user) {
    return <Redirect href="/(auth)/LoginScreen" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#0a7ea4',
        tabBarStyle: { height: 72 },
        tabBarIconStyle: { width: 32, height: 32 },
        tabBarLabelStyle: { marginBottom: 4, flexWrap: 'wrap', textAlign: 'center' },
        tabBarItemStyle: { paddingTop: 4 },
      }}
    >
      <Tabs.Screen
        name="CoordinatorDashboardScreen"
        options={{
          title: 'My Dashboard',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="FindATeam"
        options={{
          title: 'Find a Team',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="search" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="TournamentListScreen"
        options={{
          title: 'Tournaments',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="trophy" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="FindGamesScreen"
        options={{
          title: 'Find a Game',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="calendar" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen name="HomeScreen" options={{ href: null }} />
      <Tabs.Screen name="CreateTeamScreen" options={{ href: null }} />
      <Tabs.Screen name="GameResultsScreen" options={{ href: null }} />
      <Tabs.Screen name="GameSchedulerScreen" options={{ href: null }} />
      <Tabs.Screen name="TeamDetailScreen" options={{ href: null }} />
      <Tabs.Screen name="CreateTournamentScreen" options={{ href: null }} />
      <Tabs.Screen name="TournamentDetailScreen" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
