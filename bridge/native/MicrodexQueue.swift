import AppKit
import Foundation

struct QueuedMessage: Decodable {
    let id: String
    let text: String
    let status: String
}

struct RemoteState: Decodable {
    let messageQueue: [QueuedMessage]
}

final class QueueMenuController: NSObject, NSApplicationDelegate {
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let bridgeURL: URL
    private let token: String
    private var timer: Timer?

    override init() {
        let port = CommandLine.arguments.dropFirst().first ?? "3210"
        bridgeURL = URL(string: "http://127.0.0.1:\(port)")!
        token = ProcessInfo.processInfo.environment["MICRODEX_TOKEN"] ?? ""
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        statusItem.button?.title = "µC"
        statusItem.button?.toolTip = "Microcodex message queue"
        rebuildMenu(messages: [])
        refresh()
        timer = Timer.scheduledTimer(
            timeInterval: 0.35,
            target: self,
            selector: #selector(refresh),
            userInfo: nil,
            repeats: true
        )
    }

    func applicationWillTerminate(_ notification: Notification) {
        timer?.invalidate()
    }

    private func request(path: String, method: String = "GET", body: Data? = nil) -> URLRequest {
        var request = URLRequest(url: bridgeURL.appendingPathComponent(path))
        request.httpMethod = method
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(token, forHTTPHeaderField: "X-Microdex-Token")
        request.timeoutInterval = 2
        return request
    }

    @objc private func refresh() {
        URLSession.shared.dataTask(with: request(path: "api/remote/queue")) { [weak self] data, _, error in
            guard let self else { return }
            guard error == nil,
                  let data,
                  let state = try? JSONDecoder().decode(RemoteState.self, from: data) else {
                DispatchQueue.main.async {
                    self.statusItem.button?.title = "µC !"
                    self.statusItem.button?.toolTip = "Microcodex bridge offline"
                }
                return
            }
            DispatchQueue.main.async {
                self.statusItem.button?.title = state.messageQueue.isEmpty
                    ? "µC"
                    : "µC \(state.messageQueue.count)"
                self.statusItem.button?.toolTip = state.messageQueue.isEmpty
                    ? "Microcodex · coda vuota"
                    : "Microcodex · \(state.messageQueue.count) in coda"
                self.rebuildMenu(messages: state.messageQueue)
            }
        }.resume()
    }

    private func rebuildMenu(messages: [QueuedMessage]) {
        let menu = NSMenu()
        let heading = NSMenuItem(
            title: messages.isEmpty ? "Microcodex · Coda vuota" : "Microcodex · In coda (\(messages.count))",
            action: nil,
            keyEquivalent: ""
        )
        heading.isEnabled = false
        menu.addItem(heading)
        menu.addItem(.separator())

        if messages.isEmpty {
            let empty = NSMenuItem(title: "Nessun messaggio in attesa", action: nil, keyEquivalent: "")
            empty.isEnabled = false
            menu.addItem(empty)
        } else {
            for (index, message) in messages.prefix(12).enumerated() {
                let normalized = message.text.replacingOccurrences(of: "\n", with: " ")
                let preview = normalized.count > 54
                    ? String(normalized.prefix(54)) + "…"
                    : normalized
                let item = NSMenuItem(
                    title: "\(index + 1). \(preview)",
                    action: message.status == "queued" ? #selector(removeMessage(_:)) : nil,
                    keyEquivalent: ""
                )
                item.target = self
                item.representedObject = message.id
                item.toolTip = message.status == "queued"
                    ? "Clicca per eliminare dalla coda"
                    : "Invio al Mac in corso"
                item.isEnabled = message.status == "queued"
                menu.addItem(item)
            }
        }

        menu.addItem(.separator())
        let refreshItem = NSMenuItem(
            title: "Aggiorna adesso",
            action: #selector(refresh),
            keyEquivalent: "r"
        )
        refreshItem.target = self
        menu.addItem(refreshItem)
        statusItem.menu = menu
    }

    @objc private func removeMessage(_ sender: NSMenuItem) {
        guard let messageId = sender.representedObject as? String,
              let body = try? JSONSerialization.data(withJSONObject: ["messageId": messageId]) else {
            return
        }
        URLSession.shared.dataTask(
            with: request(path: "api/remote/queue/remove", method: "POST", body: body)
        ) { [weak self] _, _, _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) {
                self?.refresh()
            }
        }.resume()
    }
}

let app = NSApplication.shared
let controller = QueueMenuController()
app.delegate = controller
app.run()
