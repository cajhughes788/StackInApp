import Foundation
import Capacitor
import Speech
import AVFoundation

// Voice entry's listener (frontend/plugins/NativeSpeech.ts). Turns speech into
// text with Apple's speech recognition — on the phone itself when the iPhone
// supports it — and hands back only the text. 521 never receives audio.
//
// Why our own plugin instead of a community one: it passes word hints
// (payment names, the person's positions) so "Zelle" isn't heard as "sell",
// asks for on-phone recognition, decides when the person has finished
// talking (by the sound itself, not only by when words come back, which can
// lag a second or more), and gives the microphone back afterward so paused music resumes.
//
// Events: "partial" { text } while listening; "finished" { text, reason }
// once, when listening ends (reason: silence, stopped, limit, final,
// interrupted, error). cancel() ends without a "finished" event.

@objc(NativeSpeechPlugin)
public class NativeSpeechPlugin: CAPPlugin, CAPBridgedPlugin {
  public let identifier = "NativeSpeechPlugin"
  public let jsName = "NativeSpeech"
  public let pluginMethods: [CAPPluginMethod] = [
    CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "stopSpeaking", returnType: CAPPluginReturnPromise)
  ]

  private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
  private let audioEngine = AVAudioEngine()
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var task: SFSpeechRecognitionTask?
  private var latestText = ""
  private var active = false
  private var silenceMs = 2500
  private var firstWordsMs = 8000
  private var limitTimer: DispatchWorkItem?
  // When listening started, and the last time we heard talking: new words, or
  // sound clearly louder than the room.
  private var startedAt: CFTimeInterval = 0
  private var lastHeardAt: CFTimeInterval = 0
  // The room's quiet level in dB. It drops at once to quieter sound and creeps
  // up slowly, so steady noise (a fan, a busy bar) stops counting as talking.
  private var roomLevelDb: Float = -50
  private var checkTimer: Timer?
  private var interruptionObserver: NSObjectProtocol?
  // Ask 521 reads its answer aloud with the iPhone's own voice (on the phone).
  private let synthesizer = AVSpeechSynthesizer()

  override public func load() {
    synthesizer.delegate = self
    // A call or Siri taking the microphone ends listening with what was heard.
    interruptionObserver = NotificationCenter.default.addObserver(
      forName: AVAudioSession.interruptionNotification,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      self?.finish(reason: "interrupted")
    }
  }

  deinit {
    if let interruptionObserver {
      NotificationCenter.default.removeObserver(interruptionObserver)
    }
  }

  // MARK: - Permissions

  private func speechPermission() -> String {
    switch SFSpeechRecognizer.authorizationStatus() {
    case .authorized: return "granted"
    case .notDetermined: return "prompt"
    default: return "denied"
    }
  }

  private func microphonePermission() -> String {
    if #available(iOS 17.0, *) {
      switch AVAudioApplication.shared.recordPermission {
      case .granted: return "granted"
      case .undetermined: return "prompt"
      default: return "denied"
      }
    }
    switch AVAudioSession.sharedInstance().recordPermission {
    case .granted: return "granted"
    case .undetermined: return "prompt"
    default: return "denied"
    }
  }

  private func requestMicrophone(_ completion: @escaping (Bool) -> Void) {
    if #available(iOS 17.0, *) {
      AVAudioApplication.requestRecordPermission(completionHandler: completion)
    } else {
      AVAudioSession.sharedInstance().requestRecordPermission(completion)
    }
  }

  @objc func getStatus(_ call: CAPPluginCall) {
    call.resolve([
      "available": recognizer?.isAvailable ?? false,
      "onDevice": recognizer?.supportsOnDeviceRecognition ?? false,
      "speech": speechPermission(),
      "microphone": microphonePermission()
    ])
  }

  // Speech first, then microphone — iOS shows each question once.
  @objc override public func requestPermissions(_ call: CAPPluginCall) {
    SFSpeechRecognizer.requestAuthorization { status in
      DispatchQueue.main.async {
        guard status == .authorized else {
          call.resolve(["granted": false])
          return
        }
        self.requestMicrophone { granted in
          DispatchQueue.main.async {
            call.resolve(["granted": granted])
          }
        }
      }
    }
  }

  // MARK: - Speaking

  // speak({ text }): reads a short answer aloud. Not while listening.
  @objc func speak(_ call: CAPPluginCall) {
    let text = (call.getString("text") ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty, text.count <= 600 else {
      call.reject("Nothing to read")
      return
    }
    DispatchQueue.main.async {
      guard !self.active else {
        call.reject("Listening")
        return
      }
      self.synthesizer.stopSpeaking(at: .immediate)
      do {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        try session.setActive(true)
      } catch {
        // Reads anyway with whatever audio setup there is.
      }
      let utterance = AVSpeechUtterance(string: text)
      utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
      utterance.rate = AVSpeechUtteranceDefaultSpeechRate
      self.synthesizer.speak(utterance)
      call.resolve()
    }
  }

  @objc func stopSpeaking(_ call: CAPPluginCall) {
    DispatchQueue.main.async {
      self.synthesizer.stopSpeaking(at: .immediate)
      call.resolve()
    }
  }

  // Gives the audio back once reading ends, so other sound comes back up.
  fileprivate func speakingEnded() {
    if !active {
      try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
  }

  // MARK: - Listening

  @objc func start(_ call: CAPPluginCall) {
    DispatchQueue.main.async {
      // Talking over an answer being read stops the reading.
      self.synthesizer.stopSpeaking(at: .immediate)
      guard !self.active else {
        call.reject("Already listening")
        return
      }
      guard self.speechPermission() == "granted", self.microphonePermission() == "granted" else {
        call.reject("permission denied")
        return
      }
      guard let recognizer = self.recognizer, recognizer.isAvailable else {
        call.reject("Speech recognition isn't available right now")
        return
      }

      self.silenceMs = call.getInt("silenceMs") ?? 2500
      self.firstWordsMs = call.getInt("firstWordsMs") ?? 8000
      let limitMs = call.getInt("limitMs") ?? 55000
      let hints = (call.getArray("hints", String.self) ?? []).prefix(100)

      do {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .measurement, options: [.duckOthers])
        try session.setActive(true, options: .notifyOthersOnDeactivation)

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.taskHint = .dictation
        request.contextualStrings = Array(hints)
        if recognizer.supportsOnDeviceRecognition {
          request.requiresOnDeviceRecognition = true
        }

        let input = self.audioEngine.inputNode
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { [weak self] buffer, _ in
          request.append(buffer)
          let level = NativeSpeechPlugin.levelDb(buffer)
          DispatchQueue.main.async { self?.noteSound(level) }
        }
        self.audioEngine.prepare()
        try self.audioEngine.start()

        self.request = request
        self.latestText = ""
        self.startedAt = CACurrentMediaTime()
        self.lastHeardAt = self.startedAt
        self.roomLevelDb = -50
        self.active = true
        self.task = recognizer.recognitionTask(with: request) { [weak self] result, error in
          DispatchQueue.main.async {
            guard let self, self.active else { return }
            if let result {
              let text = result.bestTranscription.formattedString
              if !text.isEmpty && text != self.latestText {
                self.latestText = text
                self.notifyListeners("partial", data: ["text": text])
                self.lastHeardAt = CACurrentMediaTime()
              }
              if result.isFinal {
                self.finish(reason: "final")
              }
            } else if error != nil {
              self.finish(reason: self.latestText.isEmpty ? "error" : "final")
            }
          }
        }

        // Checks a few times a second whether they've finished talking.
        let check = Timer(timeInterval: 0.2, repeats: true) { [weak self] _ in self?.checkFinished() }
        RunLoop.main.add(check, forMode: .common)
        self.checkTimer = check
        let limit = DispatchWorkItem { [weak self] in self?.finish(reason: "limit") }
        self.limitTimer = limit
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(limitMs), execute: limit)

        call.resolve(["onDevice": request.requiresOnDeviceRecognition])
      } catch {
        self.teardown()
        call.reject("Couldn't start the microphone", nil, error)
      }
    }
  }

  // Done: end now and hand back what was heard.
  @objc func stop(_ call: CAPPluginCall) {
    DispatchQueue.main.async {
      self.finish(reason: "stopped")
      call.resolve()
    }
  }

  // End now and drop what was heard.
  @objc func cancel(_ call: CAPPluginCall) {
    DispatchQueue.main.async {
      self.active = false
      self.teardown()
      call.resolve()
    }
  }

  // Loudness of one slice of microphone sound, in dB (about -160 to 0).
  private static func levelDb(_ buffer: AVAudioPCMBuffer) -> Float {
    guard let samples = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return -160 }
    let count = Int(buffer.frameLength)
    var sum: Float = 0
    for index in 0..<count {
      sum += samples[index] * samples[index]
    }
    return 20 * log10(max(sqrt(sum / Float(count)), 1e-8))
  }

  private func noteSound(_ levelDb: Float) {
    guard active else { return }
    if levelDb < roomLevelDb {
      roomLevelDb = levelDb
    } else {
      roomLevelDb += min(levelDb - roomLevelDb, 0.03)
    }
    // Talking: clearly louder than the room, and not near-silence.
    if levelDb > roomLevelDb + 10 && levelDb > -60 {
      lastHeardAt = CACurrentMediaTime()
    }
  }

  // Finished when, after some words, there's been neither new words nor
  // talking-level sound for silenceMs; or nothing said at all for firstWordsMs.
  private func checkFinished() {
    guard active else { return }
    let now = CACurrentMediaTime()
    if latestText.isEmpty {
      if now - startedAt >= Double(firstWordsMs) / 1000 { finish(reason: "silence") }
    } else if now - lastHeardAt >= Double(silenceMs) / 1000 {
      finish(reason: "silence")
    }
  }

  private func finish(reason: String) {
    guard active else { return }
    active = false
    let text = latestText
    teardown()
    notifyListeners("finished", data: ["text": text, "reason": reason])
  }

  // Stops the microphone and gives it back, so other audio resumes.
  private func teardown() {
    checkTimer?.invalidate()
    checkTimer = nil
    limitTimer?.cancel()
    limitTimer = nil
    if audioEngine.isRunning {
      audioEngine.stop()
    }
    audioEngine.inputNode.removeTap(onBus: 0)
    request?.endAudio()
    task?.cancel()
    request = nil
    task = nil
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }
}

extension NativeSpeechPlugin: AVSpeechSynthesizerDelegate {
  public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
    speakingEnded()
  }

  public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
    speakingEnded()
  }
}
