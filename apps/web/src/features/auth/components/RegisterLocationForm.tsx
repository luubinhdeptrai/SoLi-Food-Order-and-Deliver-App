import { Store, UtensilsCrossed, Contact, Phone, AtSign, MapPin } from "lucide-react";

export function RegisterLocationForm() {
  return (
    <div className="xl:col-span-7 space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight mb-3 font-headline">
          Describe your restaurant
        </h1>
        <p className="text-slate-600">
          Fill in the form bellow to describe your restaurant. The information will be used to verify your restaurant.
        </p>
      </div>

      <div className="space-y-6">
        {/* Contact Section */}
        <section className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm space-y-6">
          <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
            <div className="p-2 bg-slate-100 rounded-lg">
              <Store className="w-6 h-6 text-slate-600" />
            </div>
            <h3 className="font-bold text-slate-800 font-headline">Restaurant Identification</h3>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700 font-headline">Restaurant Name</label>
            <div className="relative">
              <UtensilsCrossed className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
              <input 
                className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary focus:bg-white transition-all outline-none font-headline" 
                placeholder="e.g. The Green Bistro" 
                type="text" 
              />
            </div>
          </div>
        </section>

        <section className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm space-y-6">
          <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
            <div className="p-2 bg-slate-100 rounded-lg">
              <Contact className="w-6 h-6 text-slate-600" />
            </div>
            <h3 className="font-bold text-slate-800">Business Contact</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Store Phone Number</label>
              <div className="relative">
                <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                <input 
                  className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary focus:bg-white transition-all outline-none" 
                  placeholder="+1 (555) 000-0000" 
                  type="tel" 
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Public Business Email</label>
              <div className="relative">
                <AtSign className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                <input 
                  className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary focus:bg-white transition-all outline-none" 
                  placeholder="contact@restaurant.com" 
                  type="email" 
                />
              </div>
            </div>
          </div>
        </section>

        {/* Address Section */}
        <section className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm space-y-6">
          <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
            <div className="p-2 bg-slate-100 rounded-lg">
              <MapPin className="w-6 h-6 text-slate-600" />
            </div>
            <h3 className="font-bold text-slate-800">Store Address</h3>
          </div>

          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Street Address</label>
              <input 
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary focus:bg-white transition-all outline-none" 
                placeholder="123 Gastronomy St." 
                type="text" 
              />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700">City</label>
                <input 
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary focus:bg-white transition-all outline-none" 
                  placeholder="New York" 
                  type="text" 
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700">State</label>
                <select className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary focus:bg-white transition-all outline-none appearance-none">
                  <option>Select State</option>
                  <option value="NY">NY</option>
                  <option value="CA">CA</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700">ZIP Code</label>
                <input 
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary focus:bg-white transition-all outline-none" 
                  placeholder="10001" 
                  type="text" 
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Floor, Suite, or Unit (Optional)</label>
              <input 
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary focus:bg-white transition-all outline-none" 
                placeholder="e.g. Unit 4B" 
                type="text" 
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
