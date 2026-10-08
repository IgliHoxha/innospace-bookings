// The three things a row's buttons can do to a booking. `verb` names the button
// and titles its prompt; `email` is the email that goes out, null for none.
export const ROW_ACTIONS = [
  {
    status: "confirmed",
    verb: "Confirm",
    icon: "✓",
    className: "tick",
    email: "confirmation",
  },
  {
    status: "cancelled",
    verb: "Cancel",
    icon: "✕",
    className: "cross",
    email: "cancellation",
  },
  {
    status: "deleted",
    verb: "Delete",
    icon: "🗑",
    className: "trash",
    email: null,
  },
] as const;

export type RowAction = (typeof ROW_ACTIONS)[number];
