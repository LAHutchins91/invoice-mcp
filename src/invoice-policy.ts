export class InvoiceRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoiceRefusal";
  }
}

export class InvoiceUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoiceUserError";
  }
}

export type InvoiceStatus = "draft" | "approved";

export type RateUnit = "hour" | "each" | "day";

export type DiscountKind = "none" | "percent" | "fixed";

export type LateBasis = "none" | "flat_fee" | "percent_per_period";

export type ChangeKind =
  | "add_line"
  | "change_rate"
  | "apply_discount"
  | "move_due_date"
  | "adjust_quantity"
  | "revise_late_terms";

export type Discount = {
  kind: DiscountKind;
  value: number;
  note: string;
  updatedAt: string;
};

export type LateTerms = {
  graceDays: number;
  basis: LateBasis;
  feeMinor: number;
  percent: number;
  note: string;
  updatedAt: string;
};

export const REFUSED_NEW_LINE =
  "Refused: a new line is not allowed after the invoice is approved. Suggest an add_line change and accept that change before adding it.";

export const REFUSED_RATE =
  "Refused: the approved rate stays as it was approved. Suggest a change_rate change and accept that change. quote_line_rate will not change an approved rate.";

export const REFUSED_DISCOUNT =
  "Refused: inventing or changing a discount is not allowed after the invoice is approved. Suggest an apply_discount change and accept that change. offer_discount will not apply it.";

export const REFUSED_DUE =
  "Refused: the due date stays as approved. Suggest a move_due_date change and accept that change.";

export const REFUSED_QUANTITY =
  "Refused: the approved quantity stays as it was approved. Suggest an adjust_quantity change and accept that change.";

export const REFUSED_LATE =
  "Refused: late terms stay as approved. Suggest a revise_late_terms change and accept that change.";

export const REFUSED_DESCRIPTION =
  "Refused: the approved line description stays as it was approved. Suggest an add_line change for a different line.";

export const RECORD_GUIDANCE =
  "Answer only from this invoice. Draft status means the invoice is not an approved commitment. Proposed invoice changes are not authorization. Do not add a line, change a rate, invent a discount, or move the due date. place_line, quote_line_rate, offer_discount, and set_invoice_due refuse those changes after approval. Line amounts are the freelancer's approved figures.";

export function labelKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function sameDiscount(current: Discount | null, nextKind: DiscountKind, nextValue: number): boolean {
  const next = nextKind === "none" ? { kind: "none" as const, value: 0 } : { kind: nextKind, value: nextValue };
  if (!current || current.kind === "none") return next.kind === "none";
  return current.kind === next.kind && current.value === next.value;
}

export function assertNewLine(status: InvoiceStatus): void {
  if (status === "approved") throw new InvoiceRefusal(REFUSED_NEW_LINE);
}

export function assertRateWrite(status: InvoiceStatus, current: number, next: number): void {
  if (status === "approved" && current !== next) throw new InvoiceRefusal(REFUSED_RATE);
}

export function assertQuantityWrite(status: InvoiceStatus, current: number, next: number): void {
  if (status === "approved" && current !== next) throw new InvoiceRefusal(REFUSED_QUANTITY);
}

export function assertDescriptionWrite(status: InvoiceStatus, current: string, next: string): void {
  if (status === "approved" && current !== next) throw new InvoiceRefusal(REFUSED_DESCRIPTION);
}

export function assertDiscountWrite(status: InvoiceStatus, current: Discount | null, nextKind: DiscountKind, nextValue: number): void {
  if (status !== "approved") return;
  if (sameDiscount(current, nextKind, nextValue)) return;
  throw new InvoiceRefusal(REFUSED_DISCOUNT);
}

export function assertDueWrite(status: InvoiceStatus, current: string | null, next: string): void {
  if (status === "approved" && current !== next) throw new InvoiceRefusal(REFUSED_DUE);
}

export function assertLateWrite(
  status: InvoiceStatus,
  current: LateTerms | null,
  next: Pick<LateTerms, "graceDays" | "basis" | "feeMinor" | "percent">
): void {
  if (status !== "approved") return;
  if (
    current &&
    current.graceDays === next.graceDays &&
    current.basis === next.basis &&
    current.feeMinor === next.feeMinor &&
    current.percent === next.percent
  ) {
    return;
  }
  throw new InvoiceRefusal(REFUSED_LATE);
}
