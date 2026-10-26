# n8n-nodes-deskwoot

Deskwoot nodes for n8n. Start a workflow when something happens in Deskwoot, and reply, assign, label and update contacts in Deskwoot from your workflows.

[Deskwoot](https://deskwoot.com) is a customer support platform with one shared inbox for email, live chat, WhatsApp, Telegram, LINE, SMS and X direct messages. [n8n](https://n8n.io/) is a workflow automation platform.

* [What you need](#what-you-need)
* [Installation](#installation)
* [Credentials](#credentials)
* [Deskwoot Trigger](#deskwoot-trigger)
* [Deskwoot node](#deskwoot-node)
* [Example workflow](#example-workflow)
* [Without the Enterprise plan: webhooks](#without-the-enterprise-plan-webhooks)
* [Compatibility](#compatibility)
* [Development](#development)
* [Resources](#resources)

## What you need

* **n8n that you run yourself.** n8n Cloud only offers community nodes that n8n has verified, and this node is not verified yet.
* **A Deskwoot workspace on the Enterprise plan.** Both nodes sign in with the Deskwoot REST API, which is part of the Enterprise plan. A trial does not include API access. On another plan, send Deskwoot events to n8n with webhooks instead: see [Without the Enterprise plan](#without-the-enterprise-plan-webhooks).
* **For the Deskwoot Trigger:** an API token created by an administrator of the workspace, and an n8n that Deskwoot can reach from the internet over HTTPS.

## Installation

1. In n8n, go to **Settings > Community Nodes**. Only the owner and admins of your n8n see this page.
2. Click **Install**, type `n8n-nodes-deskwoot` into **Enter npm package name** and install it.

n8n's [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) explains the steps and the other ways to install.

## Credentials

1. In Deskwoot, go to **Settings > API Tokens** and create a token with the scopes **Read** and **Write**. Copy it: Deskwoot shows it only once. Create it as an administrator if you want to use the Deskwoot Trigger, because only an administrator's token can turn on Deskwoot triggers.
2. In n8n, create a **Deskwoot API** credential:
   * **API Token**: the token you just copied.
   * **Account ID**: shown on the same Deskwoot page under **Your Account ID**.
   * **Base URL**: leave `https://deskwoot.com` as it is, unless Deskwoot gave you another address.
3. Save. n8n tests the credential by listing the inboxes of your workspace.

If the test fails:

* **Deskwoot did not accept the token:** the token was revoked or has expired, the account ID belongs to another workspace, or it is an MCP token for AI agents, which does not work here. Create a REST API token under Settings > API Tokens.
* **Deskwoot refused the token:** the workspace is not on the Enterprise plan, or the token lacks the scope Read.

Replies and notes that n8n sends show the name of the person who created the API token.

## Deskwoot Trigger

Starts the workflow when one of these events happens in Deskwoot:

| Event | When it starts |
| --- | --- |
| Conversation Created | A conversation starts, whether a customer wrote in or your team started it. |
| Customer Message Received | A customer writes in a conversation. Replies and notes from your team do not count. |
| Conversation Assigned | A conversation gets a new assignee. Round robin on a new conversation and automation rules do not set it off. |
| Conversation Resolved | A conversation is marked resolved. |
| Contact Created | A teammate adds a contact in Deskwoot, or an app adds one through the API. Contacts that Deskwoot creates from incoming messages start Conversation Created instead. |
| Conversation Rated | A customer rates a conversation in the satisfaction survey. |

Each event arrives as one item with plain fields. A conversation comes with its ID, number, link, status, subject, channel, inbox, assignee, team, labels, the customer's name, email address and phone number, and the customer's first message. Every item also says which event it is (`trigger`), when it happened (`occurredAt`) and, when an AI agent set it off, which one (`actorType`, `actorName`).

**How it works.** When you publish the workflow, the node subscribes its Production URL to the event in Deskwoot. When you unpublish the workflow, the node removes that subscription again. If Deskwoot cannot be reached at that moment or refuses the removal, the node keeps the subscription and uses it again the next time you publish. While you test the trigger in the editor, n8n subscribes its Test URL for a short time. Then create a real event in Deskwoot, for example by writing to one of your inboxes.

**Every event is checked.** Deskwoot signs each event: the header `X-Deskwoot-Signature` holds `sha256=` followed by the HMAC SHA256 of the raw request body, made with a secret that Deskwoot hands to the node only when the node subscribes. The node checks that signature and answers 401 to any request without a valid one, so nobody else can start your workflow through its URL.

**Good to know:**

* Deskwoot only sends events to public HTTPS addresses. If n8n runs behind a reverse proxy, set n8n's `WEBHOOK_URL` to its public address, so the URLs the node subscribes are the ones Deskwoot can reach.
* A workspace can hold at most 100 of these subscriptions, together with the triggers of the Deskwoot app for Zapier.
* Revoking the API token stops every trigger it turned on at once. Create a new token, update the credential, then unpublish and publish the workflow again.

## Deskwoot node

**Conversation**

* **Start:** sends a first message to a contact from one of your inboxes, by email address, phone number or contact ID. It works where a business may write first, such as email or SMS. Deskwoot refuses a start that the channel cannot deliver (a live chat, WhatsApp without an approved template, or a Telegram, LINE or X user who never wrote to that inbox), and the node shows the reason.
* **Reply:** sends a reply to the customer on the conversation's channel.
* **Add Private Note:** adds a note that only your team sees.
* **Assign:** assigns a conversation to a teammate, a team, or both.
* **Add Label:** adds one of your labels to a conversation.

**Contact**

* **Create or Update:** updates the contact with this email address, or creates it when there is none.
* **Find:** returns the one contact that best matches an email address, phone number or name, an exact match first. When no contact matches, it returns nothing.

Take the conversation ID from the Deskwoot Trigger, for example. The node also works as a tool for n8n's AI agents.

## Example workflow

A private note on every new customer message:

1. Add a **Deskwoot Trigger**, pick your **Deskwoot API** credential and set **Event** to **Customer Message Received**.
2. Add a **Deskwoot** node after it. Set **Resource** to **Conversation** and **Operation** to **Add Private Note**.
3. Set **Conversation ID** to `{{ $json.conversationId }}`. Write the **Note**, for example `Checked by n8n for {{ $json.contactEmail }}`, or use the result of a step in between, such as an order lookup in your shop.
4. Publish the workflow. From now on, each message a customer writes gets a note that only your team sees.

## Without the Enterprise plan: webhooks

On the Startup, Business and Enterprise plans, and during the trial, Deskwoot can send events to n8n's own **Webhook** node. The free Hacker plan sends no webhooks. This way only sends events out of Deskwoot: to change something in Deskwoot from n8n, you need the Deskwoot node and the Enterprise plan.

1. In n8n, add a **Webhook** node, set **HTTP Method** to **POST** and copy its **Production URL**.
2. Publish the workflow. n8n only listens on the Production URL while the workflow is published.
3. In Deskwoot, go to **Settings > Webhooks** (administrators only) and click **Add Webhook**. Paste the URL under **Endpoint URL**, tick the events you want under **Subscribe to Events** (with none ticked, the webhook gets every event except ticket events) and click **Create Webhook**.

Each event arrives as JSON with the fields `event`, `data`, `timestamp` and `accountId`. Keep the Webhook node's **Respond** option on **Immediately**: Deskwoot waits 10 seconds at most for an answer.

Deskwoot signs these requests too, but its dashboard never shows the secret of a webhook made there, so the Webhook node cannot check the signature. Treat the Production URL like a password instead: n8n makes its path random, and anyone who knows the URL can send requests to it.

## Compatibility

Built with n8n's node tooling (`@n8n/node-cli` 0.53.4) against `n8n-workflow` 2.44.2, the version in n8n 2.44.

## Development

```bash
npm install
npm run build   # compiles to dist
npm run lint    # n8n's lint rules for community nodes
npm test        # every HTTP call in the tests is a fake
```

## Resources

* [Deskwoot and n8n](https://help.deskwoot.com/n8n-integration)
* [n8n community nodes](https://docs.n8n.io/integrations/community-nodes/installation/)

## License

[MIT](LICENSE)
