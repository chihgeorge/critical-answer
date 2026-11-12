import { describe, it, expect, vi } from "vitest";
import { handleBankImageApi, MAX_IMAGE_BYTES, MAX_MEDIA_BYTES, PNG_MAGIC, JPEG_MAGIC, WEBP_RIFF_MAGIC, WEBP_MAGIC, type BankImageApiDeps } from "./bank-image-api";

const KEY = "owner-key-0123456789abcdef";

function deps(over: Partial<BankImageApiDeps> = {}): BankImageApiDeps {
  return {
    ownerKey: KEY,
    allowedOrigins: "https://app.example.com",
    putImage: vi.fn(async () => ({ key: "generated-key" })),
    bankUnreadable: async () => false,
    ...over,
  };
}

/** Builds real signature bytes from the implementation's own magic-byte constants, so a
 * corrected signature can't silently drift out of sync between the two files. */
function pngBytes(totalLength = 16): Uint8Array {
  const arr = new Uint8Array(totalLength);
  arr.set(PNG_MAGIC, 0);
  return arr;
}
function jpegBytes(totalLength = 16): Uint8Array {
  const arr = new Uint8Array(totalLength);
  arr.set(JPEG_MAGIC, 0);
  return arr;
}
function webpBytes(totalLength = 16): Uint8Array {
  const arr = new Uint8Array(totalLength);
  arr.set(WEBP_RIFF_MAGIC, 0); // bytes 4-7 (the RIFF size field) are irrelevant to sniffing
  arr.set(WEBP_MAGIC, 8);
  return arr;
}

function req(method: string, opts: { auth?: string; origin?: string; body?: Uint8Array; contentLength?: number } = {}) {
  const headers = new Headers();
  if (opts.auth) headers.set("Authorization", opts.auth);
  if (opts.origin) headers.set("Origin", opts.origin);
  if (opts.contentLength !== undefined) headers.set("Content-Length", String(opts.contentLength));
  return new Request("https://worker.example.com/api/bank/image", {
    method,
    headers,
    body: opts.body ? (opts.body as unknown as BodyInit) : undefined,
  });
}

describe("handleBankImageApi: auth and method", () => {
  it("rejects a missing Authorization header (403)", async () => {
    const res = await handleBankImageApi(req("POST", { body: pngBytes() }), deps());
    expect(res.status).toBe(403);
  });

  it("rejects a wrong key (403)", async () => {
    const res = await handleBankImageApi(req("POST", { auth: "Bearer wrong", body: pngBytes() }), deps());
    expect(res.status).toBe(403);
  });

  it("answers OPTIONS with CORS headers, before checking auth", async () => {
    const res = await handleBankImageApi(req("OPTIONS", { origin: "https://app.example.com" }), deps());
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://app.example.com");
  });

  it("rejects an unsupported method (405)", async () => {
    const res = await handleBankImageApi(req("GET", { auth: `Bearer ${KEY}` }), deps());
    expect(res.status).toBe(405);
  });
});

describe("handleBankImageApi: content-type sniffing", () => {
  it("accepts a real PNG (magic bytes), ignoring any Content-Type header", async () => {
    const putImage = vi.fn(async () => ({ key: "k1" }));
    const res = await handleBankImageApi(req("POST", { auth: `Bearer ${KEY}`, body: pngBytes() }), deps({ putImage }));
    expect(res.status).toBe(200);
    expect(putImage).toHaveBeenCalledWith(expect.any(Uint8Array), "image/png");
  });

  it("accepts a real JPEG", async () => {
    const res = await handleBankImageApi(req("POST", { auth: `Bearer ${KEY}`, body: jpegBytes() }), deps());
    expect(res.status).toBe(200);
  });

  it("accepts a real WEBP", async () => {
    const res = await handleBankImageApi(req("POST", { auth: `Bearer ${KEY}`, body: webpBytes() }), deps());
    expect(res.status).toBe(200);
  });

  it("rejects a RIFF file that isn't actually WEBP (e.g. a WAV, which shares the RIFF prefix)", async () => {
    const putImage = vi.fn();
    const arr = new Uint8Array(16);
    arr.set(WEBP_RIFF_MAGIC, 0); // "RIFF"
    arr.set([0x57, 0x41, 0x56, 0x45], 8); // "WAVE", not "WEBP"
    const res = await handleBankImageApi(req("POST", { auth: `Bearer ${KEY}`, body: arr }), deps({ putImage }));
    expect(res.status).toBe(400);
    expect(putImage).not.toHaveBeenCalled();
  });

  it("rejects a file whose bytes don't match any allowed magic number, even with a spoofed image/* claim", async () => {
    const putImage = vi.fn();
    const fakeImage = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]); // not a real image
    const res = await handleBankImageApi(req("POST", { auth: `Bearer ${KEY}`, body: fakeImage }), deps({ putImage }));
    expect(res.status).toBe(400);
    expect(putImage).not.toHaveBeenCalled();
  });

  it("rejects an empty upload", async () => {
    const res = await handleBankImageApi(req("POST", { auth: `Bearer ${KEY}`, body: new Uint8Array(0) }), deps());
    expect(res.status).toBe(400);
  });
});

describe("handleBankImageApi: unreadable body", () => {
  it("returns 400 (not a 500) when request.arrayBuffer() itself throws, e.g. a client aborting mid-upload", async () => {
    // Only the members handleBankImageApi reads. Copying a real Request (Object.create + assign)
    // breaks on Node 26, whose Request keeps headers in a private #field the copy doesn't have.
    const base = req("POST", { auth: `Bearer ${KEY}` });
    const broken = {
      method: base.method,
      headers: base.headers,
      arrayBuffer: () => Promise.reject(new Error("network read failed")),
    } as unknown as Request;
    const putImage = vi.fn();
    const res = await handleBankImageApi(broken, deps({ putImage }));
    expect(res.status).toBe(400);
    expect(putImage).not.toHaveBeenCalled();
  });
});

describe("handleBankImageApi: size limit", () => {
  it("accepts an upload at exactly the byte limit", async () => {
    const putImage = vi.fn(async () => ({ key: "k" }));
    const res = await handleBankImageApi(req("POST", { auth: `Bearer ${KEY}`, body: pngBytes(MAX_IMAGE_BYTES) }), deps({ putImage }));
    expect(res.status).toBe(200);
    expect(putImage).toHaveBeenCalledOnce();
  });

  it("rejects an upload one byte over the limit", async () => {
    const putImage = vi.fn();
    const res = await handleBankImageApi(req("POST", { auth: `Bearer ${KEY}`, body: pngBytes(MAX_IMAGE_BYTES + 1) }), deps({ putImage }));
    expect(res.status).toBe(413);
    expect(putImage).not.toHaveBeenCalled();
  });

  it("rejects based on a declared Content-Length over the cap, before the body is read", async () => {
    const putImage = vi.fn();
    const res = await handleBankImageApi(
      req("POST", { auth: `Bearer ${KEY}`, contentLength: MAX_MEDIA_BYTES + 1, body: pngBytes() }),
      deps({ putImage }),
    );
    expect(res.status).toBe(413);
    expect(putImage).not.toHaveBeenCalled();
  });
});

describe("handleBankImageApi: upload failure", () => {
  it("returns 502 and logs when deps.putImage throws, without leaking the error to the response", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const putImage = vi.fn(async () => {
      throw new Error("R2 unreachable");
    });
    const res = await handleBankImageApi(req("POST", { auth: `Bearer ${KEY}`, body: pngBytes() }), deps({ putImage }));
    expect(res.status).toBe(502);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("image_upload_failed"));
    spy.mockRestore();
  });

  it("returns the generated key on success", async () => {
    const res = await handleBankImageApi(req("POST", { auth: `Bearer ${KEY}`, body: pngBytes() }), deps({ putImage: vi.fn(async () => ({ key: "abc-123" })) }));
    expect(await res.json()).toEqual({ key: "abc-123", contentType: "image/png" });
  });
});

describe("handleBankImageApi while the stored bank is unreadable", () => {
  it("answers 503 with CORS headers, without uploading, when the bank's state can't be read (BankStore unreachable)", async () => {
    const putImage = vi.fn(async () => ({ key: "k1" }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await handleBankImageApi(
      req("POST", { auth: `Bearer ${KEY}`, origin: "https://app.example.com", body: pngBytes() }),
      deps({ putImage, bankUnreadable: async () => { throw new Error("DO unreachable"); } }),
    );
    expect(res.status).toBe(503);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://app.example.com");
    expect(putImage).not.toHaveBeenCalled();
  });

  it("refuses the upload with 409 and never writes to storage: no save could keep it", async () => {
    const putImage = vi.fn(async () => ({ key: "k1" }));
    const res = await handleBankImageApi(req("POST", { auth: `Bearer ${KEY}`, body: pngBytes() }), deps({ putImage, bankUnreadable: async () => true }));
    expect(res.status).toBe(409);
    expect(putImage).not.toHaveBeenCalled();
  });

  // Generated by /ship coverage audit.
  // Value: protects=a caller without the owner key gets 403 and never triggers the bank read, even while unreadable;
  // fails_when=the read-only check moves above the auth check; why_new=auth tests run with a readable bank only;
  // seam=none; no_claim=worker wiring to the real Durable Object (mocked bankUnreadable; unit only)
  it("still answers a caller without the owner key with 403, without reading the bank", async () => {
    const bankUnreadable = vi.fn(async () => true);
    const res = await handleBankImageApi(req("POST", { auth: "Bearer wrong", body: pngBytes() }), deps({ bankUnreadable }));
    expect(res.status).toBe(403);
    expect(bankUnreadable).not.toHaveBeenCalled();
  });
});

/** An MP4/M4A start: a box size, "ftyp", then the major brand (docs/designs/uploaded-media.md D2). */
function ftypBytes(brand: string, totalLength = 32): Uint8Array {
  const arr = new Uint8Array(totalLength);
  arr.set([0, 0, 0, 0x20], 0);
  arr.set(new TextEncoder().encode("ftyp" + brand), 4);
  return arr;
}
const post = (body: Uint8Array, over: Partial<BankImageApiDeps> = {}) => handleBankImageApi(req("POST", { auth: `Bearer ${KEY}`, body }), deps(over));
/** A body with no Content-Length: a stream of `chunks` chunks of `size` bytes, the first carrying `head`. */
function streamReq(head: Uint8Array, size: number, chunks: number, onCancel: () => void) {
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (sent === chunks) return c.close();
      const chunk = new Uint8Array(size);
      if (sent === 0) chunk.set(head, 0);
      sent++;
      c.enqueue(chunk);
    },
    cancel: onCancel,
  });
  return new Request("https://worker.example.com/api/bank/image", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}` },
    body,
    duplex: "half",
  } as RequestInit);
}

describe("handleBankImageApi: video and audio", () => {
  it.each([
    ["an MP4 video", ftypBytes("isom"), "video/mp4"],
    ["an mp42 video", ftypBytes("mp42"), "video/mp4"],
    ["an M4A", ftypBytes("M4A "), "audio/mp4"],
    ["an MP3 with an ID3 tag", new TextEncoder().encode("ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0000"), "audio/mpeg"],
    ["a bare MP3 frame", new Uint8Array([0xff, 0xfb, 0x90, 0x44, 0, 0]), "audio/mpeg"],
  ])("stores %s under the sniffed Content-Type and returns it", async (_, body, contentType) => {
    const putImage = vi.fn(async () => ({ key: "k" }));
    const res = await post(body, { putImage });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ key: "k", contentType });
    expect(putImage).toHaveBeenCalledWith(expect.any(Uint8Array), contentType);
    expect((putImage.mock.calls[0] as unknown[])[0]).toHaveLength(body.byteLength);
  });

  it.each([["AVIF", "avif"], ["HEIC", "heic"], ["QuickTime", "qt  "], ["3GP", "3gp4"], ["DASH", "dash"], ["M4V", "M4V "]])(
    "rejects %s, a container it does not accept (400, in Chinese)",
    async (_, brand) => {
      const putImage = vi.fn();
      const res = await post(ftypBytes(brand), { putImage });
      expect(res.status).toBe(400);
      expect(await res.text()).toContain("不支援這種檔案");
      expect(putImage).not.toHaveBeenCalled();
    },
  );

  it("files a generic-brand MP4 as audio when the editor sent it as an M4A (many M4A files say isom/mp42)", async () => {
    const putImage = vi.fn(async () => ({ key: "k" }));
    const body = ftypBytes("isom");
    const res = await handleBankImageApi(
      new Request("https://worker.example.com/api/bank/image", { method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "audio/x-m4a" }, body: body as unknown as BodyInit }),
      deps({ putImage }),
    );
    expect(await res.json()).toEqual({ key: "k", contentType: "audio/mp4" });
    // The declared type never turns a non-MP4 into audio.
    const garbage = await handleBankImageApi(
      new Request("https://worker.example.com/api/bank/image", { method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "audio/mpeg" }, body: new TextEncoder().encode("not audio at all") as unknown as BodyInit }),
      deps({ putImage }),
    );
    expect(garbage.status).toBe(400);
  });

  it("rejects garbage bytes (400)", async () => {
    expect((await post(new TextEncoder().encode("this is not media at all"))).status).toBe(400);
  });

  it("accepts a video at exactly 25 MB and rejects one byte more (413)", async () => {
    const putImage = vi.fn(async () => ({ key: "k" }));
    expect((await post(ftypBytes("isom", MAX_MEDIA_BYTES), { putImage })).status).toBe(200);
    const res = await post(ftypBytes("isom", MAX_MEDIA_BYTES + 1), { putImage });
    expect(res.status).toBe(413);
    expect(await res.text()).toContain("25 MB");
    expect(putImage).toHaveBeenCalledOnce();
  });

  it("still caps an image at 5 MB though media may be 25 (413)", async () => {
    const res = await post(pngBytes(6 * 1024 * 1024));
    expect(res.status).toBe(413);
    expect(await res.text()).toContain("5 MB");
  });

  it("stops reading a body with no Content-Length once it passes 25 MB, and cancels it", async () => {
    const onCancel = vi.fn();
    const putImage = vi.fn();
    const res = await handleBankImageApi(streamReq(ftypBytes("isom"), 1024 * 1024, 40, onCancel), deps({ putImage }));
    expect(res.status).toBe(413);
    expect(onCancel).toHaveBeenCalled();
    expect(putImage).not.toHaveBeenCalled();
  });

  it("stores exactly the bytes a chunked body sent", async () => {
    const putImage = vi.fn(async () => ({ key: "k" }));
    const res = await handleBankImageApi(streamReq(ftypBytes("isom"), 1000, 3, () => {}), deps({ putImage }));
    expect(res.status).toBe(200);
    expect((putImage.mock.calls[0] as unknown[])[0]).toHaveLength(3000);
  });

  it("asks for the owner key on a video too (403)", async () => {
    const putImage = vi.fn();
    const res = await handleBankImageApi(req("POST", { body: ftypBytes("isom") }), deps({ putImage }));
    expect(res.status).toBe(403);
    expect(putImage).not.toHaveBeenCalled();
  });
});
