import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PRO_REQUIRED, SIGN_IN_REQUIRED } from "../src/access.js";
import { createFileInvoiceStore, type InvoiceStore } from "../src/invoice-store.js";
import { INVOICE_TOOL_NAMES, createInvoiceMcpServer } from "../src/invoice-tools.js";

async function connect(options: { userId: string; entitled: boolean; store: InvoiceStore }) {
  const client = new Client({ name: "invoice-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createInvoiceMcpServer(options);
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ text?: string }> }).content;
  return content?.[0]?.text ?? "";
}

describe("invoice tools", () => {
  it("lists the Invoice tools", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "invoice-"));
    const client = await connect({ userId: "", entitled: false, store: createFileInvoiceStore(path.join(dir, "invoice.json")) });
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual([...INVOICE_TOOL_NAMES].sort());
    const blob = listed.tools.map((tool) => `${tool.name} ${tool.description ?? ""}`).join("\n");
    expect(blob).not.toMatch(/\$\d/);
    expect(blob.toLowerCase()).not.toContain("dollar");
  });

  it("refuses tool calls without sign-in or an active trial", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "invoice-"));
    const saved = createFileInvoiceStore(path.join(dir, "invoice.json"));
    const anonymous = await connect({ userId: "", entitled: false, store: saved });
    const signedOut = await anonymous.callTool({ name: "list_invoices", arguments: {} });
    expect(signedOut.isError).toBe(true);
    expect(textOf(signedOut)).toContain(SIGN_IN_REQUIRED);

    const unpaid = await connect({ userId: "user-1", entitled: false, store: saved });
    const blocked = await unpaid.callTool({ name: "list_invoices", arguments: {} });
    expect(blocked.isError).toBe(true);
    expect(textOf(blocked)).toContain(PRO_REQUIRED);
  });

  it("refuses a new line, a changed rate, a discount, and a moved due date unless the change is accepted", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "invoice-"));
    const saved = createFileInvoiceStore(path.join(dir, "invoice.json"));
    const client = await connect({ userId: "user-1", entitled: true, store: saved });
    const created = await client.callTool({
      name: "begin_invoice",
      arguments: { clientName: "Northwind", title: "March design", number: "INV-104", currency: "USD" }
    });
    const invoiceId = JSON.parse(textOf(created)).invoice.id as string;
    const placed = await client.callTool({
      name: "place_line",
      arguments: { invoiceId, description: "Homepage revisions", quantity: 4, rateMinor: 12000, unit: "hour" }
    });
    const lineId = JSON.parse(textOf(placed)).id as string;
    await client.callTool({
      name: "set_invoice_due",
      arguments: { invoiceId, dueOn: "2026-04-30" }
    });
    await client.callTool({
      name: "write_late_terms",
      arguments: { invoiceId, graceDays: 0, basis: "none", feeMinor: 0, percent: 0, note: "No late term on this invoice." }
    });
    await client.callTool({ name: "seal_invoice", arguments: { invoiceId, confirmed: true } });

    const extra = await client.callTool({
      name: "place_line",
      arguments: { invoiceId, description: "Rush weekend", quantity: 1, rateMinor: 20000, unit: "day" }
    });
    expect(extra.isError).toBe(true);
    expect(textOf(extra)).toContain("Refused:");

    const cheaper = await client.callTool({
      name: "quote_line_rate",
      arguments: { invoiceId, lineId, rateMinor: 1000 }
    });
    expect(cheaper.isError).toBe(true);
    expect(textOf(cheaper)).toContain("approved rate");

    const discount = await client.callTool({
      name: "offer_discount",
      arguments: { invoiceId, kind: "fixed", value: 5000, note: "Take this off." }
    });
    expect(discount.isError).toBe(true);
    expect(textOf(discount)).toContain("discount");

    const later = await client.callTool({
      name: "set_invoice_due",
      arguments: { invoiceId, dueOn: "2026-08-01" }
    });
    expect(later.isError).toBe(true);
    expect(textOf(later)).toContain("due date");

    const suggestion = await client.callTool({
      name: "suggest_invoice_change",
      arguments: {
        invoiceId,
        kind: "apply_discount",
        summary: "Freelancer approved a fixed reduction.",
        discountKind: "fixed",
        discountValue: 5000,
        discountNote: "Approved reduction."
      }
    });
    const changeId = JSON.parse(textOf(suggestion)).id as string;
    const pending = await client.callTool({ name: "read_invoice", arguments: { invoiceId } });
    expect(JSON.parse(textOf(pending)).discount).toBeNull();

    const applied = await client.callTool({
      name: "accept_invoice_change",
      arguments: { invoiceId, changeId, confirmed: true }
    });
    expect(JSON.parse(textOf(applied)).discount).toMatchObject({ kind: "fixed", value: 5000 });

    const read = await client.callTool({ name: "read_invoice", arguments: { invoiceId } });
    expect(textOf(read)).toContain("invent a discount");
    expect(JSON.parse(textOf(read)).dueOn).toBe("2026-04-30");
    expect(JSON.parse(textOf(read)).lines[0].rateMinor).toBe(12000);
  });
});
