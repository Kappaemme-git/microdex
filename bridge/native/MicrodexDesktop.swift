import AppKit
import ApplicationServices
import Carbon.HIToolbox
import Foundation

enum MicrodexDesktopError: Error, CustomStringConvertible {
    case accessibilityRequired
    case chatGPTNotRunning
    case composerNotFound
    case invalidAction(String)

    var description: String {
        switch self {
        case .accessibilityRequired:
            return "Microdex needs Accessibility permission in System Settings → Privacy & Security → Accessibility."
        case .chatGPTNotRunning:
            return "ChatGPT is not running on this Mac."
        case .composerNotFound:
            return "The Codex composer could not be found in the ChatGPT window."
        case .invalidAction(let action):
            return "Unsupported desktop action: \(action)"
        }
    }
}

let bundleIdentifier = "com.openai.codex"

func json(_ values: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: values, options: [])
    print(String(data: data, encoding: .utf8)!)
}

func accessibilityTrusted(prompt: Bool) -> Bool {
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: prompt] as CFDictionary
    return AXIsProcessTrustedWithOptions(options)
}

func runningChatGPT() -> NSRunningApplication? {
    NSRunningApplication.runningApplications(withBundleIdentifier: bundleIdentifier).first
}

var manualAccessibilityRequested: Set<pid_t> = []

/// Extra facts an action wants to report back, merged into its JSON result.
/// Lets the bridge learn what was actually applied when the request had to be
/// adjusted to what the active model offers.
var actionDetails: [String: Any] = [:]

/// The Codex desktop app hosts its interface in a Chromium web view. Those
/// hosts expose only the menu bar to accessibility clients and build the tree
/// for the window content lazily, after a client asks for it through the
/// private `AXManualAccessibility` attribute. Without that request every window
/// lookup traverses an empty tree, finds nothing, and the action silently does
/// nothing while still reporting success.
@discardableResult
func accessibilityElement(for app: NSRunningApplication) -> AXUIElement {
    let element = AXUIElementCreateApplication(app.processIdentifier)
    guard !manualAccessibilityRequested.contains(app.processIdentifier) else { return element }
    manualAccessibilityRequested.insert(app.processIdentifier)

    AXUIElementSetAttributeValue(
        element,
        "AXManualAccessibility" as CFString,
        kCFBooleanTrue
    )
    AXUIElementSetAttributeValue(
        element,
        "AXEnhancedUserInterface" as CFString,
        kCFBooleanTrue
    )

    // The host builds the tree asynchronously once the request lands.
    for _ in 0..<30 {
        if let windows = copyAttribute(element, kAXWindowsAttribute) as? [AXUIElement],
           windows.contains(where: { copyAttribute($0, kAXChildrenAttribute) != nil }) {
            return element
        }
        Thread.sleep(forTimeInterval: 0.05)
    }
    return element
}

/// True when the window content, not just the menu bar, is reachable.
func windowTreeReachable() -> Bool {
    guard let app = runningChatGPT() else { return false }
    let element = accessibilityElement(for: app)
    guard let windows = copyAttribute(element, kAXWindowsAttribute) as? [AXUIElement] else {
        return false
    }
    return windows.contains { window in
        (copyAttribute(window, kAXChildrenAttribute) as? [AXUIElement])?.isEmpty == false
    }
}

@discardableResult
func activateChatGPT() throws -> NSRunningApplication {
    guard accessibilityTrusted(prompt: false) else {
        throw MicrodexDesktopError.accessibilityRequired
    }
    guard let app = runningChatGPT() else {
        throw MicrodexDesktopError.chatGPTNotRunning
    }
    app.activate(options: [.activateAllWindows])
    Thread.sleep(forTimeInterval: 0.12)
    accessibilityElement(for: app)
    return app
}

func postKey(_ keyCode: CGKeyCode, flags: CGEventFlags = []) {
    let source = CGEventSource(stateID: .combinedSessionState)
    let modifierKeys: [(CGEventFlags, CGKeyCode)] = [
        (.maskCommand, CGKeyCode(kVK_Command)),
        (.maskControl, CGKeyCode(kVK_Control)),
        (.maskAlternate, CGKeyCode(kVK_Option)),
        (.maskShift, CGKeyCode(kVK_Shift)),
    ]
    var activeFlags: CGEventFlags = []

    for (flag, modifierKey) in modifierKeys where flags.contains(flag) {
        activeFlags.insert(flag)
        guard let event = CGEvent(
            keyboardEventSource: source,
            virtualKey: modifierKey,
            keyDown: true
        ) else { continue }
        event.flags = activeFlags
        event.post(tap: .cghidEventTap)
        Thread.sleep(forTimeInterval: 0.012)
    }

    guard let down = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: true),
          let up = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: false) else {
        return
    }
    down.flags = flags
    up.flags = flags
    down.post(tap: .cghidEventTap)
    Thread.sleep(forTimeInterval: 0.012)
    up.post(tap: .cghidEventTap)

    for (flag, modifierKey) in modifierKeys.reversed() where flags.contains(flag) {
        activeFlags.remove(flag)
        guard let event = CGEvent(
            keyboardEventSource: source,
            virtualKey: modifierKey,
            keyDown: false
        ) else { continue }
        event.flags = activeFlags
        event.post(tap: .cghidEventTap)
        Thread.sleep(forTimeInterval: 0.012)
    }
}

func typeText(_ text: String) {
    let units = Array(text.utf16)
    guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true),
          let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) else {
        return
    }
    units.withUnsafeBufferPointer { pointer in
        down.keyboardSetUnicodeString(stringLength: units.count, unicodeString: pointer.baseAddress!)
        up.keyboardSetUnicodeString(stringLength: units.count, unicodeString: pointer.baseAddress!)
    }
    down.post(tap: .cghidEventTap)
    up.post(tap: .cghidEventTap)
}

func typeCommandQuery(_ text: String) throws {
    let keyCodes: [Character: Int] = [
        "a": kVK_ANSI_A, "b": kVK_ANSI_B, "c": kVK_ANSI_C, "d": kVK_ANSI_D,
        "e": kVK_ANSI_E, "f": kVK_ANSI_F, "g": kVK_ANSI_G, "h": kVK_ANSI_H,
        "i": kVK_ANSI_I, "j": kVK_ANSI_J, "k": kVK_ANSI_K, "l": kVK_ANSI_L,
        "m": kVK_ANSI_M, "n": kVK_ANSI_N, "o": kVK_ANSI_O, "p": kVK_ANSI_P,
        "q": kVK_ANSI_Q, "r": kVK_ANSI_R, "s": kVK_ANSI_S, "t": kVK_ANSI_T,
        "u": kVK_ANSI_U, "v": kVK_ANSI_V, "w": kVK_ANSI_W, "x": kVK_ANSI_X,
        "y": kVK_ANSI_Y, "z": kVK_ANSI_Z, " ": kVK_Space, "-": kVK_ANSI_Minus,
    ]
    for character in text.lowercased() {
        guard let keyCode = keyCodes[character] else { continue }
        if let currentInput = try findVisibleCommandInput() {
            try clickElement(currentInput)
            AXUIElementSetAttributeValue(
                currentInput,
                kAXFocusedAttribute as CFString,
                kCFBooleanTrue
            )
        }
        postKey(CGKeyCode(keyCode))
        Thread.sleep(forTimeInterval: 0.035)
    }
}

func pasteText(_ text: String) {
    let pasteboard = NSPasteboard.general
    let snapshot: [[NSPasteboard.PasteboardType: Data]] = (pasteboard.pasteboardItems ?? []).map {
        item in
        var values: [NSPasteboard.PasteboardType: Data] = [:]
        for type in item.types {
            if let data = item.data(forType: type) {
                values[type] = data
            }
        }
        return values
    }

    pasteboard.clearContents()
    pasteboard.setString(text, forType: .string)
    postKey(CGKeyCode(kVK_ANSI_V), flags: .maskCommand)
    Thread.sleep(forTimeInterval: 0.08)

    pasteboard.clearContents()
    let restoredItems = snapshot.map { values -> NSPasteboardItem in
        let item = NSPasteboardItem()
        for (type, data) in values {
            item.setData(data, forType: type)
        }
        return item
    }
    if !restoredItems.isEmpty {
        pasteboard.writeObjects(restoredItems)
    }
}

func typePlanCommand() {
    postKey(CGKeyCode(kVK_ANSI_7), flags: .maskShift)
    Thread.sleep(forTimeInterval: 0.035)
    let keyCodes = [
        kVK_ANSI_P,
        kVK_ANSI_L,
        kVK_ANSI_A,
        kVK_ANSI_N,
    ]
    for keyCode in keyCodes {
        postKey(CGKeyCode(keyCode))
        Thread.sleep(forTimeInterval: 0.035)
    }
}

func copyAttribute(_ element: AXUIElement, _ attribute: String) -> AnyObject? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else {
        return nil
    }
    return value
}

func stringAttribute(_ element: AXUIElement, _ attribute: String) -> String {
    copyAttribute(element, attribute) as? String ?? ""
}

func boolAttribute(_ element: AXUIElement, _ attribute: String, fallback: Bool = true) -> Bool {
    copyAttribute(element, attribute) as? Bool ?? fallback
}

func frameScore(_ element: AXUIElement) -> Double {
    guard let positionObject = copyAttribute(element, kAXPositionAttribute),
          let sizeObject = copyAttribute(element, kAXSizeAttribute),
          CFGetTypeID(positionObject) == AXValueGetTypeID(),
          CFGetTypeID(sizeObject) == AXValueGetTypeID() else {
        return 0
    }
    let positionValue = unsafeBitCast(positionObject, to: AXValue.self)
    let sizeValue = unsafeBitCast(sizeObject, to: AXValue.self)
    var position = CGPoint.zero
    var size = CGSize.zero
    AXValueGetValue(positionValue, .cgPoint, &position)
    AXValueGetValue(sizeValue, .cgSize, &size)
    return Double(position.y) * 2 + Double(size.width) + Double(size.height)
}

func hasVisibleFrame(_ element: AXUIElement) -> Bool {
    guard let positionObject = copyAttribute(element, kAXPositionAttribute),
          let sizeObject = copyAttribute(element, kAXSizeAttribute),
          CFGetTypeID(positionObject) == AXValueGetTypeID(),
          CFGetTypeID(sizeObject) == AXValueGetTypeID() else {
        return false
    }
    let sizeValue = unsafeBitCast(sizeObject, to: AXValue.self)
    var size = CGSize.zero
    AXValueGetValue(sizeValue, .cgSize, &size)
    return size.width > 1 && size.height > 1
}

func composerScore(_ element: AXUIElement) -> Double? {
    let role = stringAttribute(element, kAXRoleAttribute)
    guard role == kAXTextAreaRole || role == kAXTextFieldRole else {
        return nil
    }
    guard boolAttribute(element, kAXEnabledAttribute) else {
        return nil
    }

    let searchable = [
        stringAttribute(element, kAXTitleAttribute),
        stringAttribute(element, kAXDescriptionAttribute),
        stringAttribute(element, kAXHelpAttribute),
        stringAttribute(element, kAXPlaceholderValueAttribute),
    ].joined(separator: " ").lowercased()

    var score = frameScore(element)
    if role == kAXTextAreaRole { score += 2_000 }
    if ["message", "composer", "ask", "prompt", "chat", "messaggio", "chiedi"].contains(where: searchable.contains) {
        score += 10_000
    }
    return score
}

func findComposer(in application: AXUIElement) -> AXUIElement? {
    var queue: [(AXUIElement, Int)] = [(application, 0)]
    var candidates: [(AXUIElement, Double)] = []
    var visited = 0

    while !queue.isEmpty && visited < 12_000 {
        let (element, depth) = queue.removeFirst()
        visited += 1
        if let score = composerScore(element) {
            candidates.append((element, score))
        }
        guard depth < 40,
              let children = copyAttribute(element, kAXChildrenAttribute) as? [AXUIElement] else {
            continue
        }
        queue.append(contentsOf: children.map { ($0, depth + 1) })
    }

    return candidates.max(by: { $0.1 < $1.1 })?.0
}

func inspectChatGPT() throws -> [[String: Any]] {
    let app = try activateChatGPT()
    let accessibilityApp = accessibilityElement(for: app)
    var queue: [(AXUIElement, Int)] = [(accessibilityApp, 0)]
    var results: [[String: Any]] = []
    var visited = 0

    while !queue.isEmpty && visited < 8_000 {
        let (element, depth) = queue.removeFirst()
        visited += 1

        let role = stringAttribute(element, kAXRoleAttribute)
        let title = stringAttribute(element, kAXTitleAttribute)
        let description = stringAttribute(element, kAXDescriptionAttribute)
        let value = stringAttribute(element, kAXValueAttribute)
        let help = stringAttribute(element, kAXHelpAttribute)
        if !title.isEmpty || !description.isEmpty || !value.isEmpty || !help.isEmpty || role == kAXSliderRole {
            var result: [String: Any] = [
                "depth": depth,
                "role": role,
                "title": title,
                "description": description,
                "value": value,
                "help": help,
            ]
            if let positionObject = copyAttribute(element, kAXPositionAttribute),
               let sizeObject = copyAttribute(element, kAXSizeAttribute),
               CFGetTypeID(positionObject) == AXValueGetTypeID(),
               CFGetTypeID(sizeObject) == AXValueGetTypeID() {
                let positionValue = unsafeBitCast(positionObject, to: AXValue.self)
                let sizeValue = unsafeBitCast(sizeObject, to: AXValue.self)
                var position = CGPoint.zero
                var size = CGSize.zero
                AXValueGetValue(positionValue, .cgPoint, &position)
                AXValueGetValue(sizeValue, .cgSize, &size)
                result["x"] = position.x
                result["y"] = position.y
                result["width"] = size.width
                result["height"] = size.height
            }
            results.append(result)
        }

        guard depth < 40,
              let children = copyAttribute(element, kAXChildrenAttribute) as? [AXUIElement] else {
            continue
        }
        queue.append(contentsOf: children.map { ($0, depth + 1) })
    }
    return results
}

func findElement(matching query: String, role: String? = nil, activate: Bool = true) throws -> AXUIElement? {
    let app: NSRunningApplication
    if activate {
        app = try activateChatGPT()
    } else {
        guard let running = runningChatGPT() else {
            throw MicrodexDesktopError.chatGPTNotRunning
        }
        app = running
    }
    let accessibilityApp = accessibilityElement(for: app)
    var queue: [(AXUIElement, Int)] = [(accessibilityApp, 0)]
    let needle = query.lowercased()
    var visited = 0

    while !queue.isEmpty && visited < 8_000 {
        let (element, depth) = queue.removeFirst()
        visited += 1
        let elementRole = stringAttribute(element, kAXRoleAttribute)
        let searchable = [
            stringAttribute(element, kAXTitleAttribute),
            stringAttribute(element, kAXDescriptionAttribute),
            stringAttribute(element, kAXValueAttribute),
            stringAttribute(element, kAXHelpAttribute),
        ].joined(separator: " ").lowercased()
        if (role == nil || role == elementRole),
           searchable.contains(needle),
           hasVisibleFrame(element) {
            return element
        }
        guard depth < 40,
              let children = copyAttribute(element, kAXChildrenAttribute) as? [AXUIElement] else {
            continue
        }
        queue.append(contentsOf: children.map { ($0, depth + 1) })
    }
    return nil
}

func findElement(exactly query: String, role: String? = nil, activate: Bool = true) throws -> AXUIElement? {
    let app: NSRunningApplication
    if activate {
        app = try activateChatGPT()
    } else {
        guard let running = runningChatGPT() else {
            throw MicrodexDesktopError.chatGPTNotRunning
        }
        app = running
    }
    let accessibilityApp = accessibilityElement(for: app)
    var queue: [(AXUIElement, Int)] = [(accessibilityApp, 0)]
    let needle = query.lowercased()
    var visited = 0

    while !queue.isEmpty && visited < 8_000 {
        let (element, depth) = queue.removeFirst()
        visited += 1
        let elementRole = stringAttribute(element, kAXRoleAttribute)
        let values = [
            stringAttribute(element, kAXTitleAttribute),
            stringAttribute(element, kAXDescriptionAttribute),
            stringAttribute(element, kAXValueAttribute),
            stringAttribute(element, kAXHelpAttribute),
        ].map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
        if (role == nil || role == elementRole),
           values.contains(needle),
           hasVisibleFrame(element) {
            return element
        }
        guard depth < 40,
              let children = copyAttribute(element, kAXChildrenAttribute) as? [AXUIElement] else {
            continue
        }
        queue.append(contentsOf: children.map { ($0, depth + 1) })
    }
    return nil
}

func findApplicationMenuItem(exactly query: String) throws -> AXUIElement? {
    guard let app = runningChatGPT() else {
        throw MicrodexDesktopError.chatGPTNotRunning
    }
    let accessibilityApp = accessibilityElement(for: app)
    var queue: [(AXUIElement, Int)] = [(accessibilityApp, 0)]
    let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    var visited = 0

    while !queue.isEmpty && visited < 8_000 {
        let (element, depth) = queue.removeFirst()
        visited += 1
        if stringAttribute(element, kAXRoleAttribute) == kAXMenuItemRole {
            let values = [
                stringAttribute(element, kAXTitleAttribute),
                stringAttribute(element, kAXDescriptionAttribute),
                stringAttribute(element, kAXValueAttribute),
            ].map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
            if values.contains(needle), boolAttribute(element, kAXEnabledAttribute) {
                return element
            }
        }
        guard depth < 40,
              let children = copyAttribute(element, kAXChildrenAttribute) as? [AXUIElement] else {
            continue
        }
        queue.append(contentsOf: children.map { ($0, depth + 1) })
    }
    return nil
}

func performApplicationMenuItem(exactly query: String) throws {
    _ = try activateChatGPT()
    guard let menuItem = try findApplicationMenuItem(exactly: query) else {
        throw MicrodexDesktopError.invalidAction("Codex menu item is not available: \(query)")
    }
    let result = AXUIElementPerformAction(menuItem, kAXPressAction as CFString)
    if result != .success {
        throw MicrodexDesktopError.invalidAction("Codex menu item could not be used: \(query)")
    }
    Thread.sleep(forTimeInterval: 0.18)
}

func pressVisibleElement(matching query: String, role: String) throws {
    guard let element = try findElement(matching: query, role: role, activate: false) else {
        throw MicrodexDesktopError.invalidAction("Codex control is not available: \(query)")
    }
    // Electron menus can report a successful AXPress without dispatching the
    // click. A real coordinate click is observable and works consistently.
    try clickElement(element)
}

func openChatActions() throws {
    _ = try activateChatGPT()
    if try findElement(matching: "Continue in…", role: kAXMenuItemRole, activate: false) != nil {
        return
    }
    guard let actions = try findElement(
        matching: "Chat actions",
        role: kAXPopUpButtonRole,
        activate: false
    ) else {
        throw MicrodexDesktopError.invalidAction("The active Codex task has no chat actions")
    }
    try clickElement(actions)
}

func runChatAction(_ action: String) throws {
    try openChatActions()
    if action == "Pin chat",
       try findElement(
           matching: "Unpin chat",
           role: kAXMenuItemRole,
           activate: false
       ) != nil {
        try pressVisibleElement(matching: "Unpin chat", role: kAXMenuItemRole)
        return
    }
    try pressVisibleElement(matching: action, role: kAXMenuItemRole)
}

func continueInNewChat() throws {
    let app = try activateChatGPT()
    let accessibilityApp = accessibilityElement(for: app)
    var queue: [(AXUIElement, Int)] = [(accessibilityApp, 0)]
    var candidate: (element: AXUIElement, y: CGFloat)?
    var visited = 0

    while !queue.isEmpty && visited < 8_000 {
        let (element, depth) = queue.removeFirst()
        visited += 1
        let role = stringAttribute(element, kAXRoleAttribute)
        let values = [
            stringAttribute(element, kAXTitleAttribute),
            stringAttribute(element, kAXDescriptionAttribute),
            stringAttribute(element, kAXValueAttribute),
        ].map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
        if role == kAXButtonRole,
           values.contains("continue in new chat from here"),
           hasVisibleFrame(element),
           let positionObject = copyAttribute(element, kAXPositionAttribute),
           CFGetTypeID(positionObject) == AXValueGetTypeID() {
            let positionValue = unsafeBitCast(positionObject, to: AXValue.self)
            var position = CGPoint.zero
            AXValueGetValue(positionValue, .cgPoint, &position)
            if candidate == nil || position.y > candidate!.y {
                candidate = (element, position.y)
            }
        }
        guard depth < 40,
              let children = copyAttribute(element, kAXChildrenAttribute) as? [AXUIElement] else {
            continue
        }
        queue.append(contentsOf: children.map { ($0, depth + 1) })
    }

    guard let candidate else {
        throw MicrodexDesktopError.invalidAction(
            "The active Codex task has no message that can continue in a new chat"
        )
    }
    try clickElement(candidate.element)
}

func selectVisibleChat(_ title: String) throws {
    _ = try activateChatGPT()
    guard let chat = try findElement(
        exactly: title,
        role: kAXButtonRole,
        activate: false
    ) else {
        throw MicrodexDesktopError.invalidAction(
            "The Codex task is not visible in the sidebar: \(title)"
        )
    }
    try clickElement(chat)
    Thread.sleep(forTimeInterval: 0.25)
}

func copyChatAsMarkdown() throws {
    try openChatActions()
    try pressVisibleElement(matching: "Copy", role: kAXMenuItemRole)
    try pressVisibleElement(matching: "Copy as Markdown", role: kAXMenuItemRole)
}

func continueInNewWorktree() throws {
    try openChatActions()
    try pressVisibleElement(matching: "Continue in…", role: kAXMenuItemRole)
    guard try findElement(
        matching: "Continue in new worktree",
        role: kAXMenuItemRole,
        activate: false
    ) != nil else {
        postKey(CGKeyCode(kVK_Escape))
        throw MicrodexDesktopError.invalidAction(
            "A worktree requires the active task to use a Git repository"
        )
    }
    try pressVisibleElement(matching: "Continue in new worktree", role: kAXMenuItemRole)
}

func openFileAttachmentPicker() throws {
    _ = try activateChatGPT()
    guard let addButton = try findElement(
        matching: "Add files and more",
        role: kAXButtonRole,
        activate: false
    ) else {
        throw MicrodexDesktopError.invalidAction("The Codex attachment button is not available")
    }
    try clickElement(addButton)
    try pressVisibleElement(matching: "Files and folders", role: kAXButtonRole)
}

func findVisibleCommandInput() throws -> AXUIElement? {
    guard let app = runningChatGPT() else {
        throw MicrodexDesktopError.chatGPTNotRunning
    }
    let accessibilityApp = accessibilityElement(for: app)
    var queue: [(AXUIElement, Int)] = [(accessibilityApp, 0)]
    var candidates: [(AXUIElement, Double)] = []
    var visited = 0

    while !queue.isEmpty && visited < 8_000 {
        let (element, depth) = queue.removeFirst()
        visited += 1
        let role = stringAttribute(element, kAXRoleAttribute)
        if (role == kAXTextFieldRole || role == kAXTextAreaRole || role == kAXComboBoxRole),
           boolAttribute(element, kAXEnabledAttribute),
           hasVisibleFrame(element) {
            let score = frameScore(element)
            candidates.append((element, score))
        }
        guard depth < 40,
              let children = copyAttribute(element, kAXChildrenAttribute) as? [AXUIElement] else {
            continue
        }
        queue.append(contentsOf: children.map { ($0, depth + 1) })
    }
    // The command-menu search box is above the composer, so it has the lowest frame score.
    return candidates.min(by: { $0.1 < $1.1 })?.0
}

func findVisibleCommandResult(exactly query: String) throws -> AXUIElement? {
    guard let app = runningChatGPT() else {
        throw MicrodexDesktopError.chatGPTNotRunning
    }
    let accessibilityApp = accessibilityElement(for: app)
    var queue: [(AXUIElement, Int)] = [(accessibilityApp, 0)]
    let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    var fallback: AXUIElement?
    var visited = 0

    while !queue.isEmpty && visited < 8_000 {
        let (element, depth) = queue.removeFirst()
        visited += 1
        let role = stringAttribute(element, kAXRoleAttribute)
        let values = [
            stringAttribute(element, kAXTitleAttribute),
            stringAttribute(element, kAXDescriptionAttribute),
            stringAttribute(element, kAXValueAttribute),
        ].map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
        if values.contains(where: { $0 == needle || $0.hasPrefix("\(needle) ") }),
           hasVisibleFrame(element) {
            if role == kAXButtonRole || role == kAXMenuItemRole {
                return element
            }
            if role == kAXStaticTextRole {
                fallback = fallback ?? element
            }
        }
        guard depth < 40,
              let children = copyAttribute(element, kAXChildrenAttribute) as? [AXUIElement] else {
            continue
        }
        queue.append(contentsOf: children.map { ($0, depth + 1) })
    }
    return fallback
}

/// The Codex popovers are driven with the pointer, not with AXPress.
///
/// Tried and measured, twice. Pressing the picker button through accessibility
/// returns success and opens nothing: right after it, no element titled "Speed"
/// exists in the tree at all. The mouse click does open it — that is how the
/// picker contents were captured before any of this was changed.
///
/// AXPress stays where it was always correct and always worked: the application
/// menu bar, in `performApplicationMenuItem`, behind Terminal, New Chat and the
/// shortcuts sheet.
func pressElement(matching query: String, role: String? = nil, activate: Bool = true) throws {
    var element = try findElement(matching: query, role: role, activate: activate)
    if element == nil && !activate {
        for _ in 0..<20 {
            Thread.sleep(forTimeInterval: 0.04)
            element = try findElement(matching: query, role: role, activate: false)
            if element != nil { break }
        }
    }
    guard let element else {
        throw MicrodexDesktopError.invalidAction("UI element not found: \(query)")
    }
    if let positionObject = copyAttribute(element, kAXPositionAttribute),
       let sizeObject = copyAttribute(element, kAXSizeAttribute),
       CFGetTypeID(positionObject) == AXValueGetTypeID(),
       CFGetTypeID(sizeObject) == AXValueGetTypeID() {
        let positionValue = unsafeBitCast(positionObject, to: AXValue.self)
        let sizeValue = unsafeBitCast(sizeObject, to: AXValue.self)
        var position = CGPoint.zero
        var size = CGSize.zero
        AXValueGetValue(positionValue, .cgPoint, &position)
        AXValueGetValue(sizeValue, .cgSize, &size)
        let point = CGPoint(x: position.x + size.width / 2, y: position.y + size.height / 2)
        CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)?
            .post(tap: .cghidEventTap)
        Thread.sleep(forTimeInterval: 0.04)
        CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)?
            .post(tap: .cghidEventTap)
        Thread.sleep(forTimeInterval: 0.04)
        CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)?
            .post(tap: .cghidEventTap)
    } else {
        let result = AXUIElementPerformAction(element, kAXPressAction as CFString)
        if result != .success {
            throw MicrodexDesktopError.invalidAction("UI element could not be pressed: \(query)")
        }
    }
    Thread.sleep(forTimeInterval: 0.12)
}

/// Popovers in the Codex window that are never the model picker.
let nonModelPopUpMarkers = [
    "sidebar", "actions", "profile", "help menu", "plugins",
    "switch mode", "project", "options", "account",
]

/// Finds the model picker, the popover titled after the active model.
///
/// Recognition is in two tiers. The effort word in the title — "5.6 Sol Extra
/// High" — is the strong signal and stays first. But it is not a reliable
/// identity: Codex drops the effort from that title in some composer states, and
/// the picker then became invisible to the code, which reported "Codex model
/// picker not found" while the control was on screen the whole time.
///
/// The fallback identifies it by exclusion instead, among the popovers the
/// window actually has: Plugins, the profile and help menus, the sidebar and
/// project menus, the composer mode switch. Whatever is left, biggest frame
/// first, is the model picker.
func findModelPicker() throws -> AXUIElement? {
    let app = try activateChatGPT()
    let accessibilityApp = accessibilityElement(for: app)
    var queue: [(AXUIElement, Int)] = [(accessibilityApp, 0)]
    var labelled: [(AXUIElement, Double)] = []
    var remaining: [(AXUIElement, Double)] = []
    var visited = 0

    while !queue.isEmpty && visited < 8_000 {
        let (element, depth) = queue.removeFirst()
        visited += 1
        if stringAttribute(element, kAXRoleAttribute) == kAXPopUpButtonRole {
            let title = stringAttribute(element, kAXTitleAttribute).lowercased()
            let description = stringAttribute(element, kAXDescriptionAttribute).lowercased()
            let summary = "\(title) \(description)"
            let isOtherPopUp = nonModelPopUpMarkers.contains(where: summary.contains)
            let hasReasoningLabel = [
                " minimal", " light", " low", " medium", " high", " xhigh", " extended",
                " max", " ultra",
            ].contains(where: title.contains)

            if !isOtherPopUp && hasVisibleFrame(element) {
                if hasReasoningLabel {
                    labelled.append((element, frameScore(element)))
                } else if !title.isEmpty {
                    remaining.append((element, frameScore(element)))
                }
            }
        }
        guard depth < 40,
              let children = copyAttribute(element, kAXChildrenAttribute) as? [AXUIElement] else {
            continue
        }
        queue.append(contentsOf: children.map { ($0, depth + 1) })
    }

    if let best = labelled.max(by: { $0.1 < $1.1 })?.0 { return best }
    return remaining.max(by: { $0.1 < $1.1 })?.0
}

func clickElement(_ element: AXUIElement) throws {
    // Una voce finale di menu viene premuta con AXPress; tutto il resto col mouse.
    //
    // Misurato, non dedotto. `describe "Fast"` sulla voce del sottomenu riporta:
    //
    //   "title": "Fast 1.5x speed, more usage", "enabled": true,
    //   "actions": ["AXPress", "AXShowMenu", "AXScrollToVisible", "AXCancel"],
    //   "frame": "1386,-375 181x48"
    //
    // Dichiara AXPress ed e' abilitata. Il clic del mouse invece deve centrare
    // coordinate su uno schermo secondario, dove la y e' negativa, e non applica.
    //
    // Le esclusioni contano quanto la regola, e sono state entrambe provate e
    // ritirate. Il bottone del picker: premuto con AXPress non apre nulla, e
    // subito dopo nessun elemento "Speed" esiste nell'albero. Una riga che
    // possiede un sottomenu, come Speed o Effort: AXPress la attiva invece di
    // espanderla, e la foglia non compare piu'.
    if stringAttribute(element, kAXRoleAttribute) == kAXMenuItemRole {
        let children = copyAttribute(element, kAXChildrenAttribute) as? [AXUIElement]
        if (children ?? []).isEmpty,
           AXUIElementPerformAction(element, kAXPressAction as CFString) == .success {
            Thread.sleep(forTimeInterval: 0.15)
            return
        }
    }

    guard let positionObject = copyAttribute(element, kAXPositionAttribute),
          let sizeObject = copyAttribute(element, kAXSizeAttribute),
          CFGetTypeID(positionObject) == AXValueGetTypeID(),
          CFGetTypeID(sizeObject) == AXValueGetTypeID() else {
        let result = AXUIElementPerformAction(element, kAXPressAction as CFString)
        if result != .success {
            throw MicrodexDesktopError.invalidAction("UI element could not be clicked")
        }
        return
    }
    let positionValue = unsafeBitCast(positionObject, to: AXValue.self)
    let sizeValue = unsafeBitCast(sizeObject, to: AXValue.self)
    var position = CGPoint.zero
    var size = CGSize.zero
    AXValueGetValue(positionValue, .cgPoint, &position)
    AXValueGetValue(sizeValue, .cgSize, &size)
    let point = CGPoint(x: position.x + size.width / 2, y: position.y + size.height / 2)
    CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)?
        .post(tap: .cghidEventTap)
    Thread.sleep(forTimeInterval: 0.04)
    CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)?
        .post(tap: .cghidEventTap)
    Thread.sleep(forTimeInterval: 0.04)
    CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)?
        .post(tap: .cghidEventTap)
    Thread.sleep(forTimeInterval: 0.12)
}

func clickPoint(_ point: CGPoint) {
    CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)?
        .post(tap: .cghidEventTap)
    Thread.sleep(forTimeInterval: 0.04)
    CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)?
        .post(tap: .cghidEventTap)
    Thread.sleep(forTimeInterval: 0.04)
    CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)?
        .post(tap: .cghidEventTap)
    Thread.sleep(forTimeInterval: 0.12)
}

func openModelPicker() throws {
    guard let picker = try findModelPicker() else {
        // The picker lives in the composer bar, so it is genuinely absent on the
        // Scheduled tasks screen, in settings, or with no chat open. Saying where
        // to look beats reporting a missing control as a failure.
        throw MicrodexDesktopError.invalidAction(
            "Codex model picker not found. Open a chat in Codex: Speed and Effort live in the composer bar."
        )
    }
    let title = stringAttribute(picker, kAXTitleAttribute)
    try pressElement(matching: title, role: kAXPopUpButtonRole, activate: false)
}

/// The picker has a compact and an advanced view, and a single item toggles
/// between them. Its label states the destination, not the current state:
/// "Show advanced options" while compact, "Show compact options" while
/// advanced. Only the first one may be clicked, otherwise Speed and Effort get
/// hidden again.
func prepareAdvancedModelPicker() throws {
    postKey(CGKeyCode(kVK_Escape))
    try openModelPicker()
    // Let the popover render before anything is looked up in it.
    Thread.sleep(forTimeInterval: 0.4)

    if try findElement(
        matching: "Show compact options",
        role: kAXMenuItemRole,
        activate: false
    ) != nil {
        return
    }

    for label in ["Show advanced options", "Advanced options", "Mostra opzioni avanzate"] {
        if let advancedToggle = try findElement(
            matching: label,
            role: kAXMenuItemRole,
            activate: false
        ) {
            try clickElement(advancedToggle)
            Thread.sleep(forTimeInterval: 0.18)
            return
        }
    }
}

func compactMenuSummary(_ element: AXUIElement) -> String {
    [
        stringAttribute(element, kAXTitleAttribute),
        stringAttribute(element, kAXDescriptionAttribute),
        stringAttribute(element, kAXValueAttribute),
        stringAttribute(element, kAXHelpAttribute),
    ]
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
        .filter { !$0.isEmpty }
        .joined(separator: " ")
}

/// Finds the compact row, "Speed Standard" or "Effort Extra High".
///
/// This must not match a submenu entry. A substring search was ambiguous:
/// "Standard Default speed" and "Fast 1.5x speed, more usage" both contain
/// "speed", and the breadth-first walk could return one of those instead of the
/// row. The read-back then compared "standard default speed" against
/// "speed standard", never saw the value it had just set, and reported a failure
/// on a change that had actually been applied.
///
/// Prefix matching is unambiguous: only the row is titled "<name> <value>".
func compactMenuItem(named name: String) throws -> AXUIElement {
    // Retries, because the popover populates the accessibility tree a moment
    // after it opens. `inspect-model-picker` reads the same rows successfully and
    // the only structural difference was that it waited: this lookup asked once,
    // immediately, and reported the control missing while it was about to appear.
    // `waitForMenuItem`, which finds Fast and Standard, has always retried.
    for _ in 0..<16 {
        if let item = try findMenuItem(startingWith: name) { return item }
        Thread.sleep(forTimeInterval: 0.05)
    }
    // The failure carries what was on screen when it happened. Deducing this from
    // the outside cost hours: if the list holds picker rows but no "\(name) ...",
    // the row is titled differently; if it holds only menu bar entries, the
    // popover never opened on this path.
    let visible = (try? visibleMenuItemTitles()) ?? []
    let sample = visible.prefix(10).joined(separator: " | ")
    throw MicrodexDesktopError.invalidAction(
        "Codex \(name) control is not available. Voci visibili (\(visible.count)): \(sample)"
    )
}

func findMenuItem(startingWith title: String) throws -> AXUIElement? {
    guard let app = runningChatGPT() else {
        throw MicrodexDesktopError.chatGPTNotRunning
    }
    let accessibilityApp = accessibilityElement(for: app)
    var queue: [(AXUIElement, Int)] = [(accessibilityApp, 0)]
    let needle = title.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    var visited = 0

    while !queue.isEmpty && visited < 8_000 {
        let (element, depth) = queue.removeFirst()
        visited += 1
        if stringAttribute(element, kAXRoleAttribute) == kAXMenuItemRole {
            let values = [
                stringAttribute(element, kAXTitleAttribute),
                stringAttribute(element, kAXDescriptionAttribute),
                stringAttribute(element, kAXValueAttribute),
            ].map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
            if values.contains(where: { $0 == needle || $0.hasPrefix("\(needle) ") }),
               hasVisibleFrame(element) {
                return element
            }
        }
        guard depth < 40,
              let children = copyAttribute(element, kAXChildrenAttribute) as? [AXUIElement] else {
            continue
        }
        queue.append(contentsOf: children.map { ($0, depth + 1) })
    }
    return nil
}

/// Tries several spellings of the same level. Codex labels the lowest effort
/// "Light" on some models and "Low" on others, and the highest "Extra High",
/// "XHigh" or "Extended".
func firstAvailableMenuItem(startingWithAnyOf titles: [String]) throws -> AXUIElement? {
    for _ in 0..<12 {
        for title in titles {
            if let item = try findMenuItem(startingWith: title) { return item }
        }
        Thread.sleep(forTimeInterval: 0.05)
    }
    return nil
}

/// The menu item titles currently on screen, used to explain what Codex offers
/// when a requested level does not exist.
func visibleMenuItemTitles() throws -> [String] {
    guard let app = runningChatGPT() else {
        throw MicrodexDesktopError.chatGPTNotRunning
    }
    let accessibilityApp = accessibilityElement(for: app)
    var queue: [(AXUIElement, Int)] = [(accessibilityApp, 0)]
    var titles: [String] = []
    var visited = 0

    while !queue.isEmpty && visited < 8_000 {
        let (element, depth) = queue.removeFirst()
        visited += 1
        if stringAttribute(element, kAXRoleAttribute) == kAXMenuItemRole,
           hasVisibleFrame(element) {
            // The compact rows carry an empty title and put their text in the
            // description: "Speed Standard" is a description, not a title.
            // Reading only the title made this list blind to exactly the rows it
            // was meant to report.
            let label = [
                stringAttribute(element, kAXTitleAttribute),
                stringAttribute(element, kAXDescriptionAttribute),
            ]
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .first { !$0.isEmpty } ?? ""
            if !label.isEmpty && !titles.contains(label) { titles.append(label) }
        }
        guard depth < 40,
              let children = copyAttribute(element, kAXChildrenAttribute) as? [AXUIElement] else {
            continue
        }
        queue.append(contentsOf: children.map { ($0, depth + 1) })
    }
    return titles
}

func waitForMenuItem(startingWith title: String) throws -> AXUIElement {
    for _ in 0..<12 {
        if let item = try findMenuItem(startingWith: title) {
            return item
        }
        Thread.sleep(forTimeInterval: 0.05)
    }
    throw MicrodexDesktopError.invalidAction("Codex \(title) option is not available")
}

func setFastMode(_ enabled: Bool) throws {
    try prepareAdvancedModelPicker()
    let speedItem = try compactMenuItem(named: "Speed")
    let targetLabel = enabled ? "Fast" : "Standard"
    let expectedSummary = "speed \(targetLabel.lowercased())"
    if compactMenuSummary(speedItem).contains(expectedSummary) {
        postKey(CGKeyCode(kVK_Escape))
        return
    }

    try clickElement(speedItem)
    let target = try waitForMenuItem(startingWith: targetLabel)
    try clickElement(target)

    // Nessuna verifica qui, di proposito.
    //
    // The loop that used to live here reopened the picker up to eight times to
    // reread the row, and it raced the popover animation: the first command of a
    // sequence failed while the second, on a warmed-up popover, passed. The
    // change had been applied both times — "Fast Mode OFF" reading back
    // "Speed Standard" is only possible because the "failed" "Fast Mode ON"
    // before it had worked.
    //
    // Verification belongs where it is authoritative and does not depend on the
    // interface: `applyFastSetting` in bridge/lib/remote-settings.mjs asks the
    // Codex App Server and compares. If the click did not take, that check still
    // catches it.
    Thread.sleep(forTimeInterval: 0.2)
    postKey(CGKeyCode(kVK_Escape))
    actionDetails["requestedSpeed"] = targetLabel.lowercased()
}

/// Selectable ladder, lowest to highest. Max and Ultra are excluded on purpose:
/// Max is not applied reliably by any targeted model and Ultra burns usage
/// limits, so the dial stops at Extra High. Models still offer fewer rungs than
/// this, which is why the dial follows what the open menu actually lists.
///
/// This is not the same as recognizing the picker: `findModelPicker` still
/// matches a popup titled "5.6 Sol Ultra", because that is how Codex reports the
/// current model even when Microdex will not select that level.
let effortLadder = ["minimal", "low", "medium", "high", "xhigh"]

let effortLabels: [String: [String]] = [
    "minimal": ["Minimal"],
    "low": ["Light", "Low"],
    "medium": ["Medium"],
    "high": ["High"],
    "xhigh": ["Extra High", "XHigh", "Extended"],
]

/// Effort ids currently listed in the open Effort submenu.
func offeredEffortIds() throws -> [String] {
    let titles = try visibleMenuItemTitles()
    return effortLadder.filter { id in
        guard let labels = effortLabels[id] else { return false }
        return labels.contains { label in
            let needle = label.lowercased()
            return titles.contains { title in
                let value = title.lowercased()
                return value == needle || value.hasPrefix("\(needle) ")
            }
        }
    }
}

/// Resolves the level to apply. When the requested rung is missing, keeps moving
/// in the direction of travel rather than failing, and returns nil once there is
/// nothing left that way, which means the dial is already at the end.
func resolveOfferedEffort(
    requested: String,
    direction: Int,
    offered: [String]
) -> String? {
    if offered.contains(requested) { return requested }
    guard let requestedIndex = effortLadder.firstIndex(of: requested) else { return nil }
    let candidates = direction >= 0
        ? Array(effortLadder[requestedIndex...])
        : Array(effortLadder[...requestedIndex].reversed())
    return candidates.first { offered.contains($0) }
}

func setReasoningEffort(_ effort: String?, direction: Int = 1) throws {
    guard let effort, effortLabels[effort] != nil else {
        throw MicrodexDesktopError.invalidAction("Unsupported reasoning effort")
    }

    try prepareAdvancedModelPicker()
    let effortItem = try compactMenuItem(named: "Effort")
    try clickElement(effortItem)
    Thread.sleep(forTimeInterval: 0.25)

    let offered = try offeredEffortIds()
    guard let resolved = resolveOfferedEffort(
        requested: effort,
        direction: direction,
        offered: offered
    ) else {
        postKey(CGKeyCode(kVK_Escape))
        actionDetails["appliedEffort"] = currentEffortId() ?? effort
        actionDetails["offeredEfforts"] = offered
        actionDetails["clamped"] = true
        // Already at the end of what this model offers: not an error, and the
        // dial has to snap back to the real value.
        return
    }
    actionDetails["appliedEffort"] = resolved
    actionDetails["offeredEfforts"] = offered
    actionDetails["clamped"] = resolved != effort

    guard let candidates = effortLabels[resolved], let targetLabel = candidates.first else {
        throw MicrodexDesktopError.invalidAction("Unsupported reasoning effort")
    }

    guard let target = try firstAvailableMenuItem(startingWithAnyOf: candidates) else {
        let titles = try visibleMenuItemTitles()
        postKey(CGKeyCode(kVK_Escape))
        throw MicrodexDesktopError.invalidAction(
            "Codex does not offer \(targetLabel) for this model. Available: \(titles.joined(separator: ", "))"
        )
    }
    try clickElement(target)

    // Come per Speed: nessuna verifica qui. Riaprire il picker per rileggere la
    // riga faceva fallire il primo comando di una sequenza e passare il secondo,
    // sullo stesso identico percorso. La verifica autorevole e' quella
    // dell'App Server in applyReasoningSetting.
    Thread.sleep(forTimeInterval: 0.2)
    postKey(CGKeyCode(kVK_Escape))
}

/// Reads the level shown on the compact Effort row, e.g. "Effort Extra High".
func currentEffortId() -> String? {
    guard let item = try? compactMenuItem(named: "Effort") else { return nil }
    let summary = compactMenuSummary(item)
    return effortLadder.first { id in
        guard let labels = effortLabels[id] else { return false }
        return labels.contains { summary.contains("effort \($0.lowercased())") }
    }
}

func togglePlanMode() throws {
    let app = try activateChatGPT()
    let accessibilityApp = accessibilityElement(for: app)
    guard let composer = findComposer(in: accessibilityApp) else {
        throw MicrodexDesktopError.composerNotFound
    }
    let previousText = stringAttribute(composer, kAXValueAttribute)
    AXUIElementSetAttributeValue(composer, kAXFocusedAttribute as CFString, kCFBooleanTrue)
    postKey(CGKeyCode(kVK_ANSI_A), flags: .maskCommand)
    typePlanCommand()
    Thread.sleep(forTimeInterval: 0.35)
    do {
        try pressElement(matching: "Plan mode", activate: false)
    } catch {
        postKey(CGKeyCode(kVK_Return))
    }
    Thread.sleep(forTimeInterval: 0.15)
    let normalizedPreviousText = previousText.trimmingCharacters(in: .whitespacesAndNewlines)
    let knownPlaceholders = [
        "Work with ChatGPT",
        "Figure out next steps",
        "Describe your task to generate a plan...",
    ]
    if !normalizedPreviousText.isEmpty && !knownPlaceholders.contains(normalizedPreviousText) {
        AXUIElementSetAttributeValue(composer, kAXValueAttribute as CFString, previousText as CFTypeRef)
    }
}

func sendTextToComposer(_ text: String) throws {
    let app = try activateChatGPT()
    let accessibilityApp = accessibilityElement(for: app)
    guard let composer = findComposer(in: accessibilityApp) else {
        throw MicrodexDesktopError.composerNotFound
    }

    AXUIElementSetAttributeValue(composer, kAXFocusedAttribute as CFString, kCFBooleanTrue)
    let setResult = AXUIElementSetAttributeValue(
        composer,
        kAXValueAttribute as CFString,
        text as CFTypeRef
    )
    if setResult != AXError.success {
        AXUIElementPerformAction(composer, kAXPressAction as CFString)
        postKey(CGKeyCode(kVK_ANSI_A), flags: .maskCommand)
        typeText(text)
    }
    Thread.sleep(forTimeInterval: 0.08)
    postKey(CGKeyCode(kVK_Return))
}

func insertTextInComposer(_ text: String) throws {
    let app = try activateChatGPT()
    let accessibilityApp = accessibilityElement(for: app)
    guard let composer = findComposer(in: accessibilityApp) else {
        throw MicrodexDesktopError.composerNotFound
    }

    let current = stringAttribute(composer, kAXValueAttribute)
        .trimmingCharacters(in: .whitespacesAndNewlines)
    let placeholders = [
        "Work with ChatGPT",
        "Figure out next steps",
        "Describe your task to generate a plan...",
    ]
    let next = current.isEmpty || placeholders.contains(current)
        ? text
        : "\(current) \(text)"
    AXUIElementSetAttributeValue(composer, kAXFocusedAttribute as CFString, kCFBooleanTrue)
    let result = AXUIElementSetAttributeValue(
        composer,
        kAXValueAttribute as CFString,
        next as CFTypeRef
    )
    if result != .success {
        postKey(CGKeyCode(kVK_ANSI_A), flags: .maskCommand)
        typeText(next)
    }
}

func runCommandMenu(_ query: String) throws {
    _ = try activateChatGPT()
    postKey(CGKeyCode(kVK_Escape))
    postKey(CGKeyCode(kVK_ANSI_K), flags: .maskCommand)
    Thread.sleep(forTimeInterval: 0.18)
    var commandInput = try findVisibleCommandInput()
    if commandInput == nil {
        postKey(CGKeyCode(kVK_ANSI_P), flags: [.maskCommand, .maskShift])
        Thread.sleep(forTimeInterval: 0.18)
        commandInput = try findVisibleCommandInput()
    }
    guard let commandInput else {
        postKey(CGKeyCode(kVK_Escape))
        throw MicrodexDesktopError.invalidAction("The Codex command search did not open")
    }
    try clickElement(commandInput)
    AXUIElementSetAttributeValue(commandInput, kAXFocusedAttribute as CFString, kCFBooleanTrue)
    postKey(CGKeyCode(kVK_ANSI_A), flags: .maskCommand)
    try typeCommandQuery(query)
    Thread.sleep(forTimeInterval: 0.28)
    if let commandResult = try findVisibleCommandResult(exactly: query) {
        try clickElement(commandResult)
        return
    }
    postKey(CGKeyCode(kVK_Escape))
    throw MicrodexDesktopError.invalidAction("Codex command is not available: \(query)")
}

func startDictation() throws {
    _ = try activateChatGPT()
    if try findElement(
        matching: "Stop dictation",
        role: kAXButtonRole,
        activate: false
    ) != nil {
        return
    }
    if let dictateButton = try findElement(
        matching: "Dictate",
        role: kAXButtonRole,
        activate: false
    ) {
        try clickElement(dictateButton)
        return
    }
    // Current Codex shortcut. Starting is idempotent because the active
    // "Stop dictation" control was checked before using the fallback.
    postKey(CGKeyCode(kVK_ANSI_D), flags: [.maskControl, .maskShift])
}

func stopDictation() throws {
    _ = try activateChatGPT()
    guard let stopButton = try findElement(
        matching: "Stop dictation",
        role: kAXButtonRole,
        activate: false
    ) else {
        return
    }
    try clickElement(stopButton)
    for _ in 0..<30 {
        Thread.sleep(forTimeInterval: 0.1)
        if try findElement(
            matching: "Stop dictation",
            role: kAXButtonRole,
            activate: false
        ) == nil {
            return
        }
    }
}

func toggleDictation() throws {
    _ = try activateChatGPT()
    if try findElement(
        matching: "Stop dictation",
        role: kAXButtonRole,
        activate: false
    ) != nil {
        try stopDictation()
    } else {
        try startDictation()
    }
}

func execute(_ action: String, payload: String?) throws {
    switch action {
    case "fast":
        try setFastMode(payload == "true")
    case "reasoning-up":
        try setReasoningEffort(payload, direction: 1)
    case "reasoning-down":
        try setReasoningEffort(payload, direction: -1)
    case "plan":
        try togglePlanMode()
    case "model-picker":
        try openModelPicker()
    case "dictation":
        try toggleDictation()
    case "dictation-start":
        try startDictation()
    case "dictation-stop":
        try stopDictation()
    case "approve":
        _ = try activateChatGPT()
        postKey(CGKeyCode(kVK_Return))
    case "decline":
        _ = try activateChatGPT()
        postKey(CGKeyCode(kVK_Escape))
    case "send":
        _ = try activateChatGPT()
        postKey(CGKeyCode(kVK_Return))
    case "send-text":
        guard let payload, !payload.isEmpty else {
            throw MicrodexDesktopError.invalidAction("send-text requires text")
        }
        try sendTextToComposer(payload)
    case "insert-text":
        guard let payload, !payload.isEmpty else {
            throw MicrodexDesktopError.invalidAction("insert-text requires text")
        }
        try insertTextInComposer(payload)
    case "command-menu":
        guard let payload, !payload.isEmpty else {
            throw MicrodexDesktopError.invalidAction("command-menu requires a query")
        }
        try runCommandMenu(payload)
    case "menu-item":
        guard let payload, !payload.isEmpty else {
            throw MicrodexDesktopError.invalidAction("menu-item requires a menu title")
        }
        try performApplicationMenuItem(exactly: payload)
    case "chat-action":
        guard let payload, !payload.isEmpty else {
            throw MicrodexDesktopError.invalidAction("chat-action requires a title")
        }
        try runChatAction(payload)
    case "copy-markdown":
        try copyChatAsMarkdown()
    case "worktree":
        try continueInNewWorktree()
    case "attach-files":
        try openFileAttachmentPicker()
    case "scheduled":
        _ = try activateChatGPT()
        try pressElement(matching: "Scheduled", role: kAXButtonRole, activate: false)
    case "terminal":
        _ = try activateChatGPT()
        if try findElement(
            matching: "Terminal input",
            role: kAXTextFieldRole,
            activate: false
        ) != nil,
           let bottomPanel = try findElement(
               matching: "Toggle bottom panel",
               role: kAXCheckBoxRole,
               activate: false
           ) {
            try clickElement(bottomPanel)
        } else {
            try performApplicationMenuItem(exactly: "Open Terminal")
        }
    case "open-url":
        guard let payload,
              let url = URL(string: payload),
              ["https", "http"].contains(url.scheme?.lowercased() ?? "") else {
            throw MicrodexDesktopError.invalidAction("open-url requires an HTTP or HTTPS URL")
        }
        NSWorkspace.shared.open(url)
    case "clear-composer":
        let app = try activateChatGPT()
        let accessibilityApp = accessibilityElement(for: app)
        guard let composer = findComposer(in: accessibilityApp) else {
            throw MicrodexDesktopError.composerNotFound
        }
        AXUIElementSetAttributeValue(composer, kAXValueAttribute as CFString, "" as CFTypeRef)
    case "sidebar":
        _ = try activateChatGPT()
        if let sidebarButton = try findElement(
            exactly: "Show sidebar",
            role: kAXButtonRole,
            activate: false
        ) ?? findElement(
            exactly: "Hide sidebar",
            role: kAXButtonRole,
            activate: false
        ) {
            try clickElement(sidebarButton)
        } else {
            throw MicrodexDesktopError.invalidAction("Codex sidebar control is not available")
        }
    case "back":
        _ = try activateChatGPT()
        try pressElement(matching: "Back", role: kAXButtonRole, activate: false)
    case "forward":
        _ = try activateChatGPT()
        try pressElement(matching: "Forward", role: kAXButtonRole, activate: false)
    case "composer-previous":
        _ = try activateChatGPT()
        postKey(CGKeyCode(kVK_UpArrow))
    case "composer-next":
        _ = try activateChatGPT()
        postKey(CGKeyCode(kVK_DownArrow))
    case "composer-select":
        _ = try activateChatGPT()
        postKey(CGKeyCode(kVK_Return))
    case "conversation-scroll-up":
        _ = try activateChatGPT()
        postKey(CGKeyCode(kVK_PageUp))
    case "conversation-scroll-down":
        _ = try activateChatGPT()
        postKey(CGKeyCode(kVK_PageDown))
    case "keyboard-shortcuts":
        // The Help menu carries the real command, so no shortcut guessing.
        try performApplicationMenuItem(exactly: "Keyboard Shortcuts")
    case "dismiss":
        // Closes whatever overlay is on screen. A left open modal hides the rest
        // of the interface from accessibility, which breaks later lookups.
        _ = try activateChatGPT()
        postKey(CGKeyCode(kVK_Escape))
    // Menu-driven controls. The menu bar is always exposed to accessibility,
    // which makes these the most reliable actions available.
    case "previous-chat":
        try performApplicationMenuItem(exactly: "Previous Chat")
    case "next-chat":
        try performApplicationMenuItem(exactly: "Next Chat")
    case "file-tree":
        try performApplicationMenuItem(exactly: "Toggle File Tree")
    case "bottom-panel":
        try performApplicationMenuItem(exactly: "Toggle Bottom Panel")
    case "pinned-summary":
        try performApplicationMenuItem(exactly: "Toggle Pinned Summary")
    case "find":
        try performApplicationMenuItem(exactly: "Find")
    case "new-chat":
        try performApplicationMenuItem(exactly: "New Chat")
    case "archive-chat":
        try runChatAction("Archive chat")
    case "fork-chat":
        try continueInNewChat()
    case "review":
        try performApplicationMenuItem(exactly: "Toggle Review Panel")
    case "select-chat":
        guard let payload, !payload.isEmpty else {
            throw MicrodexDesktopError.invalidAction("select-chat requires a task title")
        }
        try selectVisibleChat(payload)
    case "command-menu-open":
        _ = try activateChatGPT()
        postKey(CGKeyCode(kVK_ANSI_K), flags: .maskCommand)
    case "command-menu-search":
        guard let payload, !payload.isEmpty else {
            throw MicrodexDesktopError.invalidAction("command-menu-search requires a query")
        }
        _ = try activateChatGPT()
        postKey(CGKeyCode(kVK_Escape))
        postKey(CGKeyCode(kVK_ANSI_K), flags: .maskCommand)
        Thread.sleep(forTimeInterval: 0.18)
        guard let commandInput = try findVisibleCommandInput() else {
            throw MicrodexDesktopError.invalidAction("The Codex command search did not open")
        }
        try clickElement(commandInput)
        AXUIElementSetAttributeValue(commandInput, kAXFocusedAttribute as CFString, kCFBooleanTrue)
        postKey(CGKeyCode(kVK_ANSI_A), flags: .maskCommand)
        try typeCommandQuery(payload)
        Thread.sleep(forTimeInterval: 0.3)
    default:
        throw MicrodexDesktopError.invalidAction(action)
    }
}

let arguments = Array(CommandLine.arguments.dropFirst())
let operation = arguments.first ?? "status"

do {
    if operation == "status" {
        let trusted = accessibilityTrusted(prompt: false)
        let running = runningChatGPT() != nil
        // `working` means Codex is generating right now: the Stop control is
        // only on screen during a turn, and the app turns it into the thinking
        // LED. It is not a health flag.
        let working = trusted
            && running
            && (try? findElement(
                exactly: "Stop",
                role: kAXButtonRole,
                activate: false
            )) != nil
        // `windowTree` is the health flag: whether the web view exposes its
        // content at all. Without it every element lookup is a silent no-op.
        json([
            "ok": true,
            "trusted": trusted,
            "running": running,
            "windowTree": trusted && running && windowTreeReachable(),
            "working": working,
        ])
    } else if operation == "permission" {
        let trusted = accessibilityTrusted(prompt: true)
        json(["ok": trusted, "trusted": trusted, "running": runningChatGPT() != nil])
        if !trusted { exit(2) }
    } else if operation == "action" {
        guard arguments.count >= 2 else {
            throw MicrodexDesktopError.invalidAction("missing action")
        }
        try execute(arguments[1], payload: arguments.count >= 3 ? arguments[2] : nil)
        var result: [String: Any] = ["ok": true, "action": arguments[1]]
        for (key, value) in actionDetails { result[key] = value }
        json(result)
    } else if operation == "inspect" {
        json(["ok": true, "elements": try inspectChatGPT()])
    } else if operation == "describe" {
        // Reports what a control actually is: its role, its frame, and the
        // accessibility actions it declares. Without this the only way to find
        // out why a press does nothing is to guess and re-test.
        guard arguments.count >= 2 else {
            throw MicrodexDesktopError.invalidAction("describe requires a title prefix")
        }
        let needle = arguments[1].lowercased()
        guard let app = runningChatGPT() else {
            throw MicrodexDesktopError.chatGPTNotRunning
        }
        let accessibilityApp = accessibilityElement(for: app)
        var queue: [AXUIElement] = [accessibilityApp]
        var found: [[String: Any]] = []
        var visited = 0

        while !queue.isEmpty && visited < 8_000 {
            let element = queue.removeFirst()
            visited += 1
            // Title or description: the picker rows leave the title empty and put
            // "Speed Standard" in the description, so matching on the title alone
            // reported no matches for controls that were on screen.
            let title = stringAttribute(element, kAXTitleAttribute)
            let describedAs = stringAttribute(element, kAXDescriptionAttribute)
            if title.lowercased().hasPrefix(needle) || describedAs.lowercased().hasPrefix(needle) {
                var actionNames: CFArray?
                AXUIElementCopyActionNames(element, &actionNames)
                var entry: [String: Any] = [
                    "role": stringAttribute(element, kAXRoleAttribute),
                    "subrole": stringAttribute(element, kAXSubroleAttribute),
                    "title": title,
                    "description": stringAttribute(element, kAXDescriptionAttribute),
                    "value": stringAttribute(element, kAXValueAttribute),
                    "enabled": boolAttribute(element, kAXEnabledAttribute),
                    "actions": (actionNames as? [String]) ?? [],
                    "visibleFrame": hasVisibleFrame(element),
                ]
                if let positionObject = copyAttribute(element, kAXPositionAttribute),
                   let sizeObject = copyAttribute(element, kAXSizeAttribute),
                   CFGetTypeID(positionObject) == AXValueGetTypeID(),
                   CFGetTypeID(sizeObject) == AXValueGetTypeID() {
                    var position = CGPoint.zero
                    var size = CGSize.zero
                    AXValueGetValue(unsafeBitCast(positionObject, to: AXValue.self), .cgPoint, &position)
                    AXValueGetValue(unsafeBitCast(sizeObject, to: AXValue.self), .cgSize, &size)
                    entry["frame"] = "\(Int(position.x)),\(Int(position.y)) \(Int(size.width))x\(Int(size.height))"
                } else {
                    entry["frame"] = "none"
                }
                found.append(entry)
            }
            guard let children = copyAttribute(element, kAXChildrenAttribute) as? [AXUIElement] else {
                continue
            }
            queue.append(contentsOf: children)
        }
        json(["ok": true, "query": arguments[1], "matches": found])
    } else if operation == "inspect-model-picker" {
        // Speed and Effort live inside the model popover, so they cannot be
        // probed while it is closed. Opening and dumping in one process keeps
        // the popover on screen for the traversal.
        postKey(CGKeyCode(kVK_Escape))
        let picker = try findModelPicker()
        let pickerTitle = picker.map { stringAttribute($0, kAXTitleAttribute) } ?? ""
        try openModelPicker()
        Thread.sleep(forTimeInterval: 0.4)
        let opened = try inspectChatGPT().filter { ($0["role"] as? String) == kAXMenuItemRole }

        let compactToggle = try findElement(
            matching: "Show compact options",
            role: kAXMenuItemRole,
            activate: false
        ) != nil
        postKey(CGKeyCode(kVK_Escape))

        // The Speed and Effort values live one level deeper, so each submenu
        // has to be opened and dumped separately.
        var submenus: [String: [[String: Any]]] = [:]
        for name in ["Speed", "Effort"] {
            do {
                try prepareAdvancedModelPicker()
                let item = try compactMenuItem(named: name)
                let before = Set(
                    try inspectChatGPT()
                        .filter { ($0["role"] as? String) == kAXMenuItemRole }
                        .compactMap { $0["title"] as? String }
                )
                try clickElement(item)
                Thread.sleep(forTimeInterval: 0.4)
                // Only what the submenu added is interesting.
                submenus[name] = try inspectChatGPT()
                    .filter { ($0["role"] as? String) == kAXMenuItemRole }
                    .filter { !before.contains(($0["title"] as? String) ?? "") }
            } catch {
                submenus[name] = [["error": String(describing: error)]]
            }
            postKey(CGKeyCode(kVK_Escape))
            Thread.sleep(forTimeInterval: 0.2)
            postKey(CGKeyCode(kVK_Escape))
        }

        json([
            "ok": true,
            "pickerTitle": pickerTitle,
            "alreadyAdvanced": compactToggle,
            "opened": opened,
            "submenus": submenus,
        ])
    } else if operation == "press" {
        guard arguments.count >= 2 else {
            throw MicrodexDesktopError.invalidAction("missing UI query")
        }
        try pressElement(matching: arguments[1], role: arguments.count >= 3 ? arguments[2] : nil)
        json(["ok": true, "query": arguments[1]])
    } else if operation == "axpress" {
        guard arguments.count >= 2 else {
            throw MicrodexDesktopError.invalidAction("missing UI query")
        }
        // Menu items are matched by prefix, not by substring. Asking for
        // "Standard" used to press "Speed Standard", the compact row, because it
        // contains the word — which made a manual check report success while
        // pressing the wrong control entirely.
        let wantsMenuItem = arguments.count >= 3 && arguments[2] == kAXMenuItemRole
        let element = wantsMenuItem
            ? try findMenuItem(startingWith: arguments[1])
            : try findElement(
                matching: arguments[1],
                role: arguments.count >= 3 ? arguments[2] : nil
            )
        guard let element else {
            throw MicrodexDesktopError.invalidAction("UI element not found: \(arguments[1])")
        }
        let title = stringAttribute(element, kAXTitleAttribute)
        let result = AXUIElementPerformAction(element, kAXPressAction as CFString)
        if result != .success {
            throw MicrodexDesktopError.invalidAction("UI element could not be pressed: \(arguments[1])")
        }
        json(["ok": true, "query": arguments[1], "pressed": title])
    } else if operation == "exists" {
        guard arguments.count >= 2 else {
            throw MicrodexDesktopError.invalidAction("missing UI query")
        }
        var found = try findElement(
            matching: arguments[1],
            role: arguments.count >= 3 ? arguments[2] : nil
        ) != nil
        if !found {
            for _ in 0..<20 {
                Thread.sleep(forTimeInterval: 0.04)
                found = try findElement(
                    matching: arguments[1],
                    role: arguments.count >= 3 ? arguments[2] : nil,
                    activate: false
                ) != nil
                if found { break }
            }
        }
        json(["ok": true, "found": found, "query": arguments[1]])
    } else if operation == "inspect-flow" {
        for (index, item) in arguments.dropFirst().enumerated() {
            let components = item.components(separatedBy: "::")
            try pressElement(
                matching: components.last ?? item,
                role: components.count > 1 ? components.first : nil,
                activate: index == 0
            )
        }
        json(["ok": true, "elements": try inspectChatGPT()])
    } else {
        throw MicrodexDesktopError.invalidAction(operation)
    }
} catch {
    json(["ok": false, "error": String(describing: error)])
    exit(1)
}
