import { Tag, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

const dietaryTags = [
  "Vegan",
  "Gluten-Free",
  "Organic",
  "Locally Sourced",
  "Sugar-Free",
];

export function DietaryTagsCard() {
  return (
    <div className="bg-card rounded-3xl p-8 shadow-sm border border-border/50">
      <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
        <Tag className="h-5 w-5 text-primary" />
        Dietary & Lifestyle Tags
      </h3>
      <div className="flex flex-wrap gap-3">
        {dietaryTags.map((tag) => (
          <label key={tag} className="group relative cursor-pointer">
            <input
              type="checkbox"
              className="peer sr-only"
              defaultChecked={tag === "Locally Sourced"}
            />
            <div className="px-5 py-2.5 rounded-full border border-border text-muted-foreground font-medium peer-checked:bg-primary-200 peer-checked:border-primary-200 peer-checked:text-on-primary-fixed transition-all group-hover:border-primary">
              {tag}
            </div>
          </label>
        ))}
        <Button
          variant="outline"
          className="px-4 py-2 h-11 rounded-full border-2 border-dashed border-border text-muted-foreground font-medium flex items-center gap-1 hover:border-primary hover:text-primary transition-all bg-transparent"
        >
          <Plus className="h-4 w-4" />
          Custom Tag
        </Button>
      </div>
    </div>
  );
}
