import { useOrderStore } from "@/features/orders/stores/orderStore";

type OrderBoardHeaderProps = {
  onRelease?: () => void;
};

export function OrderBoardHeader({ onRelease }: OrderBoardHeaderProps) {
  const { searchQuery, setSearchQuery } = useOrderStore();

  return (
    <div className="mb-6 flex justify-between items-center flex-shrink-0">
      <h2 className="text-2xl font-extrabold text-[#1a1c1c] tracking-tight font-['Plus_Jakarta_Sans']">
        Board
      </h2>
      <div className="flex gap-2 items-center">
        {/* Search / Quick Filters */}
        <div className="relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#707a6c] text-sm pointer-events-none">
            search
          </span>
          <input
            type="text"
            placeholder="Quick Filters"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-white border-none rounded-lg py-2 pl-9 pr-4 text-sm w-48 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#0d631b]/20 font-['Inter']"
          />
        </div>

        <button
          onClick={onRelease}
          className="bg-white px-4 py-2 rounded-lg text-sm font-bold text-[#40493d] shadow-sm border border-[#bfcaba]/30 hover:bg-[#f3f3f3] transition-colors font-['Inter']"
        >
          Release
        </button>

        <button className="p-2 text-[#707a6c] hover:text-[#1a1c1c] transition-colors rounded-lg hover:bg-white">
          <span className="material-symbols-outlined">more_horiz</span>
        </button>
      </div>
    </div>
  );
}
