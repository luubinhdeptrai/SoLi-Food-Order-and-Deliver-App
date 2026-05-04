import {
  Store,
  UtensilsCrossed,
  Contact,
  Phone,
  AtSign,
  MapPin,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function RegisterBusinessForm() {
  return (
    <div className="xl:col-span-7 space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold text-on-surface tracking-tight mb-3 font-headline">
          Describe your restaurant
        </h1>
        <p className="text-on-surface-variant">
          Fill in the form below to describe your restaurant. The information
          will be used to verify your restaurant.
        </p>
      </div>

      <div className="space-y-6">
        {/* Restaurant Identification */}
        <Card className="bg-surface-container-lowest border border-outline-variant/20 shadow-sm rounded-2xl ring-0">
          <CardHeader className="border-b border-outline-variant/10 ">
            <CardTitle className="flex items-center gap-3">
              <div className="p-2 bg-surface-container rounded-lg">
                <Store className="w-6 h-6 text-on-surface-variant" />
              </div>
              <span className="font-bold text-on-surface font-headline text-base">
                Restaurant Identification
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6 space-y-4">
            <div className="space-y-2">
              <Label
                htmlFor="restaurantName"
                className="text-sm font-semibold text-on-surface-variant font-headline"
              >
                Restaurant Name
              </Label>
              <div className="relative">
                <UtensilsCrossed className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant/50 w-5 h-5 pointer-events-none z-10" />
                <Input
                  id="restaurantName"
                  className="w-full pl-11 pr-4 py-3 h-auto bg-surface-container border border-outline-variant/20 rounded-xl focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary focus-visible:bg-surface-container-lowest transition-all font-headline"
                  placeholder="e.g. The Green Bistro"
                  type="text"
                  required
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Business Contact */}
        <Card className="bg-surface-container-lowest border border-outline-variant/20 shadow-sm rounded-2xl ring-0">
          <CardHeader className="border-b border-outline-variant/10 pb-4">
            <CardTitle className="flex items-center gap-3">
              <div className="p-2 bg-surface-container rounded-lg">
                <Contact className="w-6 h-6 text-on-surface-variant" />
              </div>
              <span className="font-bold text-on-surface font-headline text-base">
                Business Contact
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label
                  htmlFor="storePhone"
                  className="text-sm font-semibold text-on-surface-variant"
                >
                  Store Phone Number
                </Label>
                <div className="relative">
                  <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant/50 w-5 h-5 pointer-events-none z-10" />
                  <Input
                    id="storePhone"
                    className="w-full pl-11 pr-4 py-3 h-auto bg-surface-container border border-outline-variant/20 rounded-xl focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary focus-visible:bg-surface-container-lowest transition-all"
                    placeholder="+1 (555) 000-0000"
                    type="tel"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label
                  htmlFor="businessEmail"
                  className="text-sm font-semibold text-on-surface-variant"
                >
                  Public Business Email
                </Label>
                <div className="relative">
                  <AtSign className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant/50 w-5 h-5 pointer-events-none z-10" />
                  <Input
                    id="businessEmail"
                    className="w-full pl-11 pr-4 py-3 h-auto bg-surface-container border border-outline-variant/20 rounded-xl focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary focus-visible:bg-surface-container-lowest transition-all"
                    placeholder="contact@restaurant.com"
                    type="email"
                    required
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Address Section */}
        <Card className="bg-surface-container-lowest border border-outline-variant/20 shadow-sm rounded-2xl ring-0">
          <CardHeader className="border-b border-outline-variant/10 pb-4">
            <CardTitle className="flex items-center gap-3">
              <div className="p-2 bg-surface-container rounded-lg">
                <MapPin className="w-6 h-6 text-on-surface-variant" />
              </div>
              <span className="font-bold text-on-surface font-headline text-base">
                Store Address
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6 space-y-6">
            <div className="space-y-2">
              <Label
                htmlFor="streetAddress"
                className="text-sm font-semibold text-on-surface-variant"
              >
                Street Address
              </Label>
              <Input
                id="streetAddress"
                className="w-full px-4 py-3 h-auto bg-surface-container border border-outline-variant/20 rounded-xl focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary focus-visible:bg-surface-container-lowest transition-all"
                placeholder="123 Gastronomy St."
                type="text"
                required
              />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <Label
                  htmlFor="city"
                  className="text-sm font-semibold text-on-surface-variant"
                >
                  City
                </Label>
                <Input
                  id="city"
                  className="w-full px-4 py-3 h-auto bg-surface-container border border-outline-variant/20 rounded-xl focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary focus-visible:bg-surface-container-lowest transition-all"
                  placeholder="New York"
                  type="text"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label
                  htmlFor="stateSelect"
                  className="text-sm font-semibold text-on-surface-variant"
                >
                  State
                </Label>
                <Select required>
                  <SelectTrigger
                    id="stateSelect"
                    className="w-full h-auto px-4 py-3 bg-surface-container border border-outline-variant/20 rounded-xl focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary focus-visible:bg-surface-container-lowest transition-all"
                  >
                    <SelectValue placeholder="Select State" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NY">NY</SelectItem>
                    <SelectItem value="CA">CA</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label
                  htmlFor="zipCode"
                  className="text-sm font-semibold text-on-surface-variant"
                >
                  ZIP Code
                </Label>
                <Input
                  id="zipCode"
                  className="w-full px-4 py-3 h-auto bg-surface-container border border-outline-variant/20 rounded-xl focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary focus-visible:bg-surface-container-lowest transition-all"
                  placeholder="10001"
                  type="text"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label
                htmlFor="suiteInput"
                className="text-sm font-semibold text-on-surface-variant"
              >
                Floor, Suite, or Unit (Optional)
              </Label>
              <Input
                id="suiteInput"
                className="w-full px-4 py-3 h-auto bg-surface-container border border-outline-variant/20 rounded-xl focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary focus-visible:bg-surface-container-lowest transition-all"
                placeholder="e.g. Unit 4B"
                type="text"
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
