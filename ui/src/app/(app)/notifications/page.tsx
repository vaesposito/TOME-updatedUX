import { AuthGuard } from "@/components/auth-guard";
import { NotificationInbox } from "@/components/notifications/NotificationInbox";

export const dynamic = "force-dynamic";

/**
 * The full notification page behind the header bell: an inbox of everything
 * addressed to the signed-in user, plus the entities they follow.
 */
export default function NotificationsPage() {
  return (
    <AuthGuard>
      <NotificationInbox />
    </AuthGuard>
  );
}
