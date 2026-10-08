# Invoice

Invoice keeps a freelancer's approved invoice — line items, quantities, the rate already approved, the due date, and late terms — then lets an assistant read that record before it answers. An assistant cannot add a line, change a rate, invent a discount, or move a due date unless that change is explicitly approved.

It works with ChatGPT, Claude, Gemini, Grok, and Cursor, plus any other MCP client that can do Streamable HTTP and OAuth. It is not a ChatGPT-only plugin.

Sign in with your Invoice account when the assistant opens OAuth. Do not paste an API key or password into a header. Invoice supports dynamic client registration: leave the client id and secret empty. The protected-resource metadata at `/.well-known/oauth-protected-resource/mcp` points clients at the OAuth issuer, which registers them.

Invoice tools need Pro or an active trial. A new subscription includes a 14-day trial. This page does not list a price. Checkout shows the billing interval and payment terms. Amounts stored on an invoice are the freelancer's approved figures, in whole minor units of the invoice currency. They are not a product price.

To self-host, run the server and use the base URL you configure. The default MCP address is `http://127.0.0.1:3000/mcp`.

## Hosted server

- MCP server URL: `https://invoice-continuity2.vercel.app/mcp` (Streamable HTTP, OAuth sign-in)
- Docs: https://ouroborosapps.com/docs/invoice
- Status: early access. Paste the URL into Claude, Cursor, Grok, or ChatGPT developer mode.
- Registry name: `io.github.LAHutchins91/invoice`

## What the assistant can do

After you approve the connection, the server exposes these tools:

- list_invoices
- begin_invoice
- read_invoice
- place_line
- describe_line
- quote_line_rate
- set_line_quantity
- set_invoice_due
- write_late_terms
- offer_discount
- seal_invoice
- suggest_invoice_change
- accept_invoice_change

`read_invoice` is the read the assistant should do before it answers. Draft figures are not an approved commitment. A suggested invoice change does not change the record. After the invoice is sealed, `place_line` refuses a new line, `quote_line_rate` refuses a changed rate, `offer_discount` refuses a discount, and `set_invoice_due` refuses a moved due date. Those changes go through `suggest_invoice_change` and then `accept_invoice_change`, and only when you explicitly approve that change.

The assistant only calls these tools when you and the host allow it.

## Connect

Cursor, in `~/.cursor/mcp.json` or a project `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "invoice": {
      "url": "http://127.0.0.1:3000/mcp"
    }
  }
}
```

Do not add a headers block. Cursor registers a client and opens sign-in.

Claude Code:

```bash
claude mcp add --transport http invoice http://127.0.0.1:3000/mcp
```

Do not pass an Authorization header. Other clients use the same address, choose OAuth, and leave client id and secret empty. Steps for ChatGPT, Claude, Gemini, Grok, and Cursor are on the connect page at `/connect`.

Registry metadata for this server is in `server.json` (`io.github.LAHutchins91/invoice`). The remote URL there is `https://invoice-continuity2.vercel.app/mcp`.

## Run

```bash
npm install
npm test
npm run typecheck
npm run build
npm start
```

When stdin is a terminal, Invoice serves Streamable HTTP on port 3000. When stdin is not a terminal, it speaks MCP over stdio and still opens the HTTP port. Logs during stdio mode go to stderr so they do not mix with the protocol.

Records are stored durably in a JSON file. The default path is `~/.invoice/invoice.json`. Set `INVOICE_DATA_PATH` to move it. One server process owns that file. Do not point it at another product's data file.

OAuth uses the same idea as a Supabase authorization server with dynamic client registration. Set these on the server process, not in an MCP header:

- `APP_BASE_URL` (default `http://localhost:3000`)
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_MONTHLY` and `STRIPE_PRICE_YEARLY` (Stripe catalog ids, not prices)
- `OPENAI_APPS_CHALLENGE` (optional; when set, `/.well-known/openai-apps-challenge` returns that token as plain text)

Tool calls other than discovery require a signed-in account whose subscription status is `active` or `trialing`.

---

More from Ouroboros: https://ouroborosapps.com
