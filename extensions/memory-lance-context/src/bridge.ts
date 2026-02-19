import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as readline from "node:readline";
import type {
  AddParams,
  SearchParams,
  ListParams,
  CompactParams,
  CompactionMetrics,
  CompactionStats,
  SearchHit,
  ContextRecord,
} from "./types.js";

type BridgeConfig = {
  pythonPath: string;
  dbPath: string;
  timeout: number;
  compaction?: {
    enabled: boolean;
    check_interval_secs: number;
    min_fragments: number;
    target_rows_per_fragment: number;
    quiet_hours: Array<[number, number]>;
  };
  storage_options?: {
    aws_access_key_id?: string;
    aws_secret_access_key?: string;
    aws_region?: string;
    aws_endpoint_url?: string;
  };
  debug?: boolean;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

type BridgeResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: string };

/**
 * Python bridge for lance-context via JSON-over-stdio.
 * Spawns a Python subprocess running bridge.py and communicates via JSON lines.
 */
export class LanceContextBridge {
  private proc: ChildProcess | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private readyPromise: Promise<void> | null = null;
  private closed = false;

  constructor(private config: BridgeConfig) {}

  /**
   * Initialize the bridge by spawning the Python subprocess.
   */
  async initialize(): Promise<void> {
    if (this.proc) {
      return;
    }

    this.readyPromise = new Promise((resolve, reject) => {
      // Validate Python path (security: prevent arbitrary executable execution)
      const pythonPath = this.resolvePythonPath(this.config.pythonPath);

      // Locate bridge.py
      const bridgePath = this.resolveBridgePath();

      // Ensure db directory exists
      const dbDir = path.dirname(this.config.dbPath);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      // Build config JSON
      const config = {
        compaction: this.config.compaction,
        storage_options: this.config.storage_options,
        debug: this.config.debug,
      };

      // Spawn Python bridge
      const args = [bridgePath, "--uri", this.config.dbPath, "--config", JSON.stringify(config)];

      this.proc = spawn(pythonPath, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      });

      // Setup JSON line protocol on stdout
      const rl = readline.createInterface({ input: this.proc.stdout! });
      let ready = false;

      rl.on("line", (line) => {
        try {
          const response: BridgeResponse | { ok: true; status: "ready" } = JSON.parse(line);

          // Handle ready signal
          if ("status" in response && response.status === "ready") {
            ready = true;
            resolve();
            return;
          }

          // Handle command response
          if ("id" in response) {
            const pending = this.pendingRequests.get(response.id);
            if (pending) {
              clearTimeout(pending.timeout);
              this.pendingRequests.delete(response.id);

              if (response.ok) {
                pending.resolve(response.result);
              } else {
                pending.reject(new Error(response.error));
              }
            }
          }
        } catch (err) {
          // Ignore malformed lines
        }
      });

      // Capture stderr for debugging
      let stderr = "";
      this.proc.stderr?.setEncoding("utf8");
      this.proc.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
      });

      // Handle process exit
      this.proc.on("exit", (code, signal) => {
        this.proc = null;
        const error = new Error(
          `Python bridge exited (code: ${code}, signal: ${signal})\n${stderr.trim()}`,
        );

        if (!ready) {
          reject(error);
        }

        // Reject all pending requests
        for (const pending of this.pendingRequests.values()) {
          clearTimeout(pending.timeout);
          pending.reject(error);
        }
        this.pendingRequests.clear();
      });

      // Handle spawn errors
      this.proc.on("error", (err) => {
        const wrapped = new Error(`Failed to spawn Python bridge: ${err.message}`);
        if (!ready) {
          reject(wrapped);
        }
      });
    });

    return this.readyPromise;
  }

  /**
   * Send a command to the Python bridge and wait for response.
   */
  private async call<T>(command: string, params: Record<string, unknown> = {}): Promise<T> {
    if (this.closed) {
      throw new Error("Bridge is closed");
    }

    await this.readyPromise;

    if (!this.proc || !this.proc.stdin) {
      throw new Error("Bridge not initialized");
    }

    const requestId = randomUUID();
    const request = { id: requestId, command, params };

    // Write JSON line to stdin
    this.proc.stdin.write(JSON.stringify(request) + "\n");

    // Wait for response with timeout
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Bridge timeout: ${command} (${this.config.timeout}ms)`));
      }, this.config.timeout);

      this.pendingRequests.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      });
    });
  }

  /**
   * Add a record to the context.
   */
  async add(params: AddParams): Promise<void> {
    await this.call<void>("add", params);
  }

  /**
   * Search the context using semantic similarity.
   */
  async search(params: SearchParams): Promise<SearchHit[]> {
    const results = await this.call<SearchHit[]>("search", params);
    return results;
  }

  /**
   * List records chronologically.
   */
  async list(params: ListParams = {}): Promise<ContextRecord[]> {
    const results = await this.call<ContextRecord[]>("list", params);
    return results;
  }

  /**
   * Create a named snapshot.
   */
  async snapshot(label?: string): Promise<string> {
    const result = await this.call<{ snapshot_id: string }>("snapshot", { label });
    return result.snapshot_id;
  }

  /**
   * Checkout to a specific version or snapshot.
   */
  async checkout(versionId: number | string): Promise<void> {
    await this.call<void>("checkout", { version_id: versionId });
  }

  /**
   * Manually trigger compaction.
   */
  async compact(params?: CompactParams): Promise<CompactionMetrics> {
    const result = await this.call<CompactionMetrics>("compact", params || {});
    return result;
  }

  /**
   * Get compaction statistics.
   */
  async compactionStats(): Promise<CompactionStats> {
    const result = await this.call<CompactionStats>("compaction_stats");
    return result;
  }

  /**
   * Get the number of entries.
   */
  async entries(): Promise<number> {
    const result = await this.call<{ count: number }>("entries");
    return result.count;
  }

  /**
   * Get the current version.
   */
  async version(): Promise<number> {
    const result = await this.call<{ version: number }>("version");
    return result.version;
  }

  /**
   * Get the dataset URI.
   */
  async uri(): Promise<string> {
    const result = await this.call<{ uri: string }>("uri");
    return result.uri;
  }

  /**
   * Get the current branch.
   */
  async branch(): Promise<string> {
    const result = await this.call<{ branch: string }>("branch");
    return result.branch;
  }

  /**
   * Close the bridge gracefully.
   */
  async close(): Promise<void> {
    if (this.closed || !this.proc) {
      return;
    }

    this.closed = true;

    // Close stdin to signal Python to exit gracefully
    if (this.proc.stdin) {
      this.proc.stdin.end();
    }

    // Wait for process to exit (with timeout)
    await new Promise<void>((resolve) => {
      if (!this.proc) {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        if (this.proc) {
          this.proc.kill("SIGTERM");
        }
        resolve();
      }, 5000);

      this.proc.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  /**
   * Resolve and validate Python executable path.
   */
  private resolvePythonPath(pythonPath: string): string {
    // SECURITY: Prevent arbitrary executable execution
    const base = path.basename(pythonPath).toLowerCase();
    const allowed = ["python", "python3", "python3.exe", "python.exe"];

    if (!allowed.some((name) => base === name || base.startsWith(name + "."))) {
      throw new Error(`Invalid Python executable: ${pythonPath}`);
    }

    // If absolute path, validate it exists
    if (path.isAbsolute(pythonPath)) {
      if (!fs.existsSync(pythonPath)) {
        throw new Error(`Python executable not found: ${pythonPath}`);
      }
    }

    return pythonPath;
  }

  /**
   * Resolve bridge.py path.
   */
  private resolveBridgePath(): string {
    // Try relative to this file
    const candidates = [
      path.join(__dirname, "..", "python", "bridge.py"),
      path.join(process.cwd(), "extensions", "memory-lance-context", "python", "bridge.py"),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    throw new Error(
      `bridge.py not found. Searched: ${candidates.join(", ")}\n` +
        "Please ensure extensions/memory-lance-context/python/bridge.py exists.",
    );
  }
}
