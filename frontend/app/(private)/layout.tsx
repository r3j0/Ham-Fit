import { MemberOutfitProvider } from "@/components/member-outfit-provider";
import { AvatarCatalogProvider } from "@/components/avatar-catalog-provider";
import { RequireSession } from "@/components/session-provider";
import { BottomNavigation } from "@/components/bottom-navigation";
import { UserProfileProvider } from "@/components/user-profile-provider";
import { WorkoutHistoryProvider } from "@/components/workout-history-provider";
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <RequireSession>
      <UserProfileProvider>
        <WorkoutHistoryProvider>
          <AvatarCatalogProvider>
            <MemberOutfitProvider>
              <div className="authenticated-app">
                {children}
                <BottomNavigation />
              </div>
            </MemberOutfitProvider>
          </AvatarCatalogProvider>
        </WorkoutHistoryProvider>
      </UserProfileProvider>
    </RequireSession>
  );
}
