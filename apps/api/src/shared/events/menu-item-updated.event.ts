/**
 * MenuItemModifierSnapshot — shape of one modifier group embedded in the event.
 * Matches the JSONB structure stored in ordering_menu_item_snapshots.modifiers.
 */
export interface ModifierOptionSnapshot {
  optionId: string;
  name: string;
  price: number;
  isDefault: boolean;
  /** Whether this option is currently available for selection. */
  isAvailable: boolean;
}

export interface MenuItemModifierSnapshot {
  groupId: string;
  groupName: string;
  minSelections: number;
  maxSelections: number;
  options: ModifierOptionSnapshot[];
}

/**
 * MenuItemUpdatedEvent
 *
 * Published by: RestaurantCatalog BC (MenuService + ModifiersService)
 * Triggers after: create, update, toggleSoldOut, delete (MenuService)
 *               + createGroup, updateGroup, deleteGroup,
 *                 createOption, updateOption, deleteOption (ModifiersService)
 * Consumed by: Ordering BC → MenuItemProjector (Phase 3)
 *
 * Payload uses `status` enum as the single source of truth.
 * `isAvailable` is intentionally omitted — derive with `status === 'available'`.
 * `modifiers` carries the full group+option tree at event time so the snapshot
 * remains in sync without a separate modifier event type.
 */
export class MenuItemUpdatedEvent {
  constructor(
    public readonly menuItemId: string,
    public readonly restaurantId: string,
    public readonly name: string,
    /**
     * Current unit price (base, excluding modifiers).
     * Frozen into order_items at checkout time.
     */
    public readonly price: number,
    /** Canonical availability field. 'available' | 'unavailable' | 'out_of_stock' */
    public readonly status: 'available' | 'unavailable' | 'out_of_stock',
    /**
     * Full modifier group+option tree at event time.
     *  null  = this event carries no modifier data; projector MUST NOT update the modifiers column.
     *  []    = item genuinely has no modifier groups (e.g. was just created, or was deleted with status='unavailable').
     *  [...] = full current modifier tree at event time.
     */
    public readonly modifiers: MenuItemModifierSnapshot[] | null,
  ) {}
}
