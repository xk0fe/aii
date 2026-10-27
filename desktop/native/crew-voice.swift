// crew-voice: on-device dictation for Crew's chat. Nothing leaves the Mac.
//
// stdin:  16 kHz mono Float32 PCM (little-endian), streamed while you talk. Closing stdin means "stop".
// stdout: one JSON object per line
//   {"type":"installing","progress":0.4}           first use of a language: Apple's speech model downloads
//   {"type":"ready","locale":"en_US"}               listening
//   {"type":"text","final":"…","volatile":"…"}      everything heard so far: settled words + words still changing
//   {"type":"done","text":"…"}                      after stdin closes, the finished transcript
//   {"type":"error","message":"…"}
//
// --locales prints {"type":"locales","options":[{"id":"ru_RU","label":"Русский","installed":true},…]} instead:
// the languages you use (System Settings › Language & Region) that dictation supports, installed ones first.
//
// macOS 26+ uses SpeechAnalyzer's DictationTranscriber (punctuated, on-device). Older macOS falls back to
// SFSpeechRecognizer, on-device only (languages that would need Apple's servers are refused). It needs the app's
// speech-recognition permission: pass --may-ask-permission only from an app bundle whose Info.plist explains it
// (Crew.app), or macOS stops the process.
//
// --locale=<id> picks the language (default: the system's).
//
// Build: swiftc -O -parse-as-library native/crew-voice.swift -o dist/crew-voice   (core/voice.js does this)
// Try it: say -o /tmp/s.wav --data-format=LEF32@16000 "hello crew" && tail -c +4097 /tmp/s.wav | dist/crew-voice
@preconcurrency import AVFoundation
import Foundation
import Speech

let input = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false)!
let output = FileHandle.standardOutput
let lock = NSLock()

func emit(_ object: [String: Any]) {
  guard var data = try? JSONSerialization.data(withJSONObject: object) else { return }
  data.append(0x0A)
  lock.lock()
  try? output.write(contentsOf: data) // nobody reading any more (Crew quit): don't crash over it
  lock.unlock()
}

struct Failure: LocalizedError {
  let message: String
  var errorDescription: String? { message }
}

// "Hello." + "how are you" -> "Hello. how are you": pieces arrive without the space between them.
func join(_ a: String, _ b: String) -> String {
  if a.isEmpty || b.isEmpty { return a + b }
  if a.last!.isWhitespace || b.first!.isWhitespace { return a + b }
  if let c = b.unicodeScalars.first, CharacterSet.punctuationCharacters.contains(c) { return a + b }
  return a + " " + b
}

// Reads stdin on its own thread and hands over PCM buffers in `input`'s format; nil once stdin closes.
func readAudio(_ deliver: @escaping (AVAudioPCMBuffer?) -> Void) {
  Thread {
    var carry = Data()
    while true {
      let chunk = FileHandle.standardInput.availableData
      if chunk.isEmpty { break }
      carry.append(chunk)
      let frames = carry.count / 4
      if frames == 0 { continue }
      guard let buffer = AVAudioPCMBuffer(pcmFormat: input, frameCapacity: AVAudioFrameCount(frames)) else { continue }
      buffer.frameLength = AVAudioFrameCount(frames)
      carry.withUnsafeBytes { raw in
        let samples = raw.bindMemory(to: Float32.self)
        buffer.floatChannelData![0].update(from: samples.baseAddress!, count: frames)
      }
      carry.removeFirst(frames * 4)
      deliver(buffer)
    }
    deliver(nil)
  }.start()
}

func wantedLocale() -> Locale {
  if let arg = CommandLine.arguments.first(where: { $0.hasPrefix("--locale=") }), arg.count > 9 { return Locale(identifier: String(arg.dropFirst(9))) }
  return Locale.current
}

@available(macOS 26.0, *)
func dictate(_ wanted: Locale) async throws {
  guard let locale = await DictationTranscriber.supportedLocale(equivalentTo: wanted) else {
    throw Failure(message: "Dictation doesn't support \(wanted.identifier) on this Mac yet")
  }
  let transcriber = DictationTranscriber(locale: locale, preset: .progressiveLongDictation)

  // First use of a language: download Apple's on-device model, reporting progress.
  if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
    let reporter = Task {
      while !Task.isCancelled {
        emit(["type": "installing", "progress": request.progress.fractionCompleted])
        try? await Task.sleep(for: .milliseconds(300))
      }
    }
    defer { reporter.cancel() }
    try await request.downloadAndInstall()
  }

  guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]) else {
    throw Failure(message: "No audio format works for dictation")
  }
  guard let converter = AVAudioConverter(from: input, to: format) else { throw Failure(message: "Can't convert audio for dictation") }
  let (inputs, feed) = AsyncStream<AnalyzerInput>.makeStream()
  let analyzer = SpeechAnalyzer(modules: [transcriber])

  // Settled text grows; the volatile tail is replaced by every newer guess until it settles too.
  let results = Task {
    var settled = ""
    for try await result in transcriber.results {
      let text = String(result.text.characters)
      if result.isFinal {
        settled = join(settled, text)
        emit(["type": "text", "final": settled, "volatile": ""])
      } else {
        emit(["type": "text", "final": settled, "volatile": text])
      }
    }
    return settled
  }

  try await analyzer.start(inputSequence: inputs)
  emit(["type": "ready", "locale": locale.identifier])

  await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
    readAudio { buffer in
      guard let buffer else {
        feed.finish()
        return done.resume()
      }
      let ratio = format.sampleRate / input.sampleRate
      let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up)) + 16
      guard let converted = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { return }
      var fed = false
      var error: NSError?
      converter.convert(to: converted, error: &error) { _, status in
        if fed {
          status.pointee = .noDataNow
          return nil
        }
        fed = true
        status.pointee = .haveData
        return buffer
      }
      if error == nil, converted.frameLength > 0 { feed.yield(AnalyzerInput(buffer: converted)) }
    }
  }

  try await analyzer.finalizeAndFinishThroughEndOfInput()
  emit(["type": "done", "text": try await results.value])
}

// Your languages, in your order, as dictation locales; at most one per language.
func locales() async -> [[String: Any]] {
  var wanted = Locale.preferredLanguages.map { Locale(identifier: $0) }
  wanted.append(Locale.current)
  var seen = Set<String>()
  var options: [[String: Any]] = []
  for locale in wanted {
    var match: Locale?
    var installed = false
    if #available(macOS 26.0, *) {
      match = await DictationTranscriber.supportedLocale(equivalentTo: locale)
      if let m = match { installed = await DictationTranscriber.installedLocales.contains { $0.identifier == m.identifier } }
    } else if let r = SFSpeechRecognizer(locale: locale), r.supportsOnDeviceRecognition {
      match = r.locale // only languages it can do on this Mac
      installed = true
    }
    guard let m = match, let language = m.language.languageCode?.identifier, !seen.contains(language) else { continue }
    seen.insert(language)
    let label = m.localizedString(forLanguageCode: language)?.capitalized(with: m) ?? m.identifier
    options.append(["id": m.identifier, "label": label, "installed": installed])
  }
  return options.filter { $0["installed"] as! Bool } + options.filter { !($0["installed"] as! Bool) }
}

// macOS 13–15: the older recognizer, on-device where the language allows it.
func recognize(_ locale: Locale) async throws {
  guard CommandLine.arguments.contains("--may-ask-permission") else {
    throw Failure(message: "Voice input on this version of macOS needs Crew.app (npm start), or macOS 26")
  }
  let status = await withCheckedContinuation { c in SFSpeechRecognizer.requestAuthorization { c.resume(returning: $0) } }
  guard status == .authorized else {
    throw Failure(message: "Crew isn't allowed to use speech recognition. Turn it on in System Settings › Privacy & Security › Speech Recognition")
  }
  guard let recognizer = SFSpeechRecognizer(locale: locale), recognizer.isAvailable else {
    throw Failure(message: "Speech recognition isn't available for \(locale.identifier)")
  }
  // Your voice stays on this Mac: a language that would need Apple's servers isn't used at all.
  guard recognizer.supportsOnDeviceRecognition else {
    throw Failure(message: "Dictation in \(locale.identifier) needs macOS 26 to stay on this Mac")
  }
  let request = SFSpeechAudioBufferRecognitionRequest()
  request.shouldReportPartialResults = true
  request.addsPunctuation = true
  request.requiresOnDeviceRecognition = true

  let text: String = try await withCheckedThrowingContinuation { finished in
    var heard = ""
    var over = false
    let task = recognizer.recognitionTask(with: request) { result, error in
      if over { return }
      if let result {
        heard = result.bestTranscription.formattedString
        emit(["type": "text", "final": "", "volatile": heard])
        if result.isFinal {
          over = true
          return finished.resume(returning: heard)
        }
      }
      if let error {
        over = true
        // ending with silence reports "no speech": that's an empty message, not a failure
        if heard.isEmpty, (error as NSError).code == 1110 { return finished.resume(returning: "") }
        if !heard.isEmpty { return finished.resume(returning: heard) }
        finished.resume(throwing: error)
      }
    }
    emit(["type": "ready", "locale": locale.identifier])
    readAudio { buffer in
      if let buffer { request.append(buffer) } else { request.endAudio() }
    }
    _ = task
  }
  emit(["type": "done", "text": text])
}

@main
struct CrewVoice {
  static func main() async {
    signal(SIGPIPE, SIG_IGN)
    if CommandLine.arguments.contains("--locales") {
      emit(["type": "locales", "options": await locales()])
      exit(0)
    }
    do {
      if #available(macOS 26.0, *) {
        try await dictate(wantedLocale())
      } else {
        try await recognize(wantedLocale())
      }
      exit(0)
    } catch {
      emit(["type": "error", "message": error.localizedDescription])
      exit(1)
    }
  }
}
