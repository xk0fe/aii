// crew-voice for Windows: on-device dictation for Crew's chat. Nothing leaves the PC.
// The same helper as native/crew-voice.swift, speaking the same protocol, so core/voice.js and the chat can't tell them apart.
//
// stdin:  16 kHz mono Float32 PCM (little-endian), streamed while you talk. Closing stdin means "stop".
// stdout: one JSON object per line
//   {"type":"ready","locale":"en-US"}               listening
//   {"type":"text","final":"…","volatile":"…"}      everything heard so far: settled words + words still changing
//   {"type":"done","text":"…"}                      after stdin closes, the finished transcript
//   {"type":"error","message":"…"}
//
// --locales prints {"type":"locales","options":[{"id":"ru-RU","label":"Русский","installed":true},…]} instead:
// the languages you use (Settings › Time & language › Language & region) that dictation supports. All of them are
// installed: one model covers every language.
//
// Windows' own dictation (Windows.Media.SpeechRecognition) sends your voice to Microsoft, so this runs OpenAI's Whisper
// on the CPU instead, through whisper.cpp (Whisper.net), with the multilingual base model shipped next to it:
// models/ggml-base-q5_1.bin (or CREW_VOICE_MODEL=<file>). Whisper doesn't stream: while you talk it reads again what
// you said since the last pause about once a second (the words still changing), and a pause settles them.
//
// --locale=<id> picks the language (en-US, en_US or en; default: Windows' display language).
// --may-ask-permission is accepted and ignored: the microphone belongs to the chat window, and Windows asks for it there.
// CREW_VOICE_DEBUG=1 writes how long each reading took to stderr.
//
// Build: npm run voice -- win (scripts/build-voice.mjs: dotnet publish for win-x64 and win-arm64, plus the model) into
//        dist/voice/win-<arch>/; -r osx-arm64 by hand to try it on a Mac. Check it: node native/windows/smoke.mjs <exe>
// Try it (on a Mac): say -o /tmp/s.wav --data-format=LEF32@16000 "hello crew" && tail -c +4097 /tmp/s.wav | <out>/crew-voice
using System.Buffers;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.RegularExpressions;
using Whisper.net;

if (args.Contains("--locales")) {
  try {
    Out.Locales(Locales());
    return 0;
  } catch (Exception e) {
    Out.Error(e.Message);
    return 1;
  }
}

var audio = new Audio();
audio.Listen(); // from the start: words said while the model loads aren't lost

try {
  var (id, code) = WantedLanguage(args.FirstOrDefault((a) => a.StartsWith("--locale="))?["--locale=".Length..] ?? "");
  var model = Environment.GetEnvironmentVariable("CREW_VOICE_MODEL") is { Length: > 0 } m ? m : Path.Combine(AppContext.BaseDirectory, "models", ModelFile);
  if (!File.Exists(model)) throw new Failure($"Voice input's speech model is missing ({model}). Reinstall Crew to get it back");
  using var factory = WhisperFactory.FromPath(model, new WhisperFactoryOptions { UseGpu = false }); // the CPU: what every PC has
  await using var whisper = factory.CreateBuilder()
    .WithLanguage(code)
    // Few threads: Whisper's threads wait for each other spinning, and on a PC busy with agents, more of them is slower.
    .WithThreads(Math.Clamp(Environment.ProcessorCount / 2, 1, 4))
    // Half of Whisper's 30 s window, twice as fast; no reading is longer than that (Read splits them).
    .WithAudioContextSize(AudioContext)
    .WithNoSpeechThreshold(0.6f)
    .Build();
  Out.Ready(id);
  Out.Done(await Dictate(audio, whisper));
  return 0;
} catch (Exception e) {
  Out.Error(e is Failure ? e.Message : $"Voice input stopped: {e.Message}");
  return 1;
}

// Listens until stdin closes; returns the finished transcript.
static async Task<string> Dictate(Audio audio, WhisperProcessor whisper) {
  const int Every = 1200; // ms between readings while you talk
  const int Pause = 700 / 30; // frames of quiet that settle what came before them
  const int Longest = 12 * Rate; // past this without a pause, settle all but the last segment
  var settled = "";
  var shown = ("", "");
  var read = 0; // samples in the tail at the last reading
  var fresh = true; // nothing read since the last settle: read as soon as there's a second of it
  var since = Stopwatch.StartNew();
  void Show(string final, string volatile_) {
    if (shown == (final, volatile_)) return;
    shown = (final, volatile_);
    Out.Text(final, volatile_);
  }
  void Settle(string text, int samples) {
    settled = Join(settled, text);
    audio.Drop(samples);
    fresh = true;
  }

  while (true) {
    audio.Wait(100);
    var ended = audio.Ended;
    var count = audio.Count;
    var due = since.ElapsedMilliseconds >= Every || (fresh && count >= Rate);
    if (!ended && (count == read || !due)) continue;
    var (tail, voiced) = audio.Snapshot();
    if (Talked(voiced) < Rate / 5) { // under 0.2 s of anything: nothing said since the last settle
      if (ended) return settled;
      if (tail.Length > 3 * Rate) audio.Drop(tail.Length - Rate / 2); // keep half a second of quiet, lose the rest
      read = audio.Count;
      continue;
    }
    fresh = false;
    if (ended) return Join(settled, Joined(await Read(whisper, tail, voiced)));

    var took = Stopwatch.StartNew();
    var pause = LastPause(voiced, Pause);
    if (pause > 0) { // what came before a pause won't change any more: settle it; the rest is read next
      var cut = Math.Min(tail.Length, pause * Frame);
      var before = await Read(whisper, tail[..cut], voiced[..(cut / Frame)]);
      Settle(Joined(before), cut);
      Show(settled, "");
    } else {
      var segments = await Read(whisper, tail, voiced);
      var keep = segments.Count >= 2 ? (int)(segments[^1].Start.TotalSeconds * Rate) : 0; // where the last segment starts
      if (tail.Length > Longest && keep >= Rate && keep < tail.Length) {
        Settle(Joined(segments.Take(segments.Count - 1)), keep);
        Show(settled, segments[^1].Text);
      } else if (tail.Length > Longest) {
        Settle(Joined(segments), tail.Length);
        Show(settled, "");
      } else {
        Show(settled, Joined(segments));
      }
    }
    if (Debug) Console.Error.WriteLine($"read {tail.Length / (double)Rate:0.0}s in {took.ElapsedMilliseconds}ms{(pause > 0 ? " (pause)" : "")}: {shown.Item1} | {shown.Item2}");
    since.Restart();
    read = audio.Count;
  }
}

// Where the last stretch of quiet that came after someone talking ends, as a frame to cut at (its middle, or the end
// when it runs to the end); 0 when there's none.
static int LastPause(bool[] voiced, int frames) {
  var run = 0;
  for (var f = voiced.Length - 1; f >= 0; f--) {
    if (!voiced[f]) {
      run++;
      continue;
    }
    if (run >= frames) return f + 1 + run == voiced.Length ? voiced.Length : f + 1 + run / 2;
    run = 0;
  }
  return 0;
}

// What Whisper hears in `samples`, as segments from its start, with its made-up words (said into silence, or the
// sounds it labels) left out. Longer than one reading takes, it's read in pieces cut where it's quiet.
static async Task<List<(TimeSpan Start, string Text)>> Read(WhisperProcessor whisper, float[] samples, bool[] voiced) {
  var segments = new List<(TimeSpan Start, string Text)>();
  var at = 0;
  while (at < samples.Length) {
    var end = samples.Length;
    if (end - at > MaxRead) { // cut in the middle of the longest quiet between 8 and 14 s in, not inside a word
      end = at + MaxRead;
      var (best, run) = (0, 0);
      for (int f = (at + 8 * Rate) / Frame, last = Math.Min(voiced.Length, (at + MaxRead) / Frame); f < last; f++) {
        run = voiced[f] ? 0 : run + 1;
        if (run >= best && run > 0) (best, end) = (run, (f + 1 - run / 2) * Frame);
      }
    }
    var piece = samples[at..end];
    var heard = new List<(TimeSpan Start, string Text)>();
    var input = piece.Length >= Rate + Rate / 10 ? piece : [.. piece, .. new float[Rate + Rate / 10 - piece.Length]]; // it wants a second at least
    await foreach (var s in whisper.ProcessAsync(input)) {
      var text = Clean(s.Text);
      if (text.Length > 0) heard.Add((s.Start + TimeSpan.FromSeconds(at / (double)Rate), text));
    }
    // Whisper's favourite inventions, when there was barely anything to hear
    var talked = Talked(voiced[Math.Min(voiced.Length, at / Frame)..Math.Min(voiced.Length, end / Frame)]);
    if (talked < Rate * 3 / 2 && heard.Count == 1 && Invented.Contains(Normal(heard[0].Text))) heard.Clear();
    segments.AddRange(heard);
    at = end;
  }
  return segments;
}

static int Talked(bool[] voiced) => voiced.Count((v) => v) * Frame;

static string Joined(IEnumerable<(TimeSpan Start, string Text)> segments) => segments.Aggregate("", (a, s) => Join(a, s.Text));

// "Hello." + "how are you" -> "Hello. how are you": pieces arrive without the space between them.
static string Join(string a, string b) {
  if (a.Length == 0 || b.Length == 0) return a + b;
  if (char.IsWhiteSpace(a[^1]) || char.IsWhiteSpace(b[0])) return a + b;
  if (char.IsPunctuation(b[0])) return a + b;
  return a + " " + b;
}

// Sounds Whisper writes down instead of words: [BLANK_AUDIO], (music), *laughs*, ♪
static string Clean(string text) => Regex.Replace(Regex.Replace(text, @"\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|[♪♫]+|<\|[^|]*\|>", " "), @"\s+", " ").Trim();

static string Normal(string text) => Regex.Replace(text.ToLowerInvariant(), @"[\p{P}\s]+", " ").Trim();

// --locale's id -> (the id to report, Whisper's language code)
static (string id, string code) WantedLanguage(string wanted) {
  var id = wanted.Replace('_', '-');
  if (id.Length == 0) id = CultureInfo.CurrentUICulture.Name is { Length: > 0 } ui ? ui : "en-US";
  try {
    id = CultureInfo.GetCultureInfo(id).Name;
  } catch (CultureNotFoundException) {}
  var code = WhisperCode(id);
  if (!Supported.Value.Contains(code)) throw new Failure($"Dictation doesn't support {id} on this PC yet");
  return (id, code);
}

static string WhisperCode(string id) {
  var lang = id.Split('-', '_')[0].ToLowerInvariant();
  return lang switch { "nb" => "no", "iw" => "he", "in" => "id", "fil" => "tl", "jv" => "jw", _ => lang };
}

// Your languages, in your order, that Whisper knows; at most one per language.
static List<(string id, string label)> Locales() {
  var seen = new HashSet<string>();
  var options = new List<(string, string)>();
  foreach (var raw in UserLanguages()) {
    string id;
    try {
      id = CultureInfo.GetCultureInfo(raw.Replace('_', '-')).Name;
    } catch (CultureNotFoundException) {
      continue;
    }
    var code = WhisperCode(id);
    if (id.Length == 0 || !Supported.Value.Contains(code) || !seen.Add(code)) continue;
    var language = CultureInfo.GetCultureInfo(id.Split('-')[0]);
    options.Add((id, language.TextInfo.ToTitleCase(language.NativeName)));
  }
  return options;
}

// The languages in Settings › Time & language › Language & region, then the display language and the formats'.
static IEnumerable<string> UserLanguages() {
  if (OperatingSystem.IsWindows()) {
    string[]? list = null;
    try {
      using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Control Panel\International\User Profile");
      list = key?.GetValue("Languages") as string[];
    } catch {}
    foreach (var l in list ?? []) yield return l;
  }
  yield return CultureInfo.CurrentUICulture.Name;
  yield return CultureInfo.CurrentCulture.Name;
}

partial class Program {
  const int Rate = 16000;
  const int Frame = 480; // 30 ms
  const int AudioContext = 768; // Whisper's encoder positions: 50 a second, so 15.36 s
  const int MaxRead = 14 * Rate; // the longest piece one reading takes, inside AudioContext
  const string ModelFile = "ggml-base-q5_1.bin";
  static readonly bool Debug = Environment.GetEnvironmentVariable("CREW_VOICE_DEBUG") == "1";

  static readonly Lazy<HashSet<string>> Supported = new(() => [.. WhisperFactory.GetSupportedLanguages()]);

  static readonly HashSet<string> Invented = [
    "you", "thank you", "thanks", "thanks for watching", "thank you for watching", "bye", "okay", "so",
    "subtitles by the amara org community", "продолжение следует", "спасибо", "спасибо за внимание", "субтитры сделал dimatorzok",
    "vielen dank", "untertitel im auftrag des zdf für funk 2017", "merci", "sous titrage société radio canada", "gracias",
  ];
}

sealed class Failure(string message) : Exception(message);

// What stdin brought since the last settle, filled by a thread of its own, and for each 30 ms of it whether someone's
// talking: louder than the room by a margin (the room's level follows the quietest moments, rising slowly).
sealed class Audio {
  const int Frame = 480;
  readonly object gate = new();
  readonly List<float> samples = new(16000 * 30);
  readonly List<bool> voiced = new(1000);
  readonly AutoResetEvent arrived = new(false);
  float room = 0.002f;
  volatile bool ended;

  public bool Ended => ended;

  public int Count {
    get {
      lock (gate) return samples.Count;
    }
  }

  public void Listen() {
    new Thread(() => {
      var stdin = Console.OpenStandardInput();
      var bytes = new byte[32768];
      var carry = 0;
      while (true) {
        int n;
        try {
          n = stdin.Read(bytes, carry, bytes.Length - carry);
        } catch (IOException) {
          n = 0;
        }
        if (n <= 0) break;
        var whole = (carry + n) / 4 * 4;
        var floats = MemoryMarshal.Cast<byte, float>(bytes.AsSpan(0, whole));
        lock (gate) {
          foreach (var f in floats) samples.Add(float.IsFinite(f) ? f : 0);
          while (samples.Count - voiced.Count * Frame >= Frame) {
            double sum = 0;
            for (int i = voiced.Count * Frame, e = i + Frame; i < e; i++) sum += samples[i] * samples[i];
            var level = (float)Math.Sqrt(sum / Frame);
            room = level < room ? Math.Max(level, 0.0005f) : room * 1.005f;
            voiced.Add(level > Math.Clamp(room * 3, 0.006f, 0.03f));
          }
        }
        carry = carry + n - whole;
        Buffer.BlockCopy(bytes, whole, bytes, 0, carry);
        arrived.Set();
      }
      ended = true;
      arrived.Set();
    }) { IsBackground = true, Name = "stdin" }.Start();
  }

  public void Wait(int ms) => arrived.WaitOne(ms);

  public (float[] samples, bool[] voiced) Snapshot() {
    lock (gate) return ([.. samples], [.. voiced]);
  }

  // Forget the first `count` samples (whole frames of them): they're settled.
  public void Drop(int count) {
    lock (gate) {
      var frames = Math.Min(count, samples.Count) / Frame;
      samples.RemoveRange(0, frames * Frame);
      voiced.RemoveRange(0, Math.Min(frames, voiced.Count));
    }
  }
}

// One JSON object per line, whole lines only, even from two threads; nobody reading any more (Crew quit) is fine.
static class Out {
  static readonly Stream stdout = Console.OpenStandardOutput();
  static readonly object gate = new();
  static bool gone;

  static void Emit(Action<Utf8JsonWriter> fields) {
    var buffer = new ArrayBufferWriter<byte>();
    using (var w = new Utf8JsonWriter(buffer, new JsonWriterOptions { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping })) {
      w.WriteStartObject();
      fields(w);
      w.WriteEndObject();
    }
    lock (gate) {
      if (gone) return;
      try {
        stdout.Write(buffer.WrittenSpan);
        stdout.WriteByte((byte)'\n');
        stdout.Flush();
      } catch (Exception e) when (e is IOException or ObjectDisposedException) {
        gone = true;
      }
    }
  }

  public static void Ready(string locale) => Emit((w) => {
    w.WriteString("type", "ready");
    w.WriteString("locale", locale);
  });

  public static void Text(string final, string volatile_) => Emit((w) => {
    w.WriteString("type", "text");
    w.WriteString("final", final);
    w.WriteString("volatile", volatile_);
  });

  public static void Done(string text) => Emit((w) => {
    w.WriteString("type", "done");
    w.WriteString("text", text);
  });

  public static void Error(string message) => Emit((w) => {
    w.WriteString("type", "error");
    w.WriteString("message", message);
  });

  public static void Locales(List<(string id, string label)> options) => Emit((w) => {
    w.WriteString("type", "locales");
    w.WriteStartArray("options");
    foreach (var (id, label) in options) {
      w.WriteStartObject();
      w.WriteString("id", id);
      w.WriteString("label", label);
      w.WriteBoolean("installed", true);
      w.WriteEndObject();
    }
    w.WriteEndArray();
  });
}
