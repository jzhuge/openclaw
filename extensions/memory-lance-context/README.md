# memory-lance-context

Versioned long-term memory plugin for OpenClaw using [lance-context](https://github.com/jzhuge/lance-context).

## Features

- **Automatic Versioning**: Every `add()` creates a new version
- **Snapshots & Time-Travel**: Create named checkpoints and restore to previous states
- **Background Compaction**: Automatic optimization of storage with configurable intervals
- **S3-Compatible Storage**: Cloud persistence with AWS, MinIO, or custom endpoints
- **Semantic Search**: Vector similarity search using OpenAI embeddings
- **Auto-Capture/Recall**: Automatic memory injection and extraction from conversations

## Installation

### 1. Install Python Dependencies

```bash
cd extensions/memory-lance-context/python
pip install -r requirements.txt
```

Or install globally:

```bash
pip install lance-context>=0.1.0
```

### 2. Configure OpenClaw

Add to your OpenClaw config file (e.g., `~/.openclaw/config.json`):

```json
{
  "plugins": [
    {
      "id": "memory-lance-context",
      "config": {
        "embedding": {
          "provider": "openai",
          "apiKey": "${OPENAI_API_KEY}",
          "model": "text-embedding-3-small"
        },
        "autoCapture": true,
        "autoRecall": true,
        "autoSnapshot": true,
        "enableBackgroundCompaction": true
      }
    }
  ]
}
```

## Configuration Options

### Required

- `embedding.apiKey`: OpenAI API key (or use `${OPENAI_API_KEY}` env var)

### Optional

- `embedding.model`: Embedding model (default: `text-embedding-3-small`)
- `dbPath`: Database path (default: `~/.openclaw/memory/lance-context`)
- `autoCapture`: Auto-capture important info (default: `false`)
- `autoRecall`: Auto-inject relevant memories (default: `true`)
- `captureMaxChars`: Max message length for capture (default: `500`)
- `autoSnapshot`: Create snapshot after conversations (default: `false`)
- `pythonPath`: Python 3 executable path (default: `python3`)
- `bridgeTimeout`: Bridge timeout in milliseconds (default: `30000`)

### Compaction (Advanced)

- `enableBackgroundCompaction`: Enable background optimization (default: `false`)
- `compactionIntervalSecs`: Check interval in seconds (default: `300`)
- `compactionMinFragments`: Min fragments to trigger compaction (default: `5`)
- `compactionTargetRows`: Target rows per fragment (default: `1000000`)
- `compactionQuietHours`: Quiet hours as `[[start, end]]` (e.g., `[[22, 6]]` for 10pm-6am)

### S3 Storage (Advanced)

```json
{
  "storage": {
    "s3": {
      "bucket": "my-bucket",
      "region": "us-east-1",
      "accessKeyId": "${AWS_ACCESS_KEY_ID}",
      "secretAccessKey": "${AWS_SECRET_ACCESS_KEY}"
    }
  }
}
```

For MinIO or custom endpoints:

```json
{
  "storage": {
    "s3": {
      "bucket": "my-bucket",
      "endpoint": "http://localhost:9000",
      "accessKeyId": "${MINIO_ACCESS_KEY}",
      "secretAccessKey": "${MINIO_SECRET_KEY}"
    }
  }
}
```

## Usage

### Agent Tools

The following tools are available to AI agents during conversations:

#### `memory_add`

Store information in versioned memory. Creates a new version automatically.

```typescript
// Example tool call
{
  "text": "The user prefers TypeScript over JavaScript",
  "importance": 0.8,
  "category": "preference"
}
```

#### `memory_search`

Search memories using semantic similarity.

```typescript
{
  "query": "What are the user's language preferences?",
  "limit": 5
}
```

#### `memory_list`

List recent memories chronologically.

```typescript
{
  "limit": 10,
  "offset": 0
}
```

#### `memory_snapshot`

Create a named snapshot for later restoration.

```typescript
{
  "label": "before-refactor"
}
```

#### `memory_checkout`

Restore memory to a previous version or snapshot.

```typescript
{
  "versionId": 42  // or "before-refactor"
}
```

### CLI Commands

#### List Statistics

```bash
openclaw ltm-lc list
# Output:
# URI: /Users/you/.openclaw/memory/lance-context
# Entries: 142
# Version: 89
```

#### Search Memories

```bash
openclaw ltm-lc search "user preferences" --limit 10
```

#### View Versions

```bash
openclaw ltm-lc versions
# Output:
# Current version: 89
# Current branch: main
```

#### Checkout Version

```bash
# Checkout by version number
openclaw ltm-lc checkout 42

# Checkout by snapshot label
openclaw ltm-lc checkout before-refactor
```

#### Manual Compaction

```bash
openclaw ltm-lc compact
# Output:
# Starting compaction...
# Compaction complete:
#   Fragments removed: 15
#   Fragments added: 3
#   Files removed: 30
#   Files added: 6
```

#### Compaction Statistics

```bash
openclaw ltm-lc stats
# Output:
# Compaction stats:
#   Total fragments: 8
#   Is compacting: false
#   Last compaction: 2026-02-16T14:23:45Z
#   Total compactions: 12
```

## Architecture

### Python Bridge

This plugin uses a **JSON-over-stdio bridge** to communicate with lance-context (Python):

```
┌──────────────┐          ┌────────────────┐          ┌──────────────┐
│   OpenClaw   │  spawn   │  Python Bridge │  PyO3    │ lance-context│
│  (Node.js)   │─────────▶│   (bridge.py)  │─────────▶│   (Rust)     │
│              │  stdin   │                │          │              │
│              │◀─────────│                │          │              │
│              │  stdout  │                │          │              │
└──────────────┘          └────────────────┘          └──────────────┘
```

**Why not native bindings?**

- No native compilation needed
- Python errors don't crash Node.js
- Easier debugging and development
- Proven pattern (see `lobster` extension)

**Trade-off**: ~50ms latency overhead vs zero complexity for users

### Versioning

Every `add()` operation increments the version number:

```
Version 1: add("I prefer TypeScript")
Version 2: add("I like React")
Version 3: add("I use VSCode")
↓
checkout(1)
↓
Version 1: state restored (only "I prefer TypeScript" visible)
```

Snapshots are named checkpoints:

```
Version 1-10: ... work ...
snapshot("stable-state")
Version 11-20: ... more work ...
checkout("stable-state") → restores to version 10
```

### Compaction

Lance datasets fragment over time (many small files). Compaction merges them:

```
Before:  [100 rows] [50 rows] [75 rows] ... (15 fragments)
After:   [1M rows] [225 rows]                (2 fragments)
```

**Benefits**:

- Faster queries (fewer files to scan)
- Lower storage overhead (better compression)
- Reduced S3 costs (fewer objects)

**When to compact**:

- Background compaction handles this automatically (if enabled)
- Manual: `openclaw ltm-lc compact` when fragment count is high

## Troubleshooting

### Bridge fails to start

**Error**: `Failed to import lance_context`

**Fix**: Install lance-context:

```bash
pip install lance-context
```

### Python not found

**Error**: `Failed to spawn Python bridge: ENOENT`

**Fix**: Set `pythonPath` in config:

```json
{
  "pythonPath": "/usr/bin/python3"
}
```

Or use absolute path:

```bash
which python3
# /opt/homebrew/bin/python3

# Update config
{
  "pythonPath": "/opt/homebrew/bin/python3"
}
```

### Bridge timeout

**Error**: `Bridge timeout: search (30000ms)`

**Fix**: Increase timeout:

```json
{
  "bridgeTimeout": 60000
}
```

### Auto-capture not working

Check that `autoCapture` is `true` and verify memory triggers in your messages:

```javascript
// These trigger capture:
"I prefer X";
"Remember this";
"I like Y";
"My email is user@example.com";
"Always use Z";
```

## Comparison with memory-lancedb

| Feature     | memory-lancedb | memory-lance-context           |
| ----------- | -------------- | ------------------------------ |
| Storage     | LanceDB (npm)  | lance-context (Rust + Python)  |
| Versioning  | ❌ No          | ✅ Every add()                 |
| Snapshots   | ❌ No          | ✅ Named checkpoints           |
| Time-travel | ❌ No          | ✅ Checkout versions           |
| Compaction  | ❌ Manual only | ✅ Background + manual         |
| S3 Storage  | ⚠️ Limited     | ✅ Full support                |
| Multimodal  | ❌ Text only   | 🚧 Future (images, dataframes) |
| Branching   | ❌ No          | 🚧 Future                      |
| Latency     | ~10ms          | ~50ms (bridge overhead)        |
| Setup       | npm install    | pip install                    |

## Development

### Running Tests

```bash
npm test
```

### Bridge Protocol

See `python/bridge.py` for the JSON protocol:

**Input** (stdin):

```json
{ "id": "req-123", "command": "add", "params": { "role": "user", "content": "..." } }
```

**Output** (stdout):

```json
{ "id": "req-123", "ok": true, "result": null }
```

**Error**:

```json
{ "id": "req-123", "ok": false, "error": "ValueError: ..." }
```

### Adding New Commands

1. Add to `bridge.py` `handle_command()`
2. Add TypeScript method to `src/bridge.ts`
3. Optionally expose as tool in `index.ts`

## License

Same as OpenClaw (check parent repository).
