# Security Policy

## Reporting a vulnerability

Please report security problems **privately**, not in a public issue:

**[Report a vulnerability](https://github.com/xiaolai/vmark/security/advisories/new)** (GitHub private vulnerability reporting)

The form opens a draft advisory that only you and the maintainer can see. A useful report says:

- the VMark version (Settings → About) and your operating system,
- what an attacker can do, and what they need in order to do it (a crafted file, a web page, a connected AI client, local access),
- steps to reproduce, or a proof of concept.

If you are not sure whether something is a security problem, report it privately anyway.

## Supported versions

Only the **latest release** is supported. Fixes ship in a new release; they are not backported to older versions. VMark updates itself, so please check that the problem still exists in the [latest release](https://github.com/xiaolai/vmark/releases/latest) before reporting.

## What is in scope

Anything in this repository that lets someone cross a boundary VMark is supposed to hold. The parts most worth your attention:

| Area | What it does | Examples of a vulnerability |
|---|---|---|
| MCP bridge | Lets an AI client read and edit documents over a loopback WebSocket | Connecting without the token; reading or writing outside the open workspace; bypassing an approval prompt |
| Embedded browser | A web browser an AI assistant can drive under your approval, including `execute_js` | An action running without the approval it requires; a page reaching the editor, the app's commands or another site's session |
| Updater | Downloads and installs signed updates | Installing an update that is not signed by VMark; downgrading |
| File handling | Opens, previews, exports and saves files; renders Markdown, HTML, SVG and diagrams | A crafted document that runs script in the app, reads files outside the allowed scope, or overwrites a file you did not choose |
| Integrated terminal and AI providers | Runs your shell and the AI tools you configured | A document or web page causing a command to run; an API key leaving the operating system's credential store |

The [privacy page](https://vmark.app/guide/privacy) lists every network connection VMark makes and what it may read on disk; behaviour that contradicts that page is in scope too.

## What is out of scope

- What you or an AI assistant do with access you approved. Approving a prompt is the boundary; a risky action you allowed is not a bypass.
- Commands you type in the integrated terminal, and the behaviour of third-party AI tools (`claude`, `codex` and others) under their own accounts.
- Problems that need an attacker who already controls your user account or your machine.
- Vulnerabilities in a dependency with no way to reach them through VMark. A reachable one is in scope.

## What to expect

VMark is maintained by one person, so response is **best effort**: there is no guaranteed response time and no bug bounty. Reports are read and taken seriously, and a confirmed vulnerability is fixed in a normal release. Please give the maintainer a reasonable chance to release a fix before you publish details.
