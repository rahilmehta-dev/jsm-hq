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

## Several projects, several rooms

The office can hold one room per project. A room's **id** is a slug of its name (`Job referrals` → `job-referrals`), and each room has its own workers: worker ids only have to be unique inside their room, so two projects can both have a `fetcher`.

- **One room:** nothing changes. Leave the room id out of every call.
- **Several rooms:** say which is yours with `?room=<id>` (or `"room": "<id>"` in an event body). The libraries do it for you: `Room(room="job-referrals")` (Python), `new Room({ room: "job-referrals" })` (Node), or the `HQ_ROOM_ID` environment variable.
- A call that doesn't say which room, when there are several, gets a `400` that lists the ids (`{ "error": "…", "rooms": ["job-referrals", "web-scraper"] }`). An unknown id gets a `404` with the same list.
- `PUT /room` adds a room for a new name and replaces the room with the same name. To rename a room and keep its id, send the old id (`?room=<id>` or `"id"` in the body). Up to 12 rooms.
- Rooms saved before this (a single `projectRoom` in `.jsmhq/config.json`) load as one room, with its id made from its name.



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
| `GET /room` | | One room, and each worker's latest status (by the worker's own id), plus the ids of all rooms |
| `GET /rooms` | | Every room, each with its workers' latest status |
| `DELETE /room` | | Removes a room (`?room=<id>` when there are several) |
| `PUT /room` | `{ name, workers: [{ id?, name, kind?, color? }], demo?, id? }` | Creates or replaces a room (up to 12 workers). `kind` is `fetcher`, `writer`, `sender` or `custom` and sets the desk's prop. Keep your `id`s stable so events keep matching. `demo: false` turns off the demo animation. |
| `POST /room/event` | `{ worker, state?, note?, ttl? }` | Sets what a worker is doing. `worker` is its id or name. `state` is `idle`, `working` (default), `error` or `done`. `note` (up to 60 characters) shows above its head. `ttl` is how many seconds the status holds before the worker goes back to idle (default 120; 8 for `done`). |
| `POST /room/event` | `{ handoff: { from?, to } }` | An envelope flies from a worker (or `"in"`, the in-tray; default: the event's own `worker`) to another worker (or `"out"`, the out-tray). You can send `worker` and `handoff` together. |

Every call except `GET /rooms` takes the optional `?room=<id>` described above.

Errors come back as `{ "error": "…" }` with a 4xx status (`401` wrong token, `400` no room id when there are several, `404` unknown room, unknown worker or no room yet). Room errors also carry `rooms` (the ids), and an unknown worker carries `workers`.

## Notes

- **Until a project connects**, the room plays a looping demo so you can see it. The first real status ends the demo; or tick **Play the demo until a project connects** off in Settings.
- **The rooms are saved** in `.jsmhq/config.json` (`projectRooms`: each room's id, name and workers; `projectRoom` mirrors the first, for older versions), so they come back when My HQ restarts. Statuses are live only and aren't saved. In the app's state (`roomWorkers`) a status is kept under the worker's id when there is one room, and under `<roomId>/<workerId>` when there are several.
- **Remove it** in Settings → Team → Project room, or `PUT /room` again with different workers.
- **Not an agent.** Project-room workers have no terminal, sandbox or tasks. If you want a coding agent to work on the project, add it to the team as usual.

## Letting the lead set it up

You don't have to open Settings. Ask the lead (for example Michelle) to "make a project room for the referral project with a fetcher, a writer and a sender". The lead has a `setup_project_room` tool that creates the room and returns the endpoint, the env var names and the client file. The lead never writes code, so she creates a task for a builder agent, who adds the client and the calls to the project. The room token is never given to the agents: you set `HQ_ROOM_TOKEN` in the project's environment yourself (Settings, Team, Project room, copy).

Only the lead can call the tool; workers get an error. Calling it again with the same name (or `id`) replaces that room; a new name adds another room. The result lists the room ids and, with several rooms, tells the project to set `HQ_ROOM_ID`.
