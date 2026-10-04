import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  RECORD_GUIDANCE,
  InvoiceRefusal,
  InvoiceUserError,
  assertDescriptionWrite,
  assertDiscountWrite,
  assertDueWrite,
  assertLateWrite,
  assertNewLine,
  assertQuantityWrite,
  assertRateWrite,
  labelKey,
  sameDiscount,
  type ChangeKind,
  type Discount,
  type DiscountKind,
  type InvoiceStatus,
  type LateBasis,
  type LateTerms,
  type RateUnit
} from "./invoice-policy.js";

export type { ChangeKind, Discount, DiscountKind, InvoiceStatus, LateBasis, LateTerms, RateUnit };

const MAX_INVOICES = 50;
const MAX_LINES = 200;
const MAX_CHANGES = 200;
const MAX_SUPPORT = 200;
const MAX_QUANTITY = 10_000;
const MAX_MINOR = 100_000_000;

export type LineItem = {
  id: string;
  description: string;
  quantity: number;
  rateMinor: number;
  unit: RateUnit;
  createdAt: string;
  updatedAt: string;
};

export type InvoiceChange = {
  id: string;
  kind: ChangeKind;
  status: "proposed" | "approved";
  summary: string;
  lineId: string | null;
  description: string | null;
  quantity: number | null;
  rateMinor: number | null;
  unit: RateUnit | null;
  discountKind: DiscountKind | null;
  discountValue: number | null;
  discountNote: string | null;
  dueOn: string | null;
  graceDays: number | null;
  lateBasis: LateBasis | null;
  feeMinor: number | null;
  latePercent: number | null;
  lateNote: string | null;
  applied: boolean;
  createdAt: string;
  approvedAt: string | null;
};

export type Invoice = {
  id: string;
  clientName: string;
  title: string;
  number: string;
  currency: string;
  status: InvoiceStatus;
  approvedAt: string | null;
  lines: LineItem[];
  dueOn: string | null;
  lateTerms: LateTerms | null;
  discount: Discount | null;
  changes: InvoiceChange[];
  createdAt: string;
  updatedAt: string;
};

export type InvoiceSummary = {
  id: string;
  clientName: string;
  title: string;
  number: string;
  currency: string;
  status: InvoiceStatus;
  dueOn: string | null;
  lineCount: number;
};

export type Profile = {
  userId: string;
  subscriptionStatus: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

export type PresentedLine = LineItem & { extendedMinor: number };

export type InvoiceRecord = {
  invoice: {
    id: string;
    clientName: string;
    title: string;
    number: string;
    currency: string;
    status: InvoiceStatus;
    approvedAt: string | null;
  };
  lines: PresentedLine[];
  dueOn: string | null;
  lateTerms: LateTerms | null;
  discount: Discount | null;
  approvedChanges: InvoiceChange[];
  proposedChanges: InvoiceChange[];
  guidance: string;
};

export type BeginInvoiceInput = {
  clientName: string;
  title: string;
  number: string;
  currency: string;
};

export type PlaceLineInput = {
  invoiceId: string;
  description: string;
  quantity: number;
  rateMinor: number;
  unit: RateUnit;
};

export type LineTextInput = {
  invoiceId: string;
  lineId: string;
  description: string;
};

export type LineRateInput = {
  invoiceId: string;
  lineId: string;
  rateMinor: number;
};

export type LineQuantityInput = {
  invoiceId: string;
  lineId: string;
  quantity: number;
};

export type DueInput = {
  invoiceId: string;
  dueOn: string;
};

export type LateInput = {
  invoiceId: string;
  graceDays: number;
  basis: LateBasis;
  feeMinor: number;
  percent: number;
  note: string;
};

export type DiscountInput = {
  invoiceId: string;
  kind: DiscountKind;
  value: number;
  note: string;
};

export type SuggestChangeInput = {
  invoiceId: string;
  kind: ChangeKind;
  summary: string;
  lineId?: string;
  description?: string;
  quantity?: number;
  rateMinor?: number;
  unit?: RateUnit;
  discountKind?: DiscountKind;
  discountValue?: number;
  discountNote?: string;
  dueOn?: string;
  graceDays?: number;
  lateBasis?: LateBasis;
  feeMinor?: number;
  latePercent?: number;
  lateNote?: string;
};

type SupportRequest = { id: string; email: string; message: string; createdAt: string };

type FileData = {
  version: 1;
  profiles: Record<string, Profile>;
  invoices: Record<string, Invoice[]>;
  supportRequests: SupportRequest[];
};

export type InvoiceStore = {
  getProfile(userId: string): Promise<Profile>;
  updateProfile(userId: string, patch: Partial<Omit<Profile, "userId">>): Promise<Profile>;
  listInvoices(userId: string, offset: number): Promise<{ invoices: InvoiceSummary[]; nextOffset: number | null }>;
  beginInvoice(userId: string, input: BeginInvoiceInput): Promise<Invoice>;
  readInvoice(userId: string, invoiceId: string): Promise<InvoiceRecord>;
  placeLine(userId: string, input: PlaceLineInput): Promise<PresentedLine>;
  describeLine(userId: string, input: LineTextInput): Promise<PresentedLine>;
  quoteLineRate(userId: string, input: LineRateInput): Promise<PresentedLine>;
  setLineQuantity(userId: string, input: LineQuantityInput): Promise<PresentedLine>;
  setInvoiceDue(userId: string, input: DueInput): Promise<{ dueOn: string }>;
  writeLateTerms(userId: string, input: LateInput): Promise<LateTerms>;
  offerDiscount(userId: string, input: DiscountInput): Promise<Discount>;
  sealInvoice(userId: string, invoiceId: string): Promise<InvoiceRecord>;
  suggestInvoiceChange(userId: string, input: SuggestChangeInput): Promise<InvoiceChange>;
  acceptInvoiceChange(userId: string, invoiceId: string, changeId: string): Promise<InvoiceRecord>;
  addSupportRequest(input: { email: string; message: string }): Promise<{ id: string }>;
};

export function defaultInvoiceDataPath(): string {
  return path.join(os.homedir(), ".invoice", "invoice.json");
}

export function assertInvoiceDataPath(filePath: string): string {
  const resolved = path.resolve(filePath);
  const forbidden = [
    path.resolve(path.join(os.homedir(), ".scope", "scope.json")),
    path.resolve(path.join(os.homedir(), ".retain", "retain.json"))
  ];
  if (forbidden.includes(resolved)) throw new InvoiceUserError("Invoice data must use its own file.");
  return resolved;
}

function emptyData(): FileData {
  return { version: 1, profiles: {}, invoices: {}, supportRequests: [] };
}

function nowIso(): string {
  return new Date().toISOString();
}

function cleanText(value: string, label: string, max: number): string {
  const text = value.trim();
  if (!text || text.length > max) throw new InvoiceUserError(`${label} must be 1–${max} characters.`);
  return text;
}

function assertQuantity(quantity: number): number {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
    throw new InvoiceUserError(`Quantity must be a whole number from 1 to ${MAX_QUANTITY}.`);
  }
  return quantity;
}

function assertMinor(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1 || value > MAX_MINOR) {
    throw new InvoiceUserError(`${label} must be a whole number of minor units from 1 to ${MAX_MINOR}.`);
  }
  return value;
}

function assertUnit(unit: string): RateUnit {
  if (unit !== "hour" && unit !== "each" && unit !== "day") {
    throw new InvoiceUserError("Line unit must be hour, each, or day.");
  }
  return unit;
}

function assertCurrency(value: string): string {
  const code = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new InvoiceUserError("Currency must be a three-letter code.");
  return code;
}

function assertDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new InvoiceUserError("Due date must be a calendar date.");
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new InvoiceUserError("Due date must be a calendar date.");
  }
  return value;
}

function assertDiscountKind(value: string): DiscountKind {
  if (value !== "none" && value !== "percent" && value !== "fixed") {
    throw new InvoiceUserError("Discount kind must be none, percent, or fixed.");
  }
  return value;
}

function assertDiscountValue(kind: DiscountKind, value: number): number {
  if (kind === "none") {
    if (value !== 0) throw new InvoiceUserError("A discount of kind none uses a value of 0.");
    return 0;
  }
  if (kind === "percent") {
    if (!Number.isInteger(value) || value < 1 || value > 100) {
      throw new InvoiceUserError("A percent discount must be a whole number from 1 to 100.");
    }
    return value;
  }
  return assertMinor(value, "Fixed discount");
}

function assertLateBasis(value: string): LateBasis {
  if (value !== "none" && value !== "flat_fee" && value !== "percent_per_period") {
    throw new InvoiceUserError("Late basis must be none, flat_fee, or percent_per_period.");
  }
  return value;
}

function assertGrace(days: number): number {
  if (!Number.isInteger(days) || days < 0 || days > 365) {
    throw new InvoiceUserError("Grace days must be a whole number from 0 to 365.");
  }
  return days;
}

function normalizeLate(input: { graceDays: number; basis: string; feeMinor: number; percent: number }): Pick<LateTerms, "graceDays" | "basis" | "feeMinor" | "percent"> {
  const graceDays = assertGrace(input.graceDays);
  const basis = assertLateBasis(input.basis);
  if (basis === "none") {
    if (input.feeMinor !== 0 || input.percent !== 0) {
      throw new InvoiceUserError("Late basis none uses a fee of 0 and a percent of 0.");
    }
    return { graceDays, basis, feeMinor: 0, percent: 0 };
  }
  if (basis === "flat_fee") {
    if (input.percent !== 0) throw new InvoiceUserError("A flat late fee uses a percent of 0.");
    return { graceDays, basis, feeMinor: assertMinor(input.feeMinor, "Late fee"), percent: 0 };
  }
  if (!Number.isInteger(input.percent) || input.percent < 1 || input.percent > 100) {
    throw new InvoiceUserError("A late percent must be a whole number from 1 to 100.");
  }
  if (input.feeMinor !== 0) throw new InvoiceUserError("A percent late term uses a fee of 0.");
  return { graceDays, basis, feeMinor: 0, percent: input.percent };
}

function lateMatches(current: LateTerms, next: Pick<LateTerms, "graceDays" | "basis" | "feeMinor" | "percent">): boolean {
  return current.graceDays === next.graceDays && current.basis === next.basis && current.feeMinor === next.feeMinor && current.percent === next.percent;
}

function blankProfile(userId: string): Profile {
  return {
    userId,
    subscriptionStatus: "none",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false
  };
}

function presentLine(line: LineItem): PresentedLine {
  return { ...line, extendedMinor: line.quantity * line.rateMinor };
}

function summary(invoice: Invoice): InvoiceSummary {
  return {
    id: invoice.id,
    clientName: invoice.clientName,
    title: invoice.title,
    number: invoice.number,
    currency: invoice.currency,
    status: invoice.status,
    dueOn: invoice.dueOn,
    lineCount: invoice.lines.length
  };
}

function toRecord(invoice: Invoice): InvoiceRecord {
  return {
    invoice: {
      id: invoice.id,
      clientName: invoice.clientName,
      title: invoice.title,
      number: invoice.number,
      currency: invoice.currency,
      status: invoice.status,
      approvedAt: invoice.approvedAt
    },
    lines: invoice.lines.map(presentLine),
    dueOn: invoice.dueOn,
    lateTerms: invoice.lateTerms,
    discount: invoice.discount,
    approvedChanges: invoice.changes.filter((change) => change.status === "approved"),
    proposedChanges: invoice.changes.filter((change) => change.status === "proposed"),
    guidance: RECORD_GUIDANCE
  };
}

function invoicesFor(data: FileData, userId: string): Invoice[] {
  const rows = data.invoices[userId];
  if (!rows) {
    data.invoices[userId] = [];
    return data.invoices[userId];
  }
  return rows;
}

function findInvoice(data: FileData, userId: string, invoiceId: string): Invoice {
  const invoice = (data.invoices[userId] ?? []).find((row) => row.id === invoiceId);
  if (!invoice) throw new InvoiceUserError("Invoice not found");
  return invoice;
}

function findLine(invoice: Invoice, lineId: string): LineItem {
  const line = invoice.lines.find((row) => row.id === lineId);
  if (!line) throw new InvoiceUserError("Line not found");
  return line;
}

function blankChange(kind: ChangeKind, summary: string): InvoiceChange {
  const stamp = nowIso();
  return {
    id: randomUUID(),
    kind,
    status: "proposed",
    summary,
    lineId: null,
    description: null,
    quantity: null,
    rateMinor: null,
    unit: null,
    discountKind: null,
    discountValue: null,
    discountNote: null,
    dueOn: null,
    graceDays: null,
    lateBasis: null,
    feeMinor: null,
    latePercent: null,
    lateNote: null,
    applied: false,
    createdAt: stamp,
    approvedAt: null
  };
}

export function createFileInvoiceStore(filePath: string): InvoiceStore {
  const resolved = assertInvoiceDataPath(filePath);
  let chain: Promise<void> = Promise.resolve();

  async function read(): Promise<FileData> {
    try {
      const text = await readFile(resolved, "utf8");
      if (!text.trim()) return emptyData();
      const parsed = JSON.parse(text) as FileData;
      if (parsed.version !== 1 || !parsed.profiles || !parsed.invoices || !Array.isArray(parsed.supportRequests)) {
        throw new InvoiceUserError("Invoice data could not be read.");
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyData();
      if (error instanceof InvoiceUserError) throw error;
      throw new InvoiceUserError("Invoice data could not be read.");
    }
  }

  async function write(data: FileData): Promise<void> {
    await mkdir(path.dirname(resolved), { recursive: true });
    const tmp = path.join(path.dirname(resolved), `.${path.basename(resolved)}.${process.pid}.${randomUUID()}.tmp`);
    await writeFile(tmp, JSON.stringify(data), "utf8");
    await rename(tmp, resolved);
  }

  function enqueue<T>(fn: (data: FileData) => T, persist: boolean): Promise<T> {
    const run = chain.then(async () => {
      const data = await read();
      const result = fn(data);
      if (persist) await write(data);
      return structuredClone(result);
    });
    chain = run.then(() => undefined, () => undefined);
    return run;
  }

  return {
    getProfile(userId) {
      return enqueue((data) => data.profiles[userId] ?? blankProfile(userId), false);
    },
    updateProfile(userId, patch) {
      return enqueue((data) => {
        const current = data.profiles[userId] ?? blankProfile(userId);
        const next: Profile = { ...current, ...patch, userId };
        data.profiles[userId] = next;
        return next;
      }, true);
    },
    listInvoices(userId, offset) {
      return enqueue((data) => {
        const rows = data.invoices[userId] ?? [];
        const start = Math.max(0, offset);
        const page = rows.slice(start, start + MAX_INVOICES).map(summary);
        const nextOffset = start + page.length < rows.length ? start + page.length : null;
        return { invoices: page, nextOffset };
      }, false);
    },
    beginInvoice(userId, input) {
      return enqueue((data) => {
        const rows = invoicesFor(data, userId);
        if (rows.length >= MAX_INVOICES) throw new InvoiceUserError("Invoice limit reached.");
        const number = cleanText(input.number, "Invoice number", 40);
        if (rows.some((row) => labelKey(row.number) === labelKey(number))) {
          throw new InvoiceUserError("That invoice number is already in use.");
        }
        const stamp = nowIso();
        const invoice: Invoice = {
          id: randomUUID(),
          clientName: cleanText(input.clientName, "Client name", 200),
          title: cleanText(input.title, "Title", 200),
          number,
          currency: assertCurrency(input.currency),
          status: "draft",
          approvedAt: null,
          lines: [],
          dueOn: null,
          lateTerms: null,
          discount: null,
          changes: [],
          createdAt: stamp,
          updatedAt: stamp
        };
        rows.unshift(invoice);
        return invoice;
      }, true);
    },
    readInvoice(userId, invoiceId) {
      return enqueue((data) => toRecord(findInvoice(data, userId, invoiceId)), false);
    },
    placeLine(userId, input) {
      return enqueue((data) => {
        const invoice = findInvoice(data, userId, input.invoiceId);
        assertNewLine(invoice.status);
        if (invoice.lines.length >= MAX_LINES) throw new InvoiceUserError("Line limit reached.");
        const description = cleanText(input.description, "Description", 500);
        const quantity = assertQuantity(input.quantity);
        const rateMinor = assertMinor(input.rateMinor, "Rate");
        const unit = assertUnit(input.unit);
        const stamp = nowIso();
        const line: LineItem = { id: randomUUID(), description, quantity, rateMinor, unit, createdAt: stamp, updatedAt: stamp };
        invoice.lines.push(line);
        invoice.updatedAt = stamp;
        return presentLine(line);
      }, true);
    },
    describeLine(userId, input) {
      return enqueue((data) => {
        const invoice = findInvoice(data, userId, input.invoiceId);
        const line = findLine(invoice, input.lineId);
        const description = cleanText(input.description, "Description", 500);
        assertDescriptionWrite(invoice.status, line.description, description);
        line.description = description;
        line.updatedAt = nowIso();
        invoice.updatedAt = line.updatedAt;
        return presentLine(line);
      }, true);
    },
    quoteLineRate(userId, input) {
      return enqueue((data) => {
        const invoice = findInvoice(data, userId, input.invoiceId);
        const line = findLine(invoice, input.lineId);
        const rateMinor = assertMinor(input.rateMinor, "Rate");
        assertRateWrite(invoice.status, line.rateMinor, rateMinor);
        line.rateMinor = rateMinor;
        line.updatedAt = nowIso();
        invoice.updatedAt = line.updatedAt;
        return presentLine(line);
      }, true);
    },
    setLineQuantity(userId, input) {
      return enqueue((data) => {
        const invoice = findInvoice(data, userId, input.invoiceId);
        const line = findLine(invoice, input.lineId);
        const quantity = assertQuantity(input.quantity);
        assertQuantityWrite(invoice.status, line.quantity, quantity);
        line.quantity = quantity;
        line.updatedAt = nowIso();
        invoice.updatedAt = line.updatedAt;
        return presentLine(line);
      }, true);
    },
    setInvoiceDue(userId, input) {
      return enqueue((data) => {
        const invoice = findInvoice(data, userId, input.invoiceId);
        const dueOn = assertDate(input.dueOn);
        assertDueWrite(invoice.status, invoice.dueOn, dueOn);
        invoice.dueOn = dueOn;
        invoice.updatedAt = nowIso();
        return { dueOn };
      }, true);
    },
    writeLateTerms(userId, input) {
      return enqueue((data) => {
        const invoice = findInvoice(data, userId, input.invoiceId);
        const next = normalizeLate(input);
        assertLateWrite(invoice.status, invoice.lateTerms, next);
        const note = cleanText(input.note, "Late note", 1000);
        const stamp = nowIso();
        invoice.lateTerms = { ...next, note, updatedAt: stamp };
        invoice.updatedAt = stamp;
        return invoice.lateTerms;
      }, true);
    },
    offerDiscount(userId, input) {
      return enqueue((data) => {
        const invoice = findInvoice(data, userId, input.invoiceId);
        const kind = assertDiscountKind(input.kind);
        const value = assertDiscountValue(kind, input.value);
        assertDiscountWrite(invoice.status, invoice.discount, kind, value);
        const note = cleanText(input.note, "Discount note", 1000);
        const stamp = nowIso();
        invoice.discount = { kind, value, note, updatedAt: stamp };
        invoice.updatedAt = stamp;
        return invoice.discount;
      }, true);
    },
    sealInvoice(userId, invoiceId) {
      return enqueue((data) => {
        const invoice = findInvoice(data, userId, invoiceId);
        if (invoice.status === "approved") return toRecord(invoice);
        if (invoice.lines.length === 0) throw new InvoiceUserError("A line is required before the invoice can be sealed.");
        if (!invoice.dueOn) throw new InvoiceUserError("A due date is required before the invoice can be sealed.");
        if (!invoice.lateTerms) throw new InvoiceUserError("Late terms are required before the invoice can be sealed.");
        const stamp = nowIso();
        invoice.status = "approved";
        invoice.approvedAt = stamp;
        invoice.updatedAt = stamp;
        return toRecord(invoice);
      }, true);
    },
    suggestInvoiceChange(userId, input) {
      return enqueue((data) => {
        const invoice = findInvoice(data, userId, input.invoiceId);
        if (invoice.status !== "approved") throw new InvoiceUserError("Seal the invoice before suggesting a change.");
        if (invoice.changes.length >= MAX_CHANGES) throw new InvoiceUserError("Invoice change limit reached.");
        const summaryText = cleanText(input.summary, "Summary", 1000);
        const change = blankChange(input.kind, summaryText);
        if (input.kind === "add_line") {
          if (invoice.lines.length >= MAX_LINES) throw new InvoiceUserError("Line limit reached.");
          change.description = cleanText(input.description ?? "", "Description", 500);
          change.quantity = assertQuantity(input.quantity ?? Number.NaN);
          change.rateMinor = assertMinor(input.rateMinor ?? Number.NaN, "Rate");
          change.unit = assertUnit(input.unit ?? "");
        } else if (input.kind === "change_rate") {
          if (!input.lineId) throw new InvoiceUserError("Line not found");
          const line = findLine(invoice, input.lineId);
          change.lineId = line.id;
          change.rateMinor = assertMinor(input.rateMinor ?? Number.NaN, "Rate");
          if (change.rateMinor === line.rateMinor) throw new InvoiceUserError("That change does not change the rate.");
        } else if (input.kind === "apply_discount") {
          const kind = assertDiscountKind(input.discountKind ?? "");
          const value = assertDiscountValue(kind, input.discountValue ?? (kind === "none" ? 0 : Number.NaN));
          if (sameDiscount(invoice.discount, kind, value)) throw new InvoiceUserError("That change does not alter the discount.");
          change.discountKind = kind;
          change.discountValue = value;
          change.discountNote = cleanText(input.discountNote ?? input.summary, "Discount note", 1000);
        } else if (input.kind === "move_due_date") {
          change.dueOn = assertDate(input.dueOn ?? "");
          if (change.dueOn === invoice.dueOn) throw new InvoiceUserError("That change does not move the due date.");
        } else if (input.kind === "adjust_quantity") {
          if (!input.lineId) throw new InvoiceUserError("Line not found");
          const line = findLine(invoice, input.lineId);
          change.lineId = line.id;
          change.quantity = assertQuantity(input.quantity ?? Number.NaN);
          if (change.quantity === line.quantity) throw new InvoiceUserError("That change does not change the quantity.");
        } else if (input.kind === "revise_late_terms") {
          if (!invoice.lateTerms) throw new InvoiceUserError("Late terms are required before they can be revised.");
          const next = normalizeLate({
            graceDays: input.graceDays ?? Number.NaN,
            basis: input.lateBasis ?? "",
            feeMinor: input.feeMinor ?? 0,
            percent: input.latePercent ?? 0
          });
          if (lateMatches(invoice.lateTerms, next)) throw new InvoiceUserError("That change does not revise the late terms.");
          change.graceDays = next.graceDays;
          change.lateBasis = next.basis;
          change.feeMinor = next.feeMinor;
          change.latePercent = next.percent;
          change.lateNote = cleanText(input.lateNote ?? input.summary, "Late note", 1000);
        } else {
          throw new InvoiceUserError("Unknown invoice change.");
        }
        invoice.changes.unshift(change);
        invoice.updatedAt = change.createdAt;
        return change;
      }, true);
    },
    acceptInvoiceChange(userId, invoiceId, changeId) {
      return enqueue((data) => {
        const invoice = findInvoice(data, userId, invoiceId);
        const change = invoice.changes.find((row) => row.id === changeId);
        if (!change) throw new InvoiceUserError("Invoice change not found");
        if (change.applied) return toRecord(invoice);
        if (invoice.status !== "approved") throw new InvoiceUserError("Seal the invoice before suggesting a change.");
        const stamp = nowIso();
        if (change.kind === "add_line") {
          if (!change.description || change.quantity === null || change.rateMinor === null || !change.unit) {
            throw new InvoiceUserError("That line could not be added.");
          }
          if (invoice.lines.length >= MAX_LINES) throw new InvoiceUserError("Line limit reached.");
          invoice.lines.push({
            id: randomUUID(),
            description: change.description,
            quantity: change.quantity,
            rateMinor: change.rateMinor,
            unit: change.unit,
            createdAt: stamp,
            updatedAt: stamp
          });
        } else if (change.kind === "change_rate") {
          if (!change.lineId || change.rateMinor === null) throw new InvoiceUserError("Line not found");
          const line = findLine(invoice, change.lineId);
          line.rateMinor = change.rateMinor;
          line.updatedAt = stamp;
        } else if (change.kind === "apply_discount") {
          if (!change.discountKind || change.discountValue === null || !change.discountNote) {
            throw new InvoiceUserError("That discount could not be applied.");
          }
          invoice.discount = {
            kind: change.discountKind,
            value: change.discountValue,
            note: change.discountNote,
            updatedAt: stamp
          };
        } else if (change.kind === "move_due_date") {
          if (!change.dueOn) throw new InvoiceUserError("Due date must be a calendar date.");
          invoice.dueOn = change.dueOn;
        } else if (change.kind === "adjust_quantity") {
          if (!change.lineId || change.quantity === null) throw new InvoiceUserError("Line not found");
          const line = findLine(invoice, change.lineId);
          line.quantity = change.quantity;
          line.updatedAt = stamp;
        } else if (change.kind === "revise_late_terms") {
          if (change.graceDays === null || !change.lateBasis || change.feeMinor === null || change.latePercent === null || !change.lateNote) {
            throw new InvoiceUserError("Late terms could not be revised.");
          }
          invoice.lateTerms = {
            graceDays: change.graceDays,
            basis: change.lateBasis,
            feeMinor: change.feeMinor,
            percent: change.latePercent,
            note: change.lateNote,
            updatedAt: stamp
          };
        }
        change.status = "approved";
        change.applied = true;
        change.approvedAt = stamp;
        invoice.updatedAt = stamp;
        return toRecord(invoice);
      }, true);
    },
    addSupportRequest(input) {
      return enqueue((data) => {
        const request: SupportRequest = {
          id: randomUUID(),
          email: input.email,
          message: input.message,
          createdAt: nowIso()
        };
        data.supportRequests.push(request);
        if (data.supportRequests.length > MAX_SUPPORT) data.supportRequests.splice(0, data.supportRequests.length - MAX_SUPPORT);
        return { id: request.id };
      }, true);
    }
  };
}

export function isInvoiceRefusal(error: unknown): error is InvoiceRefusal {
  return error instanceof InvoiceRefusal;
}
