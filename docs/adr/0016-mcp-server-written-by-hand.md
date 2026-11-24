# 0016. The MCP server speaks the protocol by hand

- Status: Accepted
- Date: 2026-11-24

## Context and problem statement

An AI assistant should be able to run the checks itself. The Model Context Protocol is how assistants call tools, and its usual transport for a local tool is standard input and output: one JSON-RPC message per line.

The official TypeScript SDK covers the whole protocol, including HTTP transports and authentication. Installed, it brings 91 packages and 26 MB, among them a web framework. The tool has one runtime dependency today.

## Considered options

- The official SDK as a runtime dependency
- A hand-written server for the part of the protocol the tool uses
- No MCP server. The assistant runs the command and reads the report file

## Decision outcome

A hand-written server in `src/mcp/`. It handles `initialize`, `ping`, `tools/list`, `tools/call`, progress notifications and cancellation over standard input and output.

That part of the protocol is small and has stayed the same across its versions. Writing it takes less code than the SDK takes megabytes, and the package keeps its one dependency. The official SDK is a development dependency: a test starts the server and talks to it with the official client, so a mistake in the protocol fails the build.

Running the command and reading the file works without any of this, and the report is written for that. A server adds what a command cannot: the assistant finds the tool by itself, gets progress while it waits, and pages through findings without loading a whole file.

## Consequences

- A new protocol version that changes these messages needs a change here. The server answers with the version the client asks for when it knows it, and with a known one otherwise.
- There is no HTTP transport. A client must be able to start a local command.
- `run_checks` returns the Markdown report as text. The report was shaped for an assistant, so the tool does not need a second format.
- Tool arguments are checked against their schema before the tool runs.
