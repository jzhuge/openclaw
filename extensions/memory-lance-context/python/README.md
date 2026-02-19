# Python Bridge for lance-context

This directory contains the Python bridge that connects OpenClaw (Node.js) to lance-context (Rust + Python).

## Setup

### Option 1: pip install (Recommended)

```bash
pip install lance-context
```

### Option 2: Install from requirements.txt

```bash
cd extensions/memory-lance-context/python
pip install -r requirements.txt
```

### Option 3: Virtual Environment (Isolated)

```bash
cd extensions/memory-lance-context/python
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

If using a venv, update your OpenClaw config to point to the venv Python:

```json
{
  "pythonPath": "/path/to/venv/bin/python3"
}
```

## Testing the Bridge

You can test the bridge manually:

```bash
# Start the bridge
python3 bridge.py --uri /tmp/test.lance --config '{}'

# You should see:
{"ok": true, "status": "ready"}

# Send commands via stdin (paste and press enter):
{"id": "1", "command": "add", "params": {"role": "user", "content": "test message"}}
{"id": "2", "command": "entries", "params": {}}
{"id": "3", "command": "version", "params": {}}

# Expected responses:
{"id": "1", "ok": true, "result": null}
{"id": "2", "ok": true, "result": {"count": 1}}
{"id": "3", "ok": true, "result": {"version": 1}}

# Exit with Ctrl+D or Ctrl+C
```

## Bridge Protocol

### Input Format (stdin)

Each line is a JSON object:

```json
{
  "id": "unique-request-id",
  "command": "command-name",
  "params": {
    "param1": "value1",
    "param2": "value2"
  }
}
```

### Output Format (stdout)

Success:

```json
{
  "id": "unique-request-id",
  "ok": true,
  "result": { "data": "..." }
}
```

Error:

```json
{
  "id": "unique-request-id",
  "ok": false,
  "error": "Error message with details"
}
```

## Supported Commands

### `add`

Store a record.

```json
{
  "command": "add",
  "params": {
    "role": "user",
    "content": "text to store",
    "embedding": [0.1, 0.2, ...],  // optional
    "bot_id": "bot-123",            // optional
    "session_id": "session-456"     // optional
  }
}
```

### `search`

Search by embedding vector.

```json
{
  "command": "search",
  "params": {
    "query": [0.1, 0.2, ...],
    "limit": 5  // optional
  }
}
```

Returns array of records with `distance` field.

### `list`

List records chronologically.

```json
{
  "command": "list",
  "params": {
    "limit": 10, // optional
    "offset": 0 // optional
  }
}
```

### `snapshot`

Create a named snapshot.

```json
{
  "command": "snapshot",
  "params": {
    "label": "my-checkpoint" // optional
  }
}
```

Returns `{"snapshot_id": "..."}`.

### `checkout`

Restore to a previous version.

```json
{
  "command": "checkout",
  "params": {
    "version_id": 42 // or "snapshot-label"
  }
}
```

### `compact`

Manually trigger compaction.

```json
{
  "command": "compact",
  "params": {
    "target_rows_per_fragment": 1000000, // optional
    "materialize_deletions": true // optional
  }
}
```

Returns compaction metrics.

### `compaction_stats`

Get compaction statistics.

```json
{
  "command": "compaction_stats",
  "params": {}
}
```

### `entries`

Get entry count.

```json
{
  "command": "entries",
  "params": {}
}
```

Returns `{"count": N}`.

### `version`

Get current version.

```json
{
  "command": "version",
  "params": {}
}
```

Returns `{"version": N}`.

### `uri`

Get dataset URI.

```json
{
  "command": "uri",
  "params": {}
}
```

Returns `{"uri": "..."}`.

### `branch`

Get current branch.

```json
{
  "command": "branch",
  "params": {}
}
```

Returns `{"branch": "..."}`.

## Debugging

Enable debug mode for detailed error tracebacks:

```json
{
  "config": {
    "debug": true
  }
}
```

This will include full Python tracebacks in error responses.

## Requirements

- Python 3.8+
- lance-context >= 0.1.0

## Security

The bridge validates that only allowed executables can be spawned. See `src/bridge.ts` for validation logic.
