# La versione che funzionava: microdex-cli 0.1.4

Non c'erano commit, ma una storia esiste lo stesso: **ogni versione pubblicata su
npm contiene il companion Swift completo**. Undici istantanee fra il 26 e il 30
luglio, scaricabili con `npm pack microdex-cli@<versione>`.

Confrontandole, la rottura ha una data e un contenuto precisi.

## Cosa è cambiato, e quando

| versione | data | picker | come cambia Fast Mode | ciclo di verifica |
|---|---|---|---|---|
| 0.1.4 | 27 lug | **compatto** | voce diretta `Enable fast mode`, un clic | no |
| 0.1.7 | 28 lug | avanzato | riga `Speed` → sottomenu → `Fast` | sì |
| 0.1.9 → 0.1.12 | 29-30 lug | avanzato | idem | sì |

La riscrittura è avvenuta fra la **0.1.4 e la 0.1.7**. Da lì in poi Fast Mode
richiede tre passaggi invece di uno, e aggiunge una verifica che riapre il picker
fino a otto volte.

## L'implementazione che funzionava

```swift
func prepareCompactModelPicker() throws {
    postKey(CGKeyCode(kVK_Escape))
    try openModelPicker()
    if let compactToggle = try findElement(
        matching: "Show compact options",
        role: kAXMenuItemRole,
        activate: false
    ) {
        try clickElement(compactToggle)
    }
}

func setFastMode(_ enabled: Bool) throws {
    try prepareCompactModelPicker()
    let target = enabled ? "Enable fast mode" : "Enable standard mode"
    let opposite = enabled ? "Enable standard mode" : "Enable fast mode"
    if let targetElement = try findElement(matching: target, role: kAXMenuItemRole, activate: false) {
        try clickElement(targetElement)
        postKey(CGKeyCode(kVK_Escape))
        return
    }
    // Gia' nello stato richiesto: la voce presente e' quella opposta.
    if try findElement(matching: opposite, role: kAXMenuItemRole, activate: false) != nil {
        postKey(CGKeyCode(kVK_Escape))
        return
    }
    throw MicrodexDesktopError.invalidAction("Codex Fast Mode control is not available")
}
```

Due proprietà che la rendono robusta, ed entrambe sono andate perse:

1. **Un solo clic su una voce diretta.** Nessun sottomenu da aprire, quindi
   nessuna gara con l'animazione, nessun puntatore da tenere sopra una riga
   padre.
2. **Nessuna verifica nel companion.** Non poteva dichiarare fallito un cambio
   avvenuto — che è il difetto centrale della versione attuale.

## La verifica da fare per prima

Tutti i dump raccolti finora sono della **vista avanzata**, perché il picker su
questo Mac è in quello stato. Nessuno ha mai guardato la vista compatta.

Nel picker di Codex, clicca **"Show compact options"**, poi:

```bash
~/.microdex/bin/MicrodexDesktop inspect-model-picker
```

Se fra le voci compare `Enable fast mode` o `Enable standard mode`, la strada è
tornare all'approccio della 0.1.4: una voce, un clic, e la verifica lasciata
all'App Server in `bridge/lib/remote-settings.mjs`, che è autorevole.

Se invece quelle voci non esistono più, Codex ha cambiato interfaccia dopo il 27
luglio e va ricostruito il percorso sulla vista compatta attuale.

## Nota sull'effort

Nella 0.1.4 l'effort era uno **slider**, pilotato calcolando una coordinata sulla
traccia:

```swift
let x = position.x + trackInset
    + CGFloat(sliderIndex) * (size.width - trackInset * 2) / CGFloat(efforts.count - 1)
```

Fragile in modo diverso — dipende dalla geometria — ma spiega perché anche
l'effort si comportava in un altro modo all'epoca. La vista compatta ha uno
slider, quella avanzata ha un sottomenu con voci nominate.

## Come recuperare qualsiasi versione

```bash
cd /tmp && npm pack microdex-cli@0.1.4 && tar -xzf microdex-cli-0.1.4.tgz
diff package/bridge/native/MicrodexDesktop.swift \
     ~/Documents/Microcodex/bridge/native/MicrodexDesktop.swift
```

Versioni disponibili: dalla 0.1.0 alla 0.1.11.
