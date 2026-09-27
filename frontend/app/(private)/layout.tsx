import { RequireSession } from "@/components/session-provider";
import { BottomNavigation } from "@/components/bottom-navigation";
import { UserProfileProvider } from "@/components/user-profile-provider";
import { WorkoutHistoryPreviewProvider } from "@/components/workout-history-preview-provider";
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <RequireSession>
      <UserProfileProvider>
        <WorkoutHistoryPreviewProvider>
          <div className="authenticated-app">
            {children}
            <BottomNavigation />
          </div>
        </WorkoutHistoryPreviewProvider>
      </UserProfileProvider>
    </RequireSession>
  );
}
