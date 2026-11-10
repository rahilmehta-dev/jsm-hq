# Project rooms: put any project in the office

A **project room** is a room in the My HQ office for your project's own workers: a script that fetches emails, a local model that writes them, a bot that sends them, a scraper, a build job. They aren't coding agents. Any project, in any language, can create its room and tell My HQ what its workers are doing, and the office shows it live: robots typing at their desks, envelopes flying from one worker to the next, red alerts on errors.

The idea: your project makes a few HTTP calls. My HQ draws them.

## Quick start

1. Run My HQ on a repo (`pnpm hq -- --repo <path>`).
2. Open **Settings → Team → Project room → Connect a project**. Copy the address and token (they're also in `~/.jsmhq/<project>/room-token`).
3. In your project, set two environment variables:

   ```bash
   export HQ_ROOM_URL=http://127.0.0.1:7420
   export HQ_ROOM_TOKEN=<the token>
   ```

4. Create the room once, then report work as it happens. Try it with `curl`:

   ```bash
   # create the room: three workers
   curl -s -X PUT $HQ_ROOM_URL/room -H "Authorization: Bearer $HQ_ROOM_TOKEN" -d '{
     "name": "Job referrals", "demo": false,
     "workers": [
       {"id": "fetcher", "name": "Mailbot", "kind": "fetcher"},
       {"id": "writer",  "name": "Quill",   "kind": "writer"},
       {"id": "sender",  "name": "Postie",  "kind": "sender"}
     ]}'

   # Mailbot starts working, with a note in its bubble
   curl -s -X POST $HQ_ROOM_URL/room/event -H "Authorization: Bearer $HQ_ROOM_TOKEN" \
     -d '{"worker": "fetcher", "state": "working", "note": "Fetching 12 emails"}'

   # an envelope flies from Mailbot to Quill
   curl -s -X POST $HQ_ROOM_URL/room/event -H "Authorization: Bearer $HQ_ROOM_TOKEN" \
     -d '{"handoff": {"from": "fetcher", "to": "writer"}}'
   ```

## Small libraries

Copy one file into your project. They never raise: if My HQ isn't running your project carries on.

- Python (standard library only): [`sdk/python/jsmhq_room.py`](../sdk/python/jsmhq_room.py)
- Node 18+ (no dependencies): [`sdk/node/jsmhq-room.mjs`](../sdk/node/jsmhq-room.mjs)

```python
from jsmhq_room import Room

room = Room()  # reads HQ_ROOM_URL and HQ_ROOM_TOKEN
room.setup("Job referrals", [
    {"id": "fetcher", "name": "Mailbot", "kind": "fetcher"},
    {"id": "writer", "name": "Quill", "kind": "writer"},
    {"id": "sender", "name": "Postie", "kind": "sender"},
])

with room.working("fetcher", "Fetching 12 emails"):   # working, then done (error if it raises)
    emails = fetch_emails()
room.handoff("writer", frm="fetcher")                 # an envelope flies to the writer
with room.working("writer", "Drafting to Priya"):
    draft = write_email(emails[0])
room.handoff("sender", frm="writer")
```

## API

Local only (127.0.0.1) and protected by the project-room token, sent as `Authorization: Bearer <token>`. It's a different token from the one agents and the browser use.

| Call | Body | Does |
| --- | --- | --- |
| `GET /room` | | The room, and each worker's latest status |
| `PUT /room` | `{ name, workers: [{ id?, name, kind?, color? }], demo? }` | Creates or replaces the room (up to 12 workers). `kind` is `fetcher`, `writer`, `sender` or `custom` and sets the desk's prop. Keep your `id`s stable so events keep matching. `demo: false` turns off the demo animation. |
| `POST /room/event` | `{ worker, state?, note?, ttl? }` | Sets what a worker is doing. `worker` is its id or name. `state` is `idle`, `working` (default), `error` or `done`. `note` (up to 60 characters) shows above its head. `ttl` is how many seconds the status holds before the worker goes back to idle (default 120; 8 for `done`). |
| `POST /room/event` | `{ handoff: { from?, to } }` | An envelope flies from a worker (or `"in"`, the in-tray; default: the event's own `worker`) to another worker (or `"out"`, the out-tray). You can send `worker` and `handoff` together. |

Errors come back as `{ "error": "…" }` with a 4xx status (`401` wrong token, `404` unknown worker or no room yet).

## Notes

- **Until a project connects**, the room plays a looping demo so you can see it. The first real status ends the demo; or tick **Play the demo until a project connects** off in Settings.
- **The room is saved** in `.jsmhq/config.json` (its workers), so it comes back when My HQ restarts. Statuses are live only and aren't saved.
- **Remove it** in Settings → Team → Project room, or `PUT /room` again with different workers.
- **Not an agent.** Project-room workers have no terminal, sandbox or tasks. If you want a coding agent to work on the project, add it to the team as usual.

## Letting the lead set it up

You don't have to open Settings. Ask the lead (for example Michelle) to "make a project room for the referral project with a fetcher, a writer and a sender". The lead has a `setup_project_room` tool that creates the room and returns the endpoint, the env var names and the client file. The lead never writes code, so she creates a task for a builder agent, who adds the client and the calls to the project. The room token is never given to the agents: you set `HQ_ROOM_TOKEN` in the project's environment yourself (Settings, Team, Project room, copy).

Only the lead can call the tool; workers get an error. Calling it again replaces the room.
