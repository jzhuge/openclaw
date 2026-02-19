import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { LanceContextBridge } from "../src/bridge.js";

describe("LanceContextBridge", () => {
  let bridge: LanceContextBridge;
  let testDbPath: string;

  beforeAll(async () => {
    // Create a temporary directory for the test database
    testDbPath = path.join(os.tmpdir(), `lance-context-test-${Date.now()}`);
    fs.mkdirSync(testDbPath, { recursive: true });

    bridge = new LanceContextBridge({
      pythonPath: "python3",
      dbPath: path.join(testDbPath, "test.lance"),
      timeout: 10000,
      compaction: {
        enabled: false,
        check_interval_secs: 300,
        min_fragments: 5,
        target_rows_per_fragment: 1_000_000,
        quiet_hours: [],
      },
    });

    await bridge.initialize();
  });

  afterAll(async () => {
    await bridge.close();

    // Cleanup test directory
    if (fs.existsSync(testDbPath)) {
      fs.rmSync(testDbPath, { recursive: true, force: true });
    }
  });

  it("should initialize successfully", async () => {
    const version = await bridge.version();
    expect(version).toBe(0); // Initial version
  });

  it("should add a record and increment version", async () => {
    await bridge.add({
      role: "user",
      content: "test message",
      embedding: new Array(1536).fill(0.1),
    });

    const version = await bridge.version();
    expect(version).toBe(1);

    const count = await bridge.entries();
    expect(count).toBe(1);
  });

  it("should search for records", async () => {
    // Add another record
    await bridge.add({
      role: "user",
      content: "another message",
      embedding: new Array(1536).fill(0.2),
    });

    const results = await bridge.search({
      query: new Array(1536).fill(0.1),
      limit: 5,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty("text");
    expect(results[0]).toHaveProperty("distance");
  });

  it("should list records", async () => {
    const results = await bridge.list({ limit: 10 });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty("text");
    expect(results[0]).toHaveProperty("role");
  });

  it("should create snapshots", async () => {
    const snapshotId = await bridge.snapshot("test-snapshot");

    expect(snapshotId).toBeTruthy();
    expect(typeof snapshotId).toBe("string");
  });

  it("should checkout to previous version", async () => {
    // Record current version
    const currentVersion = await bridge.version();

    // Add a new record
    await bridge.add({
      role: "user",
      content: "will be reverted",
      embedding: new Array(1536).fill(0.3),
    });

    const newVersion = await bridge.version();
    expect(newVersion).toBe(currentVersion + 1);

    // Checkout to previous version
    await bridge.checkout(currentVersion);

    const restoredVersion = await bridge.version();
    expect(restoredVersion).toBe(currentVersion);
  });

  it("should get URI and branch", async () => {
    const uri = await bridge.uri();
    expect(uri).toContain("test.lance");

    const branch = await bridge.branch();
    expect(branch).toBeTruthy();
  });

  it("should handle timeouts gracefully", async () => {
    const shortTimeoutBridge = new LanceContextBridge({
      pythonPath: "python3",
      dbPath: path.join(testDbPath, "timeout-test.lance"),
      timeout: 1, // 1ms timeout - will fail
      compaction: {
        enabled: false,
        check_interval_secs: 300,
        min_fragments: 5,
        target_rows_per_fragment: 1_000_000,
        quiet_hours: [],
      },
    });

    await expect(shortTimeoutBridge.initialize()).rejects.toThrow();
  });

  it("should validate Python path", () => {
    expect(() => {
      new LanceContextBridge({
        pythonPath: "/usr/bin/bash", // Invalid: not Python
        dbPath: testDbPath,
        timeout: 10000,
      });
    }).toThrow("Invalid Python executable");
  });
});
