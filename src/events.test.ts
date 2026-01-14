import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  readEvents,
  findResultEvent,
  clearEvents,
  type ResultEvent,
} from "./events.js";
import { getEventsFilePath } from "./runtime.js";

function emitResultEvent(
  configDir: string,
  id: string,
  action: ResultEvent["action"],
  answers?: Record<string, string | string[]>
): void {
  const filePath = getEventsFilePath(configDir);
  const event = { ts: Date.now(), type: "result", id, action, ...(answers && { answers }) };
  fs.appendFileSync(filePath, JSON.stringify(event) + "\n");
}

describe("events", () => {
  const runtimeRoot = path.join(os.tmpdir(), "termos-events-test");
  const sessionName = "test-session";
  const originalRuntimeDir = process.env.TERMOS_RUNTIME_DIR;

  beforeEach(() => {
    process.env.TERMOS_RUNTIME_DIR = runtimeRoot;
    const eventsFile = getEventsFilePath(sessionName);
    fs.mkdirSync(path.dirname(eventsFile), { recursive: true });
    clearEvents(sessionName);
  });

  afterEach(() => {
    try {
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    } catch {
      // Ignore
    }
    if (originalRuntimeDir === undefined) {
      delete process.env.TERMOS_RUNTIME_DIR;
    } else {
      process.env.TERMOS_RUNTIME_DIR = originalRuntimeDir;
    }
  });

  describe("findResultEvent", () => {
    it("should find result event by interaction id", () => {
      emitResultEvent(sessionName, "int-1", "accept", { a: "1" });
      emitResultEvent(sessionName, "int-2", "decline", { b: "2" });
      emitResultEvent(sessionName, "int-3", "cancel");

      const result = findResultEvent(sessionName, "int-2");
      expect(result).not.toBeNull();
      expect(result?.id).toBe("int-2");
      expect(result?.action).toBe("decline");
    });

    it("should return most recent result for same id", () => {
      emitResultEvent(sessionName, "int-1", "cancel");
      emitResultEvent(sessionName, "int-1", "accept", { final: "yes" });

      const result = findResultEvent(sessionName, "int-1");
      expect(result?.action).toBe("accept");
      expect(result?.answers).toEqual({ final: "yes" });
    });

    it("should return null for non-existent id", () => {
      emitResultEvent(sessionName, "int-1", "accept");

      const result = findResultEvent(sessionName, "int-999");
      expect(result).toBeNull();
    });
  });

  describe("readEvents", () => {
    it("should read all events in order", () => {
      emitResultEvent(sessionName, "int-1", "accept");
      emitResultEvent(sessionName, "int-2", "decline");

      const events = readEvents(sessionName);
      expect(events).toHaveLength(2);
      expect(events[0].id).toBe("int-1");
      expect(events[1].id).toBe("int-2");
    });
  });

  describe("clearEvents", () => {
    it("should clear all events", () => {
      emitResultEvent(sessionName, "a", "accept");
      emitResultEvent(sessionName, "b", "decline");
      expect(readEvents(sessionName)).toHaveLength(2);

      clearEvents(sessionName);
      expect(readEvents(sessionName)).toHaveLength(0);
    });
  });
});
