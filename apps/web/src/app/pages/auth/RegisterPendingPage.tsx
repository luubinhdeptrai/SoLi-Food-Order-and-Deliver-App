import { RegisterPendingHeader } from "../../../features/auth/components/RegisterPendingHeader";
import { RegisterPendingStatus } from "../../../features/auth/components/RegisterPendingStatus";
import { RegisterPendingAlerts } from "../../../features/auth/components/RegisterPendingAlerts";
import { RegisterPendingSteps } from "../../../features/auth/components/RegisterPendingSteps";
import { RegisterPendingContact } from "../../../features/auth/components/RegisterPendingContact";
import { RegisterPendingMobileNav } from "../../../features/auth/components/RegisterPendingMobileNav";

export function RegisterPendingPage() {
  return (
    <div className="bg-surface text-on-surface antialiased min-h-screen flex flex-col font-body">
      <div className="flex flex-1">
        <main className="flex-1 overflow-y-auto bg-surface-container-low p-6 md:p-12 w-full min-h-full pb-24 md:pb-12">
            <div className="mx-auto space-y-10 max-w-5xl">
                <RegisterPendingHeader />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <RegisterPendingStatus />
                    <RegisterPendingAlerts />
                </div>
                <RegisterPendingSteps />
                <RegisterPendingContact />
            </div>
        </main>
      </div>
      <RegisterPendingMobileNav />
    </div>
  );
}
