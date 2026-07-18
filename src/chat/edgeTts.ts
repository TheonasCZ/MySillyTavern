import type { TtsBackend, TtsSpeakOptions, TtsVoice } from "./ttsBackend";

// ---------------------------------------------------------------------------
// Hardcoded Edge-TTS voice list — we ship the known Czech + English voices
// so listVoices() works without a network round-trip. The msedge-tts package
// can fetch the full list via getVoices(), but that needs an HTTP call.
// ---------------------------------------------------------------------------

const EDGE_VOICES: TtsVoice[] = [
  // Czech
  { id: "cs-CZ-VlastaNeural", name: "Vlasta", lang: "cs-CZ", backend: "edge-tts" },
  { id: "cs-CZ-AntoninNeural", name: "Antonin", lang: "cs-CZ", backend: "edge-tts" },
  // English
  { id: "en-US-AriaNeural", name: "Aria", lang: "en-US", backend: "edge-tts" },
  { id: "en-US-GuyNeural", name: "Guy", lang: "en-US", backend: "edge-tts" },
  { id: "en-US-JennyNeural", name: "Jenny", lang: "en-US", backend: "edge-tts" },
  { id: "en-GB-SoniaNeural", name: "Sonia", lang: "en-GB", backend: "edge-tts" },
  { id: "en-GB-RyanNeural", name: "Ryan", lang: "en-GB", backend: "edge-tts" },
  // German
  { id: "de-DE-KatjaNeural", name: "Katja", lang: "de-DE", backend: "edge-tts" },
  { id: "de-DE-ConradNeural", name: "Conrad", lang: "de-DE", backend: "edge-tts" },
];

// ---------------------------------------------------------------------------
// Lazy-load the msedge-tts package — it pulls in Node.js built-ins (stream,
// fs, buffer) that are NOT available in a vanilla Tauri/Vite webview.  We
// wrap every import in a try/catch so the frontend never crashes on import.
// When the package can't be loaded the backend always throws, and the
// TtsManager automatically falls through to the Web Speech backend.
// ---------------------------------------------------------------------------

type MsEdgeTTSModule = typeof import("msedge-tts");

async function loadEdgeTtsPackage(): Promise<MsEdgeTTSModule> {
  // Dynamic import — fails at runtime in browser if Node polyfills are missing
  return import("msedge-tts");
}

export class EdgeTts implements TtsBackend {
  readonly id = "edge-tts" as const;
  readonly label = "Edge-TTS";

  private audioContext: AudioContext | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private running = false;
  private ttsInstance: unknown = null;

  get isSpeaking(): boolean {
    return this.running;
  }

  private getAudioContext(): AudioContext {
    if (!this.audioContext) {
      const ctxCtor =
        (typeof window !== "undefined" &&
          (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)) ||
        null;
      if (!ctxCtor) {
        throw new Error("AudioContext not available");
      }
      this.audioContext = new ctxCtor();
    }
    return this.audioContext;
  }

  async speak(text: string, options?: TtsSpeakOptions): Promise<void> {
    console.log("[EdgeTts] speak() called with text:", text.slice(0, 60) + (text.length > 60 ? "…" : ""));

    if (typeof window === "undefined") {
      throw new Error("Edge-TTS requires a browser environment");
    }

    // 1. Dynamically load the package
    const pkg = await loadEdgeTtsPackage();
    console.log("[EdgeTts] msedge-tts package loaded successfully");
    const { MsEdgeTTS, OUTPUT_FORMAT } = pkg;

    // 2. Create and configure TTS instance
    const voiceId = options?.voice || "cs-CZ-VlastaNeural";
    const tts = new MsEdgeTTS({ enableLogger: false });
    this.ttsInstance = tts;

    // 3. Set metadata — voice + output format
    await tts.setMetadata(voiceId, OUTPUT_FORMAT.WEBM_24KHZ_16BIT_MONO_OPUS);

    // 4. Build prosody options
    const prosodyOpts: Record<string, string | number> = {};
    if (options?.rate !== undefined) {
      prosodyOpts.rate = options.rate;
    }
    if (options?.pitch !== undefined) {
      // Convert Hz offset to SSML pitch string (e.g. "+10Hz" or "-5Hz")
      const hz = Math.round(options.pitch);
      prosodyOpts.pitch = `${hz >= 0 ? "+" : ""}${hz}Hz`;
    }

    // 5. Synthesize to stream
    const { audioStream } = tts.toStream(text, prosodyOpts);

    // 6. Collect audio chunks into a single ArrayBuffer
    const chunks: Uint8Array[] = [];
    for await (const chunk of readableToAsyncIterable(audioStream)) {
      if (chunk) {
        chunks.push(
          chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as ArrayBuffer),
        );
      }
    }

    if (chunks.length === 0) {
      tts.close();
      throw new Error("Edge-TTS returned no audio data");
    }

    // 7. Concatenate and decode
    const totalLen = chunks.reduce((s, c) => s + c.length, 0);
    const combined = new Uint8Array(totalLen);
    let offset = 0;
    for (const c of chunks) {
      combined.set(c, offset);
      offset += c.length;
    }

    const ctx = this.getAudioContext();

    // Resume context if suspended (autoplay policy)
    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    const audioBuffer = await ctx.decodeAudioData(combined.buffer.slice(0));

    // 8. Play
    this.running = true;
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    this.sourceNode = source;

    return new Promise<void>((resolve, _reject) => {
      source.onended = () => {
        this.running = false;
        this.sourceNode = null;
        tts.close();
        resolve();
      };
      source.start(0);
    });
  }

  stop(): void {
    this.running = false;
    if (this.sourceNode) {
      try {
        this.sourceNode.stop();
      } catch {
        // Already stopped
      }
      this.sourceNode = null;
    }
    if (this.ttsInstance) {
      try {
        (this.ttsInstance as { close(): void }).close();
      } catch {
        // ignore
      }
      this.ttsInstance = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
  }

  async listVoices(): Promise<TtsVoice[]> {
    // Try fetching the live list from Microsoft, falling back to our hardcoded set
    try {
      const pkg = await loadEdgeTtsPackage();
      const tts = new pkg.MsEdgeTTS();
      const voices = await tts.getVoices();
      tts.close();
      return voices
        .filter(
          (v: { ShortName: string; FriendlyName: string; Locale: string }) =>
            v.Locale.startsWith("cs-") || v.Locale.startsWith("en-") || v.Locale.startsWith("de-"),
        )
        .map((v: { ShortName: string; FriendlyName: string; Locale: string }) => ({
          id: v.ShortName,
          name: v.FriendlyName,
          lang: v.Locale,
          backend: "edge-tts" as const,
        }));
    } catch {
      return EDGE_VOICES;
    }
  }
}

// ---------------------------------------------------------------------------
// Helper: convert a Node.js Readable stream into an async iterable.
// This bridges the gap between the Node stream returned by toStream() and
// the Promise-based consumption in the browser.
// We use a minimal interface to avoid a hard dependency on @types/node.
// ---------------------------------------------------------------------------
interface MinimalReadable {
  on(event: "data", cb: (data: Uint8Array) => void): void;
  on(event: "end", cb: () => void): void;
  on(event: "error", cb: (err: Error) => void): void;
  on(event: string, cb: (...args: unknown[]) => void): void;
  removeListener(event: string, cb: (...args: unknown[]) => void): void;
}

async function* readableToAsyncIterable(
  stream: MinimalReadable,
): AsyncIterable<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let done = false;
  let error: Error | null = null;

  const onData = (data: Uint8Array) => {
    chunks.push(data);
  };
  const onEnd = () => {
    done = true;
  };
  const onError = (err: Error) => {
    error = err;
  };

  stream.on("data", onData);
  stream.on("end", onEnd);
  stream.on("error", onError);

  // Poll-and-yield loop (Node streams don't natively support async iteration
  // in all bundler setups)
  while (!done && !error) {
    await new Promise<void>((resolve) => {
      if (done || error) {
        resolve();
        return;
      }
      const check = () => {
        if (chunks.length > 0 || done || error) {
          stream.removeListener("data", check);
          stream.removeListener("end", check);
          stream.removeListener("error", check);
          resolve();
        }
      };
      stream.on("data", check);
      stream.on("end", check);
      stream.on("error", check);
    });

    while (chunks.length > 0) {
      yield chunks.shift()!;
    }
  }

  (stream as MinimalReadable).removeListener("data", onData as (...args: unknown[]) => void);
  (stream as MinimalReadable).removeListener("end", onEnd as (...args: unknown[]) => void);
  (stream as MinimalReadable).removeListener("error", onError as (...args: unknown[]) => void);

  if (error) throw error;
}
