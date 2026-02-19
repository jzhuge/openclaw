#!/usr/bin/env python3
"""
JSON-over-stdio bridge for lance-context.
Reads JSON commands from stdin, writes JSON responses to stdout.

Protocol:
  Input: JSON lines with {"id": str, "command": str, "params": dict}
  Output: JSON lines with {"id": str, "ok": bool, "result": any} or {"id": str, "ok": bool, "error": str}
"""
import sys
import json
import traceback
from typing import Any

try:
    from lance_context.api import Context
except ImportError as exc:
    print(json.dumps({"ok": False, "error": f"Failed to import lance_context: {exc}"}), flush=True)
    sys.exit(1)


def serialize_result(result: Any) -> Any:
    """Convert Python objects to JSON-serializable types."""
    if result is None:
        return None
    if isinstance(result, (str, int, float, bool)):
        return result
    if isinstance(result, dict):
        return {k: serialize_result(v) for k, v in result.items()}
    if isinstance(result, (list, tuple)):
        return [serialize_result(item) for item in result]
    if hasattr(result, "isoformat"):  # datetime
        return result.isoformat()
    if isinstance(result, bytes):
        # Convert binary to base64 for JSON serialization
        import base64
        return base64.b64encode(result).decode("ascii")
    return str(result)


def handle_command(ctx: Context, cmd: dict[str, Any]) -> Any:
    """Handle a single command and return the result."""
    command = cmd["command"]
    params = cmd.get("params", {})

    if command == "add":
        ctx.add(
            role=params["role"],
            content=params["content"],
            embedding=params.get("embedding"),
            bot_id=params.get("bot_id"),
            session_id=params.get("session_id"),
        )
        return None

    elif command == "search":
        results = ctx.search(params["query"], params.get("limit"))
        return results

    elif command == "list":
        results = ctx.list(params.get("limit"), params.get("offset"))
        return results

    elif command == "snapshot":
        snapshot_id = ctx.snapshot(params.get("label"))
        return {"snapshot_id": snapshot_id}

    elif command == "checkout":
        version_id = params["version_id"]
        if isinstance(version_id, str):
            try:
                version_id = int(version_id)
            except ValueError:
                pass  # Keep as string for named snapshots
        ctx.checkout(version_id)
        return None

    elif command == "compact":
        metrics = ctx.compact(
            target_rows_per_fragment=params.get("target_rows_per_fragment"),
            materialize_deletions=params.get("materialize_deletions", True),
        )
        return metrics

    elif command == "compaction_stats":
        stats = ctx.compaction_stats()
        return stats

    elif command == "entries":
        return {"count": ctx.entries()}

    elif command == "version":
        return {"version": ctx.version()}

    elif command == "uri":
        return {"uri": ctx.uri()}

    elif command == "branch":
        return {"branch": ctx.branch()}

    else:
        raise ValueError(f"Unknown command: {command}")


def main():
    """Main loop: read commands from stdin, write responses to stdout."""
    import argparse
    parser = argparse.ArgumentParser(description="lance-context JSON bridge")
    parser.add_argument("--uri", required=True, help="Lance dataset URI")
    parser.add_argument("--config", type=json.loads, default="{}", help="JSON config")
    args = parser.parse_args()

    config = args.config

    # Extract compaction config
    compaction = config.get("compaction", {})
    storage_options = config.get("storage_options", {})

    # Create Context with compaction config
    try:
        ctx = Context.create(
            args.uri,
            storage_options=storage_options if storage_options else None,
            enable_background_compaction=compaction.get("enabled", False),
            compaction_interval_secs=compaction.get("check_interval_secs", 300),
            compaction_min_fragments=compaction.get("min_fragments", 5),
            compaction_target_rows=compaction.get("target_rows_per_fragment", 1_000_000),
            quiet_hours=compaction.get("quiet_hours", []),
        )
    except Exception as exc:
        error_msg = f"Failed to create Context: {exc}\n{traceback.format_exc()}"
        print(json.dumps({"ok": False, "error": error_msg}), flush=True)
        sys.exit(1)

    # Signal ready
    print(json.dumps({"ok": True, "status": "ready"}), flush=True)

    # Command loop: read JSON lines from stdin
    for line in sys.stdin:
        try:
            cmd = json.loads(line)
            result = handle_command(ctx, cmd)
            serialized = serialize_result(result)
            response = {"id": cmd["id"], "ok": True, "result": serialized}
        except Exception as exc:
            error_msg = f"{type(exc).__name__}: {exc}"
            # Include traceback for debugging (can be disabled in production)
            if config.get("debug"):
                error_msg += f"\n{traceback.format_exc()}"
            response = {"id": cmd.get("id"), "ok": False, "error": error_msg}

        print(json.dumps(response), flush=True)


if __name__ == "__main__":
    main()
