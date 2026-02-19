import fs from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type MemoryLanceContextConfig = {
  embedding: {
    provider: "openai";
    model?: string;
    apiKey: string;
  };
  dbPath?: string;

  // S3 storage (optional)
  storage?: {
    s3?: {
      bucket: string;
      region?: string;
      endpoint?: string;
      accessKeyId?: string;
      secretAccessKey?: string;
    };
  };

  // Auto-capture/recall like memory-lancedb
  autoCapture?: boolean;
  autoRecall?: boolean;
  captureMaxChars?: number;

  // Versioning
  autoSnapshot?: boolean;
  snapshotInterval?: number;

  // Compaction
  enableBackgroundCompaction?: boolean;
  compactionIntervalSecs?: number;
  compactionMinFragments?: number;
  compactionTargetRows?: number;
  compactionQuietHours?: Array<[number, number]>;

  // Python bridge
  pythonPath?: string;
  bridgeTimeout?: number;
};

export const MEMORY_CATEGORIES = ["preference", "fact", "decision", "entity", "other"] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

const DEFAULT_MODEL = "text-embedding-3-small";
export const DEFAULT_CAPTURE_MAX_CHARS = 500;
const LEGACY_STATE_DIRS: string[] = [];

function resolveDefaultDbPath(): string {
  const home = homedir();
  const preferred = join(home, ".openclaw", "memory", "lance-context");
  try {
    if (fs.existsSync(preferred)) {
      return preferred;
    }
  } catch {
    // best-effort
  }

  for (const legacy of LEGACY_STATE_DIRS) {
    const candidate = join(home, legacy, "memory", "lance-context");
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // best-effort
    }
  }

  return preferred;
}

const DEFAULT_DB_PATH = resolveDefaultDbPath();

const EMBEDDING_DIMENSIONS: Record<string, number> = {
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
};

function assertAllowedKeys(value: Record<string, unknown>, allowed: string[], label: string) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length === 0) {
    return;
  }
  throw new Error(`${label} has unknown keys: ${unknown.join(", ")}`);
}

export function vectorDimsForModel(model: string): number {
  const dims = EMBEDDING_DIMENSIONS[model];
  if (!dims) {
    throw new Error(`Unsupported embedding model: ${model}`);
  }
  return dims;
}

function resolveEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, envVar) => {
    const envValue = process.env[envVar];
    if (!envValue) {
      throw new Error(`Environment variable ${envVar} is not set`);
    }
    return envValue;
  });
}

function resolveEmbeddingModel(embedding: Record<string, unknown>): string {
  const model = typeof embedding.model === "string" ? embedding.model : DEFAULT_MODEL;
  vectorDimsForModel(model);
  return model;
}

export const memoryLanceContextConfigSchema = {
  parse(value: unknown): MemoryLanceContextConfig {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("memory-lance-context config required");
    }
    const cfg = value as Record<string, unknown>;
    assertAllowedKeys(
      cfg,
      [
        "embedding",
        "dbPath",
        "storage",
        "autoCapture",
        "autoRecall",
        "captureMaxChars",
        "autoSnapshot",
        "snapshotInterval",
        "enableBackgroundCompaction",
        "compactionIntervalSecs",
        "compactionMinFragments",
        "compactionTargetRows",
        "compactionQuietHours",
        "pythonPath",
        "bridgeTimeout",
      ],
      "memory-lance-context config",
    );

    const embedding = cfg.embedding as Record<string, unknown> | undefined;
    if (!embedding || typeof embedding.apiKey !== "string") {
      throw new Error("embedding.apiKey is required");
    }
    assertAllowedKeys(embedding, ["apiKey", "model"], "embedding config");

    const model = resolveEmbeddingModel(embedding);

    const captureMaxChars =
      typeof cfg.captureMaxChars === "number" ? Math.floor(cfg.captureMaxChars) : undefined;
    if (
      typeof captureMaxChars === "number" &&
      (captureMaxChars < 100 || captureMaxChars > 10_000)
    ) {
      throw new Error("captureMaxChars must be between 100 and 10000");
    }

    // Parse storage config if present
    let storage: MemoryLanceContextConfig["storage"];
    if (cfg.storage && typeof cfg.storage === "object" && !Array.isArray(cfg.storage)) {
      const storageCfg = cfg.storage as Record<string, unknown>;
      if (storageCfg.s3 && typeof storageCfg.s3 === "object" && !Array.isArray(storageCfg.s3)) {
        const s3 = storageCfg.s3 as Record<string, unknown>;
        storage = {
          s3: {
            bucket: typeof s3.bucket === "string" ? s3.bucket : "",
            region: typeof s3.region === "string" ? s3.region : undefined,
            endpoint: typeof s3.endpoint === "string" ? s3.endpoint : undefined,
            accessKeyId:
              typeof s3.accessKeyId === "string" ? resolveEnvVars(s3.accessKeyId) : undefined,
            secretAccessKey:
              typeof s3.secretAccessKey === "string"
                ? resolveEnvVars(s3.secretAccessKey)
                : undefined,
          },
        };
      }
    }

    // Parse compaction quiet hours
    let compactionQuietHours: Array<[number, number]> | undefined;
    if (Array.isArray(cfg.compactionQuietHours)) {
      compactionQuietHours = cfg.compactionQuietHours
        .filter((item) => Array.isArray(item) && item.length === 2)
        .map((item) => [Number(item[0]), Number(item[1])] as [number, number]);
    }

    return {
      embedding: {
        provider: "openai",
        model,
        apiKey: resolveEnvVars(embedding.apiKey),
      },
      dbPath: typeof cfg.dbPath === "string" ? cfg.dbPath : DEFAULT_DB_PATH,
      storage,
      autoCapture: cfg.autoCapture === true,
      autoRecall: cfg.autoRecall !== false,
      captureMaxChars: captureMaxChars ?? DEFAULT_CAPTURE_MAX_CHARS,
      autoSnapshot: cfg.autoSnapshot === true,
      snapshotInterval: typeof cfg.snapshotInterval === "number" ? cfg.snapshotInterval : undefined,
      enableBackgroundCompaction: cfg.enableBackgroundCompaction === true,
      compactionIntervalSecs:
        typeof cfg.compactionIntervalSecs === "number" ? cfg.compactionIntervalSecs : 300,
      compactionMinFragments:
        typeof cfg.compactionMinFragments === "number" ? cfg.compactionMinFragments : 5,
      compactionTargetRows:
        typeof cfg.compactionTargetRows === "number" ? cfg.compactionTargetRows : 1_000_000,
      compactionQuietHours,
      pythonPath: typeof cfg.pythonPath === "string" ? cfg.pythonPath : "python3",
      bridgeTimeout: typeof cfg.bridgeTimeout === "number" ? cfg.bridgeTimeout : 30000,
    };
  },
  uiHints: {
    "embedding.apiKey": {
      label: "OpenAI API Key",
      sensitive: true,
      placeholder: "sk-proj-...",
      help: "API key for OpenAI embeddings (or use ${OPENAI_API_KEY})",
    },
    "embedding.model": {
      label: "Embedding Model",
      placeholder: DEFAULT_MODEL,
      help: "OpenAI embedding model to use",
    },
    dbPath: {
      label: "Database Path",
      placeholder: "~/.openclaw/memory/lance-context",
      advanced: true,
    },
    autoCapture: {
      label: "Auto-Capture",
      help: "Automatically capture important information from conversations",
    },
    autoRecall: {
      label: "Auto-Recall",
      help: "Automatically inject relevant memories into context",
    },
    captureMaxChars: {
      label: "Capture Max Chars",
      help: "Maximum message length eligible for auto-capture",
      advanced: true,
      placeholder: String(DEFAULT_CAPTURE_MAX_CHARS),
    },
    autoSnapshot: {
      label: "Auto-Snapshot",
      help: "Automatically create snapshots after conversations",
      advanced: true,
    },
    enableBackgroundCompaction: {
      label: "Background Compaction",
      help: "Automatically optimize storage in background",
      advanced: true,
    },
    pythonPath: {
      label: "Python Path",
      placeholder: "python3",
      advanced: true,
      help: "Path to Python 3 executable",
    },
  },
};
