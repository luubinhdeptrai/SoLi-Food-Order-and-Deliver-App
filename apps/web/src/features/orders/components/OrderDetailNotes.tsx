import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type OrderDetailNotesProps = {
  notes: string;
};

export function OrderDetailNotes({ notes }: OrderDetailNotesProps) {
  return (
    <Card className="rounded-2xl ring-0 shadow-none bg-tertiary-container/10 border border-tertiary-container/20 gap-0 py-0">
      <CardHeader className="px-6 pt-6 pb-0">
        <div className="flex items-center gap-2">
          <span
            className="material-symbols-outlined text-tertiary"
            aria-hidden="true"
          >
            sticky_note_2
          </span>
          <CardTitle className="font-headline font-bold text-tertiary">
            Kitchen Notes
          </CardTitle>
        </div>
      </CardHeader>

      <CardContent className="px-6 pb-6 pt-3">
        <p className="text-sm text-stone-700 italic leading-relaxed font-body">
          "{notes}"
        </p>
      </CardContent>
    </Card>
  );
}
