import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { REFUSED_DISCOUNT, REFUSED_DUE, REFUSED_NEW_LINE, REFUSED_QUANTITY, REFUSED_RATE } from "../src/invoice-policy.js";
import { assertInvoiceDataPath, createFileInvoiceStore, defaultInvoiceDataPath } from "../src/invoice-store.js";

async function store() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "invoice-"));
  return createFileInvoiceStore(path.join(dir, "invoice.json"));
}

async function approved() {
  const saved = await store();
  const invoice = await saved.beginInvoice("user-1", {
    clientName: "Northwind",
    title: "March design",
    number: "INV-104",
    currency: "usd"
  });
  const line = await saved.placeLine("user-1", {
    invoiceId: invoice.id,
    description: "Homepage revisions",
    quantity: 6,
    rateMinor: 15000,
    unit: "hour"
  });
  await saved.setInvoiceDue("user-1", { invoiceId: invoice.id, dueOn: "2026-04-15" });
  await saved.writeLateTerms("user-1", {
    invoiceId: invoice.id,
    graceDays: 7,
    basis: "percent_per_period",
    feeMinor: 0,
    percent: 2,
    note: "Two percent of the open balance each month after the grace period."
  });
  await saved.sealInvoice("user-1", invoice.id);
  return { saved, invoiceId: invoice.id, lineId: line.id };
}

describe("invoice store", () => {
  it("uses its own data file", () => {
    expect(defaultInvoiceDataPath()).toBe(path.join(os.homedir(), ".invoice", "invoice.json"));
    expect(() => assertInvoiceDataPath(path.join(os.homedir(), ".scope", "scope.json"))).toThrow(/own file/);
    expect(() => assertInvoiceDataPath(path.join(os.homedir(), ".retain", "retain.json"))).toThrow(/own file/);
  });

  it("refuses a new line, a changed rate, a discount, and a moved due date after approval", async () => {
    const { saved, invoiceId, lineId } = await approved();

    await expect(saved.placeLine("user-1", {
      invoiceId,
      description: "Extra campaign",
      quantity: 1,
      rateMinor: 40000,
      unit: "each"
    })).rejects.toThrow(REFUSED_NEW_LINE);

    await expect(saved.quoteLineRate("user-1", {
      invoiceId,
      lineId,
      rateMinor: 9000
    })).rejects.toThrow(REFUSED_RATE);

    const sameRate = await saved.quoteLineRate("user-1", { invoiceId, lineId, rateMinor: 15000 });
    expect(sameRate.rateMinor).toBe(15000);
    expect(sameRate.extendedMinor).toBe(90000);

    await expect(saved.offerDiscount("user-1", {
      invoiceId,
      kind: "percent",
      value: 15,
      note: "Please take something off."
    })).rejects.toThrow(REFUSED_DISCOUNT);

    await expect(saved.setInvoiceDue("user-1", {
      invoiceId,
      dueOn: "2026-06-01"
    })).rejects.toThrow(REFUSED_DUE);

    await expect(saved.setLineQuantity("user-1", {
      invoiceId,
      lineId,
      quantity: 8
    })).rejects.toThrow(REFUSED_QUANTITY);

    const before = await saved.readInvoice("user-1", invoiceId);
    expect(before.invoice.status).toBe("approved");
    expect(before.lines).toHaveLength(1);
    expect(before.discount).toBeNull();
    expect(before.dueOn).toBe("2026-04-15");
    expect(before.proposedChanges).toHaveLength(0);

    const suggestedLine = await saved.suggestInvoiceChange("user-1", {
      invoiceId,
      kind: "add_line",
      summary: "Client asked for a second page.",
      description: "About page",
      quantity: 1,
      rateMinor: 25000,
      unit: "each"
    });
    expect(suggestedLine.status).toBe("proposed");
    expect(suggestedLine.applied).toBe(false);
    expect((await saved.readInvoice("user-1", invoiceId)).lines).toHaveLength(1);

    const withLine = await saved.acceptInvoiceChange("user-1", invoiceId, suggestedLine.id);
    expect(withLine.lines.map((row) => row.description)).toContain("About page");
    const again = await saved.acceptInvoiceChange("user-1", invoiceId, suggestedLine.id);
    expect(again.lines.filter((row) => row.description === "About page")).toHaveLength(1);

    const suggestedRate = await saved.suggestInvoiceChange("user-1", {
      invoiceId,
      kind: "change_rate",
      summary: "Freelancer approved a higher rate on the homepage line.",
      lineId,
      rateMinor: 18000
    });
    const rated = await saved.acceptInvoiceChange("user-1", invoiceId, suggestedRate.id);
    expect(rated.lines.find((row) => row.id === lineId)?.rateMinor).toBe(18000);

    const suggestedDiscount = await saved.suggestInvoiceChange("user-1", {
      invoiceId,
      kind: "apply_discount",
      summary: "Freelancer approved a percent reduction.",
      discountKind: "percent",
      discountValue: 10,
      discountNote: "Approved reduction on this invoice."
    });
    const discounted = await saved.acceptInvoiceChange("user-1", invoiceId, suggestedDiscount.id);
    expect(discounted.discount).toMatchObject({ kind: "percent", value: 10 });

    const suggestedDue = await saved.suggestInvoiceChange("user-1", {
      invoiceId,
      kind: "move_due_date",
      summary: "Freelancer approved a later due date.",
      dueOn: "2026-05-01"
    });
    const moved = await saved.acceptInvoiceChange("user-1", invoiceId, suggestedDue.id);
    expect(moved.dueOn).toBe("2026-05-01");
    expect(moved.guidance).toContain("invent a discount");
    expect(moved.approvedChanges.every((change) => change.applied)).toBe(true);
  });

  it("keeps each freelancer's invoice and reloads it from disk", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "invoice-"));
    const file = path.join(dir, "invoice.json");
    const first = createFileInvoiceStore(file);
    const invoice = await first.beginInvoice("user-1", {
      clientName: "Ada",
      title: "Writing invoice",
      number: "INV-9",
      currency: "EUR"
    });
    await expect(first.readInvoice("user-2", invoice.id)).rejects.toThrow("Invoice not found");
    const second = createFileInvoiceStore(file);
    const listed = await second.listInvoices("user-1", 0);
    expect(listed.invoices[0]?.id).toBe(invoice.id);
    expect(listed.invoices[0]?.currency).toBe("EUR");
    expect(await second.listInvoices("user-2", 0)).toEqual({ invoices: [], nextOffset: null });
  });
});
