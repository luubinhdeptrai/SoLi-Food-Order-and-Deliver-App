import { RegisterBusinessForm } from "../../../features/auth/components/RegisterBusinessForm";
import { RegisterBusinessMap } from "../../../features/auth/components/RegisterBusinessMap";
import { RegisterBusinessFooter } from "../../../features/auth/components/RegisterBusinessFooter";
import { useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";

export function RegisterLocationPage() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!location.state?.step1Completed) {
      navigate("/auth/register", { replace: true });
    }
  }, [navigate, location]);

  const handleSubmit = (e: React.SubmitEvent) => {
    e.preventDefault();
    navigate("/auth/register/pending", { state: { step2Completed: true } });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-surface text-on-surface antialiased min-h-screen flex flex-col items-center justify-center font-body"
    >
      <div className="w-full flex justify-center py-12 px-4 md:px-8 lg:px-12 pb-32">
        {/* Main Content */}
        <main className="max-w-6xl w-full">
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-10 items-start">
            <RegisterBusinessForm />
            <RegisterBusinessMap />
          </div>
        </main>
      </div>

      <RegisterBusinessFooter />
    </form>
  );
}
