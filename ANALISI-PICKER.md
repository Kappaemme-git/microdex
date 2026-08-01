# Fast Mode ed Effort: cosa sappiamo, cosa resta

Problema aperto: **17 comandi su 21 funzionano**. Falliscono solo quelli che
passano dal picker del modello, cioè Fast Mode e il cambio di effort.

## Dove siamo esattamente

La catena è tracciata fino all'ultimo anello, e tutto regge tranne quello:

1. il picker si apre — `Apertura picker` verde, e il dump mostra le sue righe
2. la riga `Speed` viene trovata — nessun errore "control is not available"
3. il sottomenu si apre — `Fast 1.5x speed, more usage` compare nell'albero
4. la voce viene trovata — nessun errore "option is not available"
5. **il clic sulla voce non applica il valore** — la riga resta `Speed Standard`

Resta un solo esperimento mai fatto in isolamento: `AXPress` **solo sulla voce
finale**, tenendo il mouse per il bottone del picker e per la riga padre.
Applicarlo a tutti e tre insieme è stato provato e rompe l'apertura del picker.

Misura da fare prima, ora che `describe` legge anche la description:

```bash
~/.microdex/bin/MicrodexDesktop action model-picker
~/.microdex/bin/MicrodexDesktop axpress "Speed" AXMenuItem
~/.microdex/bin/MicrodexDesktop describe "Fast"
```

Se fra le `actions` compare `AXPress`, la correzione è di tre righe.

File coinvolti: `bridge/native/MicrodexDesktop.swift` (funzioni `setFastMode`,
`setReasoningEffort`, `prepareAdvancedModelPicker`, `openModelPicker`,
`findModelPicker`, `compactMenuItem`, `clickElement`) e
`bridge/lib/remote-settings.mjs` (`applyFastSetting`).

Per riprodurre: `node bridge/scripts/check-all-actions.mjs` con Codex aperto su
una chat.

---

## Fatti accertati, non ipotesi

**1. Il cambio avviene, e viene dichiarato fallito.**
Il 30 luglio alle 14:45 `MicrodexDesktop action fast false` ha risposto
`"Codex speed did not change to standard"`. Subito dopo, una lettura indipendente
del picker mostrava `"Speed Standard"`. Il valore *era* cambiato. Questo è il
comportamento centrale da spiegare.

**2. Il clic del mouse apre il picker, `AXPress` no.**
Dopo `action model-picker` implementato con `AXPress` sul popup button,
`MicrodexDesktop describe "Speed"` restituisce `{"matches":[]}` — nessun elemento
con quel titolo esiste nell'albero. Con il clic del mouse, `inspect-model-picker`
legge regolarmente `"Speed Fast"`. Entrambe le varianti con `AXPress` sono già
state provate e ritirate.

**3. Le etichette reali di questa build di Codex** (app 26.721.81911):

```
Riga compatta:   "Speed Standard" | "Speed Fast" | "Effort Extra High"
Sottomenu Speed: "Standard Default speed" | "Fast 1.5x speed, more usage"
Sottomenu Effort: "Light" | "Medium" | "High" | "Extra High" | "Ultra Consumes usage limits faster"
Toggle vista:    "Show advanced options" / "Show compact options"
```

**4. Un bug reale già corretto.** `compactMenuItem` cercava per sottostringa, e
`"Standard Default speed"` contiene `"speed"`: la ricerca in ampiezza poteva
restituire una voce del sottomenu invece della riga compatta, e il confronto
falliva. Ora cerca per prefisso. La correzione è giusta ma **non è bastata**.

**5. Il tempo non è la causa.** Aggiunti 0,4 s dopo l'apertura del picker e 16
tentativi in `compactMenuItem`: l'errore resta.

**6. Trappola di compilazione.** Il companion Swift viene ricompilato solo da
`ensureDesktopCompanion()`. Uno script che lancia `~/.microdex/bin/MicrodexDesktop`
direttamente prova il binario vecchio. Diverse prove di questa sessione sono
state fatte così e vanno considerate non valide.

---

## Strada chiusa: passare dall'App Server invece che dal clic

Nelle versioni 0.1.4 e 0.1.7 `applyFastSetting` applicava con
`codex.updateSettings(body)` e usava il clic solo come specchio. Fra la 0.1.7 e
la 0.1.10 l'ordine è stato invertito: il clic è diventato il meccanismo, l'App
Server la sola rilettura.

Sembrava la spiegazione di tutto. **Non lo è**, e la misura è netta:

```
App Server prima: fastMode = false
Picker prima:     Speed Standard
Chiedo fastMode = true solo tramite App Server...
App Server risponde: fastMode = true
Picker dopo:      Speed Standard
```

L'App Server accetta il valore e lo conferma, ma la finestra visibile non cambia:
sono due copie separate della stessa task. Invertire l'ordine produrrebbe
un'affermazione falsa — l'app direbbe "Fast attivo" con Codex su Standard.

Riproducibile con `node bridge/scripts/try-app-server-setting.mjs on`.

Il commento nel codice attuale — *"The visible Codex task is authoritative"* —
è quindi corretto e va lasciato dov'è.

## Ipotesi, in ordine di probabilità

### A. La verifica è duplicata e quella fragile vince

`setFastMode` clicca, poi **riapre il picker fino a otto volte** e rilegge la
riga:

```swift
for _ in 0..<8 {
    Thread.sleep(forTimeInterval: 0.18)
    try prepareAdvancedModelPicker()   // Escape + riapri + attesa
    let updatedSpeed = try compactMenuItem(named: "Speed")
    if compactMenuSummary(updatedSpeed).contains(expectedSummary) { applied = true; break }
    postKey(CGKeyCode(kVK_Escape))
}
```

Ma `bridge/lib/remote-settings.mjs` fa già una verifica **autorevole**: chiede lo
stato all'App Server di Codex e confronta con `verifyFastSetting`. Quella non
dipende dall'interfaccia.

La rilettura del popover è invece una gara con l'animazione: Escape, riapri,
leggi. Se il popover non è nello stato giusto in quel momento, dichiara fallito
un cambio avvenuto — che è esattamente il fatto 1.

**Da fare:** togliere il ciclo di verifica dal companion e lasciare la verifica
all'App Server. Il companion riporta di aver eseguito il clic; se il clic non ha
avuto effetto, `verifyFastSetting` lo rileva comunque. Si perde una verifica
ridondante, non la sicurezza.

### B. Il clic sulle voci di menu è teletrasportato

`clickElement` sposta il puntatore al centro dell'elemento e clicca subito:

```swift
CGEvent(mouseType: .mouseMoved, ...).post()
Thread.sleep(forTimeInterval: 0.04)
CGEvent(mouseType: .leftMouseDown, ...).post()
```

I menu di macOS seguono il puntatore e si aspettano un movimento continuo. Un
salto secco può non evidenziare la voce prima del clic, e in un sottomenu può
farlo chiudere. Spiegherebbe l'intermittenza.

**Da provare:** muovere prima sulla riga padre, breve attesa, poi sulla voce
figlia, altra attesa, poi il clic. Oppure passi intermedi fra le due posizioni.

### C. La selezione si perde alla chiusura

Dopo `clickElement(target)` il codice attende 0,18 s e poi manda **Escape** per
riaprire il picker. Se Codex applica il valore solo alla chiusura naturale del
popover, quell'Escape potrebbe annullarlo.

**Da provare:** dopo la selezione, chiudere il popover cliccando fuori invece che
con Escape, e attendere di più prima di qualsiasi rilettura.

### D. Il controllo iniziale legge una riga stantia

```swift
let speedItem = try compactMenuItem(named: "Speed")
if compactMenuSummary(speedItem).contains(expectedSummary) {
    postKey(CGKeyCode(kVK_Escape)); return   // "già a posto", esce senza fare nulla
}
```

Se questo legge un valore vecchio, il comando esce dichiarando successo senza
agire. È l'inverso del fatto 1 ed è compatibile con l'intermittenza percepita.

---

## Cosa è già stato escluso

- **Permesso di Accessibilità**: `trusted: ok`, e 17 comandi funzionano.
- **Albero della finestra vuoto**: `windowTree: ok`, 339 elementi.
- **Piano o modello**: Fast Mode si attiva a mano senza problemi.
- **Etichette sbagliate**: verificate una per una nel dump.
- **`AXPress` sul popup o sulle voci**: provato due volte, peggiora.
- **Tempi di attesa**: aumentati, nessun effetto.

---

## Due questioni minori

**`Scheduled tasks` alterna fra OK ed errore** fra esecuzioni consecutive dello
stesso script. Dipende dalla schermata in cui Codex si trova all'inizio del giro,
non dal codice. Lo script andrebbe reso indipendente dallo stato iniziale.

**`Copia come Markdown`** cerca un popover chiamato `Chat actions` che nel dump
non compare. In questa build il controllo si chiama diversamente. Comando
secondario.

---

## Come verificare una correzione

```bash
cd ~/Documents/Microcodex
node bridge/scripts/check-all-actions.mjs
```

Lo script ricompila il companion da sé. Per Fast Mode ed Effort non si fida
dell'esito: rilegge il valore vero e distingue `OK`, `NON APPLICATO` e `INCERTO`.

Misura mirata su un singolo controllo, con il picker aperto:

```bash
~/.microdex/bin/MicrodexDesktop action model-picker
~/.microdex/bin/MicrodexDesktop describe "Speed"
```

`describe` riporta ruolo, cornice, stato di abilitazione e azioni dichiarate.

**Regola imparata a caro prezzo: prima misurare, poi cambiare.** In questa
sessione tre modifiche al companion sono state fatte per ragionamento invece che
su misura, e due erano sbagliate.
