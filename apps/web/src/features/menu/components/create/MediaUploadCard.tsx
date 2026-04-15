import { Image, CloudUpload, Camera } from "lucide-react";

export function MediaUploadCard() {
  return (
    <div className="bg-card rounded-3xl p-8 shadow-sm border border-border/50">
      <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
        <Image className="h-5 w-5 text-primary" />
        Gallery
      </h3>
      <div className="relative aspect-square rounded-2xl overflow-hidden bg-surface-container group cursor-pointer border-2 border-dashed border-border hover:border-primary transition-colors">
        <img
          className="w-full h-full object-cover opacity-20 group-hover:opacity-40 transition-opacity"
          alt="Product placeholder"
          src="https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?auto=format&fit=crop&q=80&w=800"
        />
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6">
          <div className="w-16 h-16 bg-card rounded-full flex items-center justify-center shadow-md mb-4 text-primary">
            <CloudUpload className="h-8 w-8" />
          </div>
          <p className="font-bold text-foreground">Upload Cover Photo</p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            High-resolution JPG or PNG.
            <br />
            Max file size 5MB.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 mt-4">
        <div className="aspect-square rounded-xl bg-surface-container border-2 border-dashed border-border flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary cursor-pointer transition-all">
          <Camera className="h-6 w-6" />
        </div>
        <div className="aspect-square rounded-xl bg-surface-container border-2 border-dashed border-border flex items-center justify-center text-muted-foreground" />
        <div className="aspect-square rounded-xl bg-surface-container border-2 border-dashed border-border flex items-center justify-center text-muted-foreground" />
      </div>
    </div>
  );
}
