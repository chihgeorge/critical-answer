import { describe, it, expect } from "vitest";
import { partyHttpBase } from "./party-host";

describe("partyHttpBase", () => {
  it("uses http for a localhost host", () => {
    expect(partyHttpBase("localhost:1999")).toBe("http://localhost:1999");
  });

  it("uses http for a 127.0.0.1 host", () => {
    expect(partyHttpBase("127.0.0.1:8787")).toBe("http://127.0.0.1:8787");
  });

  it("uses https for a deployed (non-localhost) host", () => {
    expect(partyHttpBase("my-worker.example.workers.dev")).toBe("https://my-worker.example.workers.dev");
  });
});
