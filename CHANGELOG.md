# Changelog

## 0.1.0

First version, not published yet.

* **Deskwoot Trigger:** starts a workflow on 6 Deskwoot events: Conversation Created, Customer Message Received, Conversation Assigned, Conversation Resolved, Contact Created and Conversation Rated. Publishing the workflow subscribes the node in Deskwoot, and unpublishing removes the subscription. The node checks the `X-Deskwoot-Signature` header of every event and answers 401 to any request without a valid one.
* **Deskwoot node:** Start, Reply, Add Private Note, Assign and Add Label for conversations; Create or Update and Find for contacts. It also works as a tool for n8n's AI agents.
* **Deskwoot API credential:** API token, Account ID and Base URL. n8n tests it by listing the inboxes of the workspace.
