# 0014. The local web page is a built React page with shadcn/ui, fed by server-sent events

- Status: Accepted
- Date: 2026-11-24

## Context and problem statement

The tool needs a page where someone picks a folder, starts a run, watches it and reads the findings. The page runs on the user's machine, next to a server that can read the disk and start processes.

A first version was plain HTML, CSS and JavaScript with its own look. The maintainer chose shadcn/ui instead.

## Considered options

For the page:

- Hand-written HTML, CSS and JavaScript with no build step
- React with shadcn/ui components, built with Vite

For live progress:

- WebSocket
- Server-sent events

## Decision outcome

The page is a React app in `ui/`, built with Vite and Tailwind and made of shadcn/ui components. `npm run build` puts the result in `ui/dist`, the package ships that folder, and the server in `src/ui/server.ts` serves it.

shadcn/ui gives the page controls that people already know how to use, with keyboard and screen reader support that hand-written controls would have to earn again. The cost is a build step and a second `package.json`.

Progress goes over server-sent events. The page only listens, and it sends its few commands as ordinary requests. Node serves an event stream with the `http` module alone, while a WebSocket server needs a dependency or a hand-written protocol. On connect the server first sends everything that happened in the current run, so a page that opens late or reloads shows the right state.

## Consequences

- The server has no runtime dependency for the page. React and the components are build-time dependencies in `ui/package.json`.
- The font, Geist, is bundled. The page makes no request to another host.
- The content security policy allows inline styles, because the components set them. Scripts stay limited to the page's own files.
- Logic that does not need the browser lives in `ui/src/lib/run.ts`, and the root test suite tests it.
- The shadcn MCP server is set up in `.mcp.json` for agents that add or change components.
- [Architecture](../explanation/architecture.md) used to say WebSocket. This record replaces that.
