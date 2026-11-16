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
// talking, and gives the microphone back afterward so paused music resumes.
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
    CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise)
  ]

  private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
  private let audioEngine = AVAudioEngine()
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var task: SFSpeechRecognitionTask?
  private var latestText = ""
  private var active = false
  private var silenceMs = 1800
  private var endTimer: DispatchWorkItem?
  private var limitTimer: DispatchWorkItem?
  private var interruptionObserver: NSObjectProtocol?

  override public func load() {
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

  // MARK: - Listening

  @objc func start(_ call: CAPPluginCall) {
    DispatchQueue.main.async {
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

      self.silenceMs = call.getInt("silenceMs") ?? 1800
      let firstWordsMs = call.getInt("firstWordsMs") ?? 8000
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
        input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buffer, _ in
          request.append(buffer)
        }
        self.audioEngine.prepare()
        try self.audioEngine.start()

        self.request = request
        self.latestText = ""
        self.active = true
        self.task = recognizer.recognitionTask(with: request) { [weak self] result, error in
          DispatchQueue.main.async {
            guard let self, self.active else { return }
            if let result {
              let text = result.bestTranscription.formattedString
              if !text.isEmpty && text != self.latestText {
                self.latestText = text
                self.notifyListeners("partial", data: ["text": text])
                self.scheduleEnd(after: self.silenceMs, reason: "silence")
              }
              if result.isFinal {
                self.finish(reason: "final")
              }
            } else if error != nil {
              self.finish(reason: self.latestText.isEmpty ? "error" : "final")
            }
          }
        }

        // Nothing said at all: stop instead of listening forever.
        self.scheduleEnd(after: firstWordsMs, reason: "silence")
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

  private func scheduleEnd(after ms: Int, reason: String) {
    endTimer?.cancel()
    let work = DispatchWorkItem { [weak self] in self?.finish(reason: reason) }
    endTimer = work
    DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(ms), execute: work)
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
    endTimer?.cancel()
    endTimer = nil
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
