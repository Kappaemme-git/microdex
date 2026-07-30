# Microdex — interventi del 30 luglio 2026

Sessione di debug e sviluppo su bridge, companion desktop e app mobile.
Punto di partenza: i comandi dal telefono arrivavano a Codex ma non facevano
nulla, e nel picker dei tasti mancavano dei comandi.

---

## 1. La causa radice: l'albero di accessibilità era vuoto

**Sintomo.** Dal telefono funzionavano solo l'invio dei messaggi e il cambio
chat. Fast Mode, effort, Plan Mode, sidebar, prompt custom: il comando arrivava,
Codex non reagiva, l'app diceva OK.

**Diagnosi.** Il dump dell'albero di accessibilità dell'app Codex
(`/Applications/ChatGPT.app`, `com.openai.codex`, build 26.721.81911) restituiva
182 elementi, **tutti menu bar**. Zero finestre, zero bottoni, zero composer.

L'app Codex ospita l'interfaccia in una web view Chromium. Quei runtime non
costruiscono l'albero di accessibilità per il contenuto della finestra finché un
client non lo chiede esplicitamente, tramite l'attributo privato
`AXManualAccessibility`. Il companion non lo chiedeva mai: cercava composer,
menu Speed/Effort e bottoni Approve in un albero vuoto, non trovava niente e
usciva `ok: true`.

Coerente coi sintomi: `send` è `activate + Invio` e `select-chat` cerca il
titolo della chat, stringa dinamica dall'App Server. Nessuno dei due fa lookup
sull'albero, quindi funzionavano.

**Correzione.** `bridge/native/MicrodexDesktop.swift`

- Nuovo `accessibilityElement(for:)` che richiede `AXManualAccessibility` e
  `AXEnhancedUserInterface` una volta per processo e attende che le finestre
  compaiano.
- Tutti i 15 punti che creavano l'elemento applicazione a mano ora passano da lì.
- Risultato misurato: da 182 a 339 elementi, contenuto finestra da 0 a 124.

---

## 2. I falsi successi

**Problema.** `withVerifiedCommand` in `bridge/server.mjs` scriveva
`applied: true, verified: true` a mano per ogni azione desktop, senza verificare
niente. Le azioni che sono solo scorciatoie da tastiera tornano sempre `ok`
anche se Codex le ignora. Il telefono mostrava un successo inventato.

**Correzione.**

- `bridge/lib/codex-desktop-control.mjs`: se `windowTree` è false, le azioni che
  richiedono l'albero lanciano `WINDOW_TREE_UNREACHABLE` invece di fingere.
- `bridge/server.mjs`: nuovo campo `confirmed`, vero solo con evidenza
  dall'App Server. `verified` resta vero per compatibilità con le build vecchie
  dell'app, che leggono quel campo e mostrerebbero un errore su ogni tasto
  funzionante.
- `mobile/app/index.tsx`: un comando consegnato ma non confermato viene trattato
  come riuscito con un avviso, non come errore.

**Nota.** Il primo tentativo era sbagliato: avevo messo `verified: false` sulle
azioni desktop, e questo avrebbe fatto comparire un errore su ogni tasto
funzionante nella build TestFlight già installata.

---

## 3. Etichette dell'interfaccia Codex

**Problema.** Il codice cercava stringhe inglesi scritte a mano. Alcune erano
giuste, una era concettualmente sbagliata.

**Cosa era già corretto** e ha ripreso a funzionare da sé una volta popolato
l'albero: `Hide sidebar`, `Back`, `Forward`, `Toggle bottom panel`, `Scheduled`,
e le voci di menu `New Chat`, `Open Terminal`, `Toggle Review Panel`.

**Il bug vero.** Il toggle del picker del modello è etichettato con la
destinazione, non con lo stato: `Show advanced options` quando la vista è
compatta, `Show compact options` quando è già avanzata. Il codice cercava solo
la prima etichetta. Se l'utente fosse tornato in vista compatta,
`prepareAdvancedModelPicker` avrebbe cliccato il toggle nel momento sbagliato,
richiudendo la vista e nascondendo Speed ed Effort proprio prima di cercarli.

**Correzione.** La voce compatta viene controllata per prima e significa
"niente da fare". Aggiunte varianti alternative dell'etichetta.

Le etichette reali osservate nel picker sono compatte, non titolo più valore:

```
Show compact options
Model 5.6 Sol
Effort Extra High
Speed Standard
```

E nei sottomenu:

```
Speed:  Standard Default speed  |  Fast 1.5x speed, more usage
Effort: Light | Medium | High | Extra High | Ultra Consumes usage limits faster
```

La regola di match del companion — uguaglianza o etichetta seguita da spazio —
le prende tutte correttamente.

---

## 4. La scala dell'effort

**Problema 1.** Il bridge assumeva `low, medium, high, xhigh, max, ultra`, con
`max` fra `xhigh` e `ultra`. Su 5.6 Sol `Max` non esiste. Salendo con il dial da
Extra High il bridge chiedeva `max`, il companion cercava una voce inesistente,
aspettava 12 tentativi e falliva senza mai arrivare in cima.

**Problema 2.** `verifyReasoningSetting` confrontava lo stato col livello
*richiesto*, quindi anche un adattamento corretto veniva letto come "Codex non
ha applicato l'impostazione".

**Correzione.**

- Il companion legge i livelli realmente presenti nel sottomenu Effort e adatta
  la richiesta, continuando nella direzione del movimento invece di fallire.
- La direzione arriva già dal nome dell'azione, `reasoning-up` o
  `reasoning-down`, e prima veniva scartata.
- Il companion riporta `appliedEffort`; il bridge verifica e scrive quello.
- **Max e Ultra rimossi su richiesta.** Le sei liste che li ripetevano sono
  diventate una: `REASONING_EFFORTS` in `bridge/lib/codex-config.mjs`. Tutto il
  resto deriva da lì. Aggiunto anche un filtro sul lato App Server: se Codex
  dichiara `ultra` fra i livelli supportati, il bridge lo scarta.

`findModelPicker` continua a riconoscere i titoli con `max` e `ultra`: serve a
*trovare* il popup, che Codex nomina col modello corrente. Riconoscere non è
selezionare.

---

## 5. Comandi mancanti nel picker

**Problema.** Il picker esponeva 13 comandi mentre il companion Swift ne
implementava circa 35. Quattro erano anche bloccati dall'allowlist in Node pur
esistendo nello Swift.

**Correzione.** Da 13 a 31 comandi, tutti verificati nel dump dell'albero:
chat precedente e successiva, nuova chat, archivia, terminale, file tree, review
panel, bottom panel, pinned summary, find, scheduled tasks, scorciatoie, allega
file, svuota composer, command menu, model picker, copia come Markdown, continua
in worktree.

Aggiunte sei azioni nello Swift basate su voci di menu reali: `previous-chat`,
`next-chat`, `file-tree`, `bottom-panel`, `pinned-summary`, `find`. Le voci di
menu sono il canale più affidabile: il menu bar è sempre esposto
all'accessibilità, anche quando la web view non lo è.

Corretto `keyboard-shortcuts`, che tirava ⌘/ a caso mentre esiste la voce
`Keyboard Shortcuts` nel menu Aiuto.

---

## 6. La rotella

**Perché sembrava a scatti.** La rotazione del cappuccio era calcolata
dall'`index` che arriva dal parent, quindi girava solo quando React
ri-renderizzava: dopo il commit, non sotto il dito.

**Correzione.** `mobile/components/reasoning-dial.tsx`

- L'angolo è uno shared value scritto dal gesto sul thread UI, con
  `Animated.View` a portare la rotazione.
- Posizione frazionaria durante il trascinamento: fra un livello e l'altro il
  cappuccio scorre invece di saltare.
- Estremi elastici: oltre l'ultimo livello continua al 12% del movimento.
- Ritorno animato con molla se il bridge corregge il livello.
- Sensibilità da 30 a 46 pixel per livello: con quattro livelli, a 30px un
  movimento involontario ne attraversava due.

**Il bug per cui non arrivava a Codex, introdotto da me.** Nel debounce del
commit avevo messo un guard: "se il livello finale è uguale a quello attuale,
non mandare niente". Ma il preview durante il trascinamento aggiorna già
`dialIndex`, che è la stessa cosa che il guard confrontava. Al rilascio i due
valori erano sempre identici e la richiesta non partiva mai: la rotella girava
sulla tastiera e Codex non sapeva nulla. Il dedupe è stato spostato nel parent,
che confronta con `activeThread.reasoningEffort`.

---

## 7. Il ritardo su navigate e scroll

Tre cause sovrapposte.

**Il gesto girava sul thread JS.** Le modalità encoder erano rimaste con
`runOnJS(true)`, e la rotazione arrivava dopo un re-render più una molla. Ora
anche quel pan è un worklet, e gira libero senza fermi.

**Una richiesta HTTP per tacca, in coda seriale.** `encoderQueue` accodava le
chiamate una dopo l'altra: girando veloce il desktop restava indietro di tutta
la profondità della coda. Ora le tacche vengono accorpate, l'app le raccoglie
per 55ms e manda `steps: N`, il bridge ripete l'azione N volte in un solo giro.
Il campo è opzionale, così una build vecchia manda una tacca per volta.

**Uno spawn di processo per tacca, colpa mia.** Ogni azione chiudeva con
`remoteState()`, che chiama `desktopControlStatus()`, che lancia il binario del
companion. Peggio: aggiungendo `windowTree` allo status avevo raddoppiato la
traversata dell'albero. Ora è in cache per 400ms, tranne quando serve il prompt
dei permessi. Ne beneficia ogni azione, non solo la rotella.

---

## 8. Tasti e cappucci

**Il nome sbagliato.** Il tasto sul deck scriveva il cappuccio, non il comando:
con "Effort up" su un cappuccio FAST leggevi FAST.

**La lista incompleta.** I 38 cappucci c'erano tutti, ma in una riga a
scorrimento orizzontale con `showsHorizontalScrollIndicator={false}`: se ne
vedevano sei e nessun indizio che ce ne fossero altri.

**Correzione finale, dopo due passaggi di feedback.**

- Nuovo `mobile/lib/keycap-catalog.ts`: per ognuno dei 38 cappucci la sigla, il
  nome parlato per gli screen reader, l'icona e i comandi per cui è serigrafato.
- Il cappuccio segue il comando: scegli "Effort up" e viene salvato MIND+.
- I tasti sul deck mostrano **solo l'icona**, come i cappucci veri. Il nome del
  comando resta nell'etichetta per gli screen reader.
- La griglia dei cappucci è stata **rimossa dal foglio**: un cappuccio è
  decorazione, e scegliarlo a parte produceva solo tasti con l'etichetta in
  contraddizione col comando. Il foglio ora è titolo, ricerca e lista comandi.

Tre comandi non avevano cappuccio — sidebar, back e bottom panel — così
`commands` è una lista: NAV copre avanti e indietro, DIFF copre review e bottom
panel, APPS copre model picker e sidebar.

---

## 9. Aggiornamenti OTA

La build TestFlight non poteva ricevere modifiche JavaScript: `expo-updates` non
era configurato.

- `mobile/app.json`: blocco `updates` puntato al projectId, `runtimeVersion` con
  policy `appVersion`.
- `mobile/eas.json`: canali `development`, `preview`, `production`.
- **Da fare a mano:** `npx expo install expo-updates`, poi una build nativa. Da
  quella in poi, `npx eas-cli update --branch production` manda il JavaScript in
  pochi secondi senza revisione Apple.

---

## 10. Il deep link di pairing rotto

**Sintomo riportato da un tester.** Aprendo il link di pairing sull'iPhone con
Microdex installato, l'app si apriva su **"Unmatched Route — Page could not be
found"** con l'URL `microdex://pair?url=...&code=...` a schermo.

**Diagnosi.** `microdex://pair` parsa `pair` come **host** e lascia il
**pathname vuoto**. Verificato:

```js
new URL('microdex://pair')   // host 'pair',  pathname ''
new URL('microdex:///pair')  // host '',      pathname '/pair'
```

Expo Router riceveva un percorso vuoto e non trovava la rotta, anche se
`app/pair.tsx` esiste ed è registrata nello Stack. Il codice di pairing andava
perso e non c'era modo di tornare indietro.

**Correzione.**

- `bridge/server.mjs` e `mobile/lib/pairing.ts` generano `microdex:///pair`, la
  forma con host vuoto e percorso reale.
- Il guard in `mobile/app/index.tsx` accetta entrambe le forme, così un bridge
  non aggiornato continua a funzionare.
- Nuovo `mobile/app/+not-found.tsx`: qualsiasi deep link non riconosciuto
  reindirizza alla schermata principale, che legge l'URL da sé. Nessun vicolo
  cieco possibile, per nessuna forma di link.

**Le altre due segnalazioni non erano bug.**

- *Il QR non si scansiona, il link dà errore.* Era **NordVPN**: la schermata di
  errore mostrava "Access Denied" col logo NordVPN. La VPN instrada il traffico
  fuori dalla rete locale, e l'indirizzo del bridge è un IP privato. Va
  disattivata, o esclusa la rete locale dal tunnel.
- *Il bottone blu non fa niente sul Mac.* Corretto: `microdex://` è uno schema
  iOS e non esiste un Microdex per macOS. Quel bottone funziona solo aprendo la
  pagina dall'iPhone.

---

## 11. Strumento diagnostico

Nuovo `bridge/scripts/diagnose-desktop.mjs`. Legge il bundle id vero dell'app
installata, lo stato dei permessi, fa il dump degli elementi separando menu bar
e contenuto finestra, apre il picker del modello e i sottomenu Speed ed Effort,
e verifica una per una le etichette da cui dipende il codice. Non esegue niente
di distruttivo.

Nuova azione `dismiss` nel companion: un modale rimasto aperto nasconde il resto
dell'interfaccia all'accessibilità e falsa ogni lettura successiva. Era il motivo
per cui `model-picker` risultava fallito in una delle prove.

---

## 12. Icone fedeli al Codex Micro

Le approssimazioni MaterialCommunityIcons sono state sostituite nelle superfici
Micro con un set SVG vettoriale ridisegnato dalle serigrafie dei keycap reali.

- Coperti tutti i 38 keycap del bundle, inclusi FAST, APPR, REJ, SPLIT, MIC,
  CODEX, OAI, GIT, PR, DIFF, MIND+/-, YOLO e YEET.
- Il deck, il gestore dei sei tasti, il catalogo dei comandi e la guida usano lo
  stesso tratto arrotondato.
- I sei controlli del layout iniziale non dipendono più da un icon font.
- `composer.submit` suggerisce CODEX, come il layout hardware; OAI resta un
  keycap decorativo assegnabile.

---

## File toccati

**Bridge**

- `bridge/native/MicrodexDesktop.swift`
- `bridge/server.mjs`
- `bridge/lib/codex-desktop-control.mjs`
- `bridge/lib/codex-config.mjs`
- `bridge/lib/codex-app-server.mjs`
- `bridge/lib/programmed-actions.mjs`
- `bridge/lib/remote-settings.mjs`
- `bridge/scripts/diagnose-desktop.mjs` *(nuovo)*

**App**

- `mobile/app/index.tsx`
- `mobile/components/codex-micro-glyph.tsx` *(nuovo)*
- `mobile/components/reasoning-dial.tsx`
- `mobile/components/hardware-key.tsx`
- `mobile/lib/keycap-catalog.ts` *(nuovo)*
- `mobile/lib/programmed-keys.ts`
- `mobile/lib/micro-actions.ts`
- `mobile/lib/bridge.ts`
- `mobile/app.json`, `mobile/eas.json`

**Test**

- `bridge/test/desktop-accessibility-tree.test.mjs` *(nuovo)*
- `bridge/test/keycap-catalog.test.mjs` *(nuovo)*
- `bridge/test/encoder-actions.test.mjs`
- `bridge/test/programmed-actions.test.mjs`
- `bridge/test/visible-desktop-settings.test.mjs`
- `bridge/test/remote-settings.test.mjs`

---

## Stato dei test

`node --test bridge/test/*.test.mjs` → **97 test, 95 verdi**.
`npm run lint`, `npx tsc --noEmit` e il bundle Expo iOS → puliti.

I due test rossi sono il conflitto già noto fra la rimozione intenzionale di
Max/Ultra dal bridge e il modello Codex attivo, che continua a dichiararli:

- `bridge and mobile expose every effort supported by the active Codex model`
- `every effort currently shown on the mobile dial reaches another Codex client`

Non riguardano il nuovo set di icone; i suoi test mirati sono **11/11 verdi**.

---

## Test aggiunti

Coprono i punti in cui il codice era già stato sbagliato una volta:

- il companion chiede l'albero al web view e nessuno crea l'elemento
  applicazione a mano;
- `windowTree` è separato da `working`, che significa "Codex sta generando" e
  pilota il LED thinking;
- le azioni da tastiera e da menu non vengono bloccate quando l'albero manca;
- l'allowlist Node copre ogni azione implementata nello Swift;
- gli alias dell'effort coprono le etichette reali osservate su questa build;
- il dial non chiede mai un livello che il modello non offre;
- il bridge verifica il livello applicato, non quello richiesto;
- la rotella committa il livello su cui è finito il dito;
- le tacche dell'encoder sono accorpate e un `press` resta un evento singolo;
- lo status del companion è in cache ma non per il prompt dei permessi;
- catalogo cappucci e bridge descrivono lo stesso insieme, ogni comando
  eseguibile ha un cappuccio, nessun cappuccio punta a un comando inesistente.
- tutti i 38 keycap hanno un SVG dedicato e i sei controlli del layout iniziale
  non ricadono più sulle approssimazioni dell'icon font.

---

## Punti aperti

1. **Ultra su 5.6 Sol.** Nel dump il sottomenu Effort mostrava
   `Ultra Consumes usage limits faster`, quindi risulta presente. È stato
   escluso su richiesta. Se non è realmente selezionabile per piano o account,
   va escluso a monte e non solo trattato come limite.

2. **Se navigate e scroll fossero ancora in ritardo**, il collo di bottiglia
   resta nel companion Swift: ogni tacca fa una traversata dell'albero per
   trovare il composer. La strada è tenere in cache l'elemento fra un colpo e
   l'altro.

3. **Plan Mode** non è stato toccato. Digita `/plan` nel composer e poi cerca la
   voce "Plan mode". Nel dump è comparso un `AXPopUpButton` "Switch mode,
   current mode: ChatGPT" e un gruppo "Composer mode" con checkbox Chat e Work:
   probabilmente un canale più stabile, ma servirebbe una verifica prima di
   cambiarlo.
