import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

type CustomerInfo = {
  name: string;
  phone: string;
  address: string;
  gateCode?: string;
};

type OrderDetailCustomerProps = {
  customer: CustomerInfo;
};

export function OrderDetailCustomer({ customer }: OrderDetailCustomerProps) {
  return (
    <Card className="rounded-2xl ring-0 shadow-none bg-surface-container-lowest gap-0 py-0">
      <CardHeader className="px-6 pt-6 pb-0">
        <div className="flex items-center justify-between">
          <CardTitle className="font-headline font-bold text-lg text-on-surface">
            Customer
          </CardTitle>
          <button
            type="button"
            aria-label="Contact support"
            className="text-primary material-symbols-outlined"
          >
            contact_support
          </button>
        </div>
      </CardHeader>

      <CardContent className="px-6 pb-6 pt-4 space-y-4">
        {/* Avatar + name + phone */}
        <div className="flex items-center gap-4">
          <Avatar className="w-12 h-12 bg-stone-100">
            <AvatarFallback className="bg-stone-100 text-stone-500">
              <span className="material-symbols-outlined" aria-hidden="true">
                person
              </span>
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="font-bold text-on-surface font-headline">{customer.name}</p>
            <p className="text-sm text-stone-500 font-body">{customer.phone}</p>
          </div>
        </div>

        {/* Address */}
        <div className="space-y-2">
          <p className="text-[10px] uppercase font-bold text-stone-400 tracking-widest font-body">
            Delivery Address
          </p>
          <p className="text-sm text-on-surface leading-relaxed font-body whitespace-pre-line">
            {customer.address}
            {customer.gateCode && (
              <>
                {"\n"}
                <span className="text-stone-500 italic">Gate code: {customer.gateCode}</span>
              </>
            )}
          </p>
        </div>

        {/* Contact button — shadcn outline variant, rounded-xl */}
        <Button
          variant="outline"
          className="w-full rounded-xl border-primary/20 text-primary font-bold hover:bg-primary/5 hover:text-primary"
        >
          <span className="material-symbols-outlined text-sm" aria-hidden="true">
            chat_bubble
          </span>
          Contact Customer
        </Button>
      </CardContent>
    </Card>
  );
}
