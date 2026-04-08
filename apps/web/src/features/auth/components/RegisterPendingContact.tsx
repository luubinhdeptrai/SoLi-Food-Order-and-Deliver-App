import { Button } from "@/components/ui/button";

export function RegisterPendingContact() {
  return (
    <div className="flex flex-col md:flex-row items-center justify-between bg-surface-container-lowest rounded-xl p-6 border border-outline-variant/15">
      <div className="flex items-center gap-4 mb-4 md:mb-0">
        <div className="w-12 h-12 rounded-full overflow-hidden">
          <img
            alt="Support Agent"
            className="w-full h-full object-cover"
            src="https://lh3.googleusercontent.com/aida-public/AB6AXuB4uNLIUxqlMums7sV4I6AUwVVgID-rNynEBPuxAI76nD8FmyT5sxaZxnAWF60T3Qo1zhjyqM3d5RXWkJ5cbPqz61EmpPCv7oImbIl4ZZpUVYsWTkBIDk5c1xf6dvIT9w2SUXMhtN6bR6zSq2Y0S6K63ioXt7PI-G7Fbf1t3z2FjryCLP2LFZXEaUk1QhBlNc15wz0Ljj8wAqbKWmfTws33mtbAE-KwIA7WTf0Q6ohB-_ShPlKRNOV9QqJU2kEnv3qu9BiRfH3L2fA"
          />
        </div>
        <div>
          <p className="font-bold font-headline">Have questions?</p>
          <p className="text-xs text-on-surface-variant">
            Our support team is online to help with your application.
          </p>
        </div>
      </div>
      <Button
        variant="secondary"
        className="px-6 py-3 h-auto rounded-full bg-surface-container-high text-primary font-bold text-sm hover:bg-surface-container-highest transition-colors"
      >
        Contact Support
      </Button>
    </div>
  );
}
