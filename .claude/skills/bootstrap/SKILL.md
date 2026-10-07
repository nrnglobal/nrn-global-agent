---
name: bootstrap
description: One-time setup — propose the client domain → Asana project map from Asana projects and sent mail, and post it for Neil to confirm.
---

# Bootstrap

1. `asana_list_projects`. Ignore projects whose name starts with "Agent" or looks internal (templates, ops, personal).
2. For each remaining project, derive 1–3 likely domains from its name (brand → domain guess; a domain in the name wins) and confirm each with `gmail_sent_to(domain)`.
3. Build the proposed map: `domain | client_name | asana_project_gid | default_assignee`. Mark each row `confirmed` (sent mail exists to that domain) or `guess`.
4. `slack_post(tag_neil=true)` the table, under 40 rows, with: "Reply `ok` to load confirmed rows, `ok all` to load guesses too, or `<domain> → <project name>` per line to correct."
5. Do not write to `agent_clients` yet. The slack-reply skill loads rows when Neil answers.
6. `log_action("bootstrap_proposed", detail={rows})`.
