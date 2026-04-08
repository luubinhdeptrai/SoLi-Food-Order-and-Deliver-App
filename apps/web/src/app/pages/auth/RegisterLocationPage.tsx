import { RegisterLocationForm } from "../../../features/auth/components/RegisterLocationForm";
import { RegisterLocationMap } from "../../../features/auth/components/RegisterLocationMap";
import { RegisterLocationFooter } from "../../../features/auth/components/RegisterLocationFooter";

export function RegisterLocationPage() {
  return (
    <div className="bg-surface text-on-surface antialiased min-h-screen flex flex-col items-center justify-center font-body">
      <div className="w-full flex justify-center py-12 px-4 md:px-8 lg:px-12 pb-32">
        {/* Main Content */}
        <main className="max-w-6xl w-full">
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-10 items-start">
            <RegisterLocationForm />
            <RegisterLocationMap />
          </div>
        </main>
      </div>

      <RegisterLocationFooter />
    </div>
  );
}
