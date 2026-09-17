---
plan_id: "v2-user-input-1a4ee493c8ab-947e0a09"
revision: 6
source_identity: "user-input:1a4ee493c8ab"
source_artifact: "var/agent/task-plan/v2-user-input-1a4ee493c8ab-947e0a09/source.json"
source_sha256: "a09c4648a58ada96a0415eb1c3bfe14f3f1fe9b6fb06944c5f97d7d3c234d153"
context_status: "COMPLETE"
context_report: "var/agent/cache/context-scout-hybrid/plugins-scope-58771166-114d-4f31-8530-ec891bd0b67d-fallback.report.json"
context_report_sha256: "069441915c4ec1abd57e67d6957c58b346051afe7aed1ee812d7bb078c2c5e8b"
context_criteria: "var/agent/cache/context-scout-hybrid/plugins-scope.criteria.json"
context_criteria_sha256: "45f883048d8601b45804ff6711c91af83cdbc0fd1b10206f84694c4fc8e96daa"
updated_at: "2026-09-17T14:37:33.904Z"
---
# Synchronizacja katalogu .opencode/plugins

## Source and objective

Źródłem planu jest bieżące polecenie użytkownika dotyczące rozszerzenia mechanizmu lsm o synchronizację katalogu .opencode/plugins. Celem jest przygotowanie implementowalnego planu; kod nie jest zmieniany w ramach tego dokumentu.

## Source assessment

- Requested outcome: lsm ma synchronizować źródłowy katalog .opencode/plugins do docelowego .opencode/plugins analogicznie do obecnej obsługi .opencode/agents.
- Observed symptoms: obecne discovery subagentów rozpoznaje warianty .opencode/agent(s) i pliki Markdown, dlatego zwykłe rozszerzenie listy nazw nie obejmie rekurencyjnego katalogu pluginów z plikami innych typów.
- Explicit constraints: pierwsza wersja ma kopiować rekurencyjnie pliki, korzystać z istniejącego managed-file pipeline, obsługiwać lock i locked sync, konflikty, bezpieczeństwo ścieżek, usuwanie oraz testy; bez publish i bez osobnej selekcji pluginów.
- Suggested diagnosis or solution: rozszerzyć discovery, modele stanu i istniejącą fazę zarządzanych plików, zamiast tworzyć niezależny mechanizm kopiowania.
- Claims verified in evidence: SubagentRegistry i SubagentDiscovery są ograniczone do wariantów agent(s) i Markdownów; BackendSourceService przekazuje discovery do sync; SubagentSyncPhase korzysta z ManagedFileSynchronizer; manifest i lock przechowują per-plikowe sourcePath, targetPath i hash; istnieją testy discovery, locked sync, konfliktów i integracji.
- Claims corrected or still unverified: niepotwierdzone pozostają wyłącznie końcowe nazwy nowych symboli oraz dokładny kształt rozszerzenia istniejących typów; nie zmienia to ownershipu ani zakresu planu.

## Scope

- Included: rekurencyjne wykrywanie zwykłych plików w źródłowym .opencode/plugins, mapowanie ich do identycznych ścieżek docelowych, zapis i walidacja locka, locked sync, update, pruning, konflikty, path safety, rollback, testy, dokumentacja i statystyki synchronizacji.
- Excluded: publish pluginów, selekcja pojedynczych pluginów, instalowanie zależności npm pluginów, zmiana formatu pluginów OpenCode, migracja istniejących skillów lub agentów.
- Public contract: istniejące subagents: [opencode] pozostaje bramką synchronizacji OpenCode; pluginy są w pierwszej wersji synchronizowane jako pełny katalog bez nowego pola selekcji.
- Compatibility: istniejące manifesty i locki bez pluginów zachowują dotychczasowe zachowanie; lock bez wpisów pluginów wymaga --update dopiero wtedy, gdy źródło faktycznie dostarcza pluginy.

## Direction, simplicity and consistency

- Existing mechanism reused: SourceWorkspace, BackendSourceService, ManagedFileSynchronizer, ManagedFileJournal, SubagentSyncPhase, lock normalizers and SyncLockValidator.
- Simpler alternative considered: bezpośrednie kopiowanie katalogu w SyncService; odrzucone, ponieważ omijałoby baseline locka, ownership, konflikty, pruning i rollback.
- Why the selected approach is minimal: pluginy zostają zwykłymi deklaracjami managed files z targetPath równym ścieżce względnej pod .opencode/plugins; nie powstaje drugi silnik synchronizacji ani nowa opcja publish.
- Duplicate or parallel responsibilities: nie tworzyć osobnego niezależnego PluginSyncPhase; discovery może być osobnym komponentem, ale planowanie i aplikowanie pozostają wspólne z istniejącą fazą OpenCode.
- Cross-WP consistency and ownership: WP1 jest właścicielem kontraktu i discovery, WP2 integracji managed files oraz locka, WP3 testów zachowania, a WP4 dokumentacji i raportowania; kolejność jest obowiązkowa.

## Source coverage

- Source point 1 — synchronizacja katalogu .opencode/plugins: WP1, WP2, WP3.
- Source point 2 — obsługa analogiczna do .opencode/agents: WP1, WP2, WP3.
- Source point 3 — rekurencyjne kopiowanie plików: WP1, WP2, WP3.
- Source point 4 — reuse managed-file pipeline: WP2.
- Source point 5 — lock i locked sync: WP2, WP3.
- Source point 6 — konflikty, bezpieczeństwo ścieżek, usuwanie i testy: WP1, WP2, WP3.
- Source point 7 — bez publish i osobnej selekcji pluginów: WP1, WP4.
- Source point 8 -> excluded: implementacja zostaje do osobnego wykonania planu.

## Work packages

### WP1 — Kontrakt i bezpieczne discovery pluginów

- Source: source points 1, 2, 3, 6.
- Goal: rozszerzyć discovery o pełny katalog .opencode/plugins i zwracać deterministyczne deklaracje plików z docelowymi ścieżkami.
- Scope: dodać model plugin definition; podłączyć discovery do BackendSourceService, SyncDiscovery i DiscoveredSource; przechodzić rekurencyjnie po katalogu; uwzględnić tylko zwykłe pliki; odrzucać symlinki i ścieżki wychodzące poza katalog źródłowy; zachować względną ścieżkę oraz tryb wykonywalności, jeśli obecny model to wspiera.
- Out of scope: selekcja pluginów, wykonywanie kodu pluginów, instalacja zależności, publish.
- Confirmed paths: src/core/source/BackendSourceService.ts; src/core/source/SubagentDiscovery.ts; src/core/agents/SubagentRegistry.ts; src/core/types/discovery.ts; src/core/types/manifest.ts; src/core/source/SourceWorkspace.ts; src/core/sync/SyncDiscovery.ts.
- Candidate paths: src/core/source/PluginDiscovery.ts; src/core/source/OpenCodePluginDiscovery.ts; src/core/source/SharedFileCollector.ts.
- Discovery required: none; przed implementacją potwierdzić jedynie ostateczną nazwę nowego discovery zgodnie z konwencją istniejących klas.
- Estimated size: medium
- Acceptance criteria: źródłowy .opencode/plugins z plikami w podkatalogach produkuje komplet deklaracji z identycznymi ścieżkami względnymi; brak katalogu nie generuje zmian; symlink lub ścieżka traversal kończy discovery stabilnym błędem bez dopuszczenia pliku do synchronizacji.
- Verification: trwałe testy discovery dla pustego/brakującego katalogu, plików zagnieżdżonych i niejednorodnych rozszerzeń oraz symlinków; jednorazowy check uruchomienia discovery na lokalnym fixture Git.

### WP2 — Integracja managed files, locka i locked sync

- Source: source points 1, 2, 4, 5, 6, 7.
- Goal: synchronizować plugin declarations przez istniejący pipeline z pełnym wsparciem lock/update/pruning/conflict/rollback.
- Scope: rozszerzyć SubagentManagedFileAdapter i SubagentSyncPhase w miejscu, bez tworzenia osobnego PluginSyncPhase; włączyć pluginy do jednego managed-file apply path; rozszerzyć LockSourceMeta, normalizery, mapery i SyncLockValidator o osobne plugin entries; przekazać plugin definitions przez SyncDiscovery; zachować targetPath, hash, ownership i źródłowy commit; objąć planem lokalne konflikty, unmanaged files, stale managed files oraz rollback w granicy tej fazy.
- Out of scope: niezależna faza synchronizacji omijająca istniejący pipeline, zmiana semantyki skilli lub agentów, publish.
- Confirmed paths: src/core/subagents/SubagentManagedFileAdapter.ts; src/core/sync/SubagentSyncPhase.ts; src/core/sync/ManagedFileSynchronizer.ts; src/core/sync/ManagedFileJournal.ts; src/core/sync/SyncDiscovery.ts; src/core/sync/SyncService.ts; src/core/sync/SyncAdapter.ts; src/core/sync/SyncLockValidator.ts; src/core/manifest/ManifestNormalizer.ts; src/core/manifest/LockNormalizer.ts; src/core/manifest/lockMappers.ts; src/core/types/manifest.ts; src/core/types/sync.ts.
- Candidate paths: none
- Discovery required: none; implementacja ma utrzymać jeden istniejący apply path, a decyzja nie może prowadzić do równoległej fazy pluginów.
- Estimated size: medium
- Acceptance criteria: --update zapisuje plugin entries w locku; locked sync korzysta z zapisanych commitów i hashy; aktualizacja upstreamu bez --update nie modyfikuje celu; --update usuwa wyłącznie wcześniej zarządzane stale pluginy; plik unmanaged, konflikt ownershipu, symlink lub traversal nie powoduje częściowego zapisu; preflight i błąd planowania przed apply pozostawiają target i lock bez zmian; journal przywraca zapisy i usunięcia wykonane przez OpenCode managed-file phase; istniejące agenty i skille zachowują dotychczasowy wynik.
- Verification: trwałe testy integracyjne dla update-versus-locked, pruning, konfliktu, unmanaged file, symlink/traversal i rollbacku; jednorazowy check diffu locka oraz planu zapisów dla źródła z pluginem i agentem.

### WP3 — Trwała regresja i testy kontraktu

- Source: source points 1, 2, 3, 5, 6.
- Goal: zabezpieczyć docelowy kontrakt pluginów na poziomie unit, sync i integracji Git.
- Scope: rozszerzyć istniejące testy właścicieli discovery, managed synchronizer, lock validator i integracji; użyć tymczasowych lokalnych repozytoriów Git; sprawdzić mieszany przypadek agents plus plugins oraz zachowanie źródła bez pluginów.
- Out of scope: testowanie runtime OpenCode, wykonania pluginów i sieciowych repozytoriów.
- Confirmed paths: tests/SubagentDiscovery.test.ts; tests/SubagentSyncPhase.test.ts; tests/SubagentSyncIntegration.test.ts; tests/ManagedFileSynchronizer.test.ts; tests/SyncLockValidator.test.ts; tests/ManifestNormalizer.test.ts; tests/fixtures/subagentSource.ts; tests/cliRenderers.test.ts; tests/SyncWorkflow.test.ts.
- Candidate paths: tests/PluginDiscovery.test.ts; tests/OpenCodePluginSyncIntegration.test.ts; tests/fixtures/pluginSource.ts.
- Discovery required: none; nowe testy mają rozszerzać istniejące testy właścicieli, gdy pokrywają tę samą regułę, zamiast duplikować scenariusze wyłącznie z powodu nowej nazwy artefaktu.
- Estimated size: medium
- Acceptance criteria: testy failują dla braku discovery pluginów, nieaktualnego locka, niekontrolowanego usunięcia lub częściowego zapisu; testy potwierdzają brak regresji dla agentów i skilli; wszystkie scenariusze bezpieczeństwa i locked mode są deterministyczne.
- Verification: trwałe testy Vitest zgodne z lokalną strategią; jednorazowo npm test z selekcją testów zmian oraz npm run typecheck.

### WP4 — Publiczne zachowanie, dokumentacja i finalna walidacja

- Source: source points 1, 2, 5, 7.
- Goal: opisać nowy kontrakt i zachować spójne wyniki API/CLI bez rozszerzania publish.
- Scope: uzupełnić README.md i docs/modules/core/README.md o źródło, target, bramkę opencode, lock/update, pruning i ograniczenie sync-only; dodać opcjonalne statystyki pluginów do istniejącego wyniku/eventu OpenCode bez zmiany istniejących pól; renderer ma rozróżniać pluginy od agentów; sprawdzić kompatybilność createManager oraz istniejących komunikatów.
- Out of scope: nowa składnia selekcji pluginów, zmiany wersji pakietu, release, publish.
- Confirmed paths: README.md; docs/modules/core/README.md; src/cli/renderers/syncRenderer.ts; src/core/types/events.ts; src/core/types/sync.ts; src/core/manager/RuntimeFactory.ts.
- Candidate paths: none
- Discovery required: none; aktualizacja wyniku i renderera ma używać istniejących eventów i zachować dotychczasowy output, gdy pluginów nie ma.
- Estimated size: small
- Acceptance criteria: dokumentacja opisuje rzeczywisty kontrakt bez obietnicy publish; przy obecności pluginów CLI/API pokazuje je jako osobną kategorię, a bez pluginów zachowuje dotychczasowy output; istniejące wyjście dla agentów i skilli pozostaje kompatybilne; build i typecheck przechodzą.
- Verification: trwała aktualizacja dokumentacji oraz testów cliRenderers/SyncWorkflow dla opcjonalnego plugin summary; jednorazowe npm run lint:js, npm run build oraz npm pack --dry-run.

## Order

- Execution order: WP1, następnie WP2, następnie WP3, na końcu WP4.
- Dependency rationale: WP2 wymaga ustalonego kształtu discovery i deklaracji; WP3 testuje finalny kontrakt sync/lock; WP4 dokumentuje dopiero zachowanie potwierdzone przez kod i testy.
- Parallelism: none; granice ownershipu i wspólny lock wymagają sekwencyjnego ustalenia kontraktu.

## Decisions and open questions

- Decision D1: plugins są osobnym typem zarządzanych wpisów, ale korzystają z istniejącego OpenCode gate subagents: [opencode] i nie dostają osobnej selekcji w v1.
- Decision D2: target pluginu jest wyznaczany przez tę samą ścieżkę względną pod .opencode/plugins; nie ma automatycznego mapowania do agent(s).
- Decision D3: pluginy są sync-only; publish pozostaje bez zmian.
- Decision D4: lock otrzymuje osobne plugin entries, aby pruning i ownership nie mieszały się z subagent entries.
- Open questions: brak; nazwy nowych symboli są szczegółem implementacyjnym i nie zmieniają ustalonego zakresu.
- Decision D5: nie zwiększać schemaVersion manifestu ani locka w v1; brakujące opcjonalne plugin entries normalizować jako pusty zbiór, a pierwszy zapis pluginów wykonywać przez --update.

## Risks and discovery debt

- R1: rozszerzenie wspólnego locka musi zachować kompatybilność starych locków; implementacja ma traktować brak plugin entries jako pusty zbiór i wymagać --update tylko przy rzeczywistej różnicy.
- R2: katalog pluginów może zawierać pliki pomocnicze o różnych rozszerzeniach; discovery nie może odziedziczyć ograniczenia Markdownów z SubagentDiscovery.
- R3: plugin path ownership może kolidować z unmanaged files lub innym źródłem; preflight musi wykonać tę samą walidację co dla innych managed files przed zapisem.
- R4: rozszerzenie opcjonalnych statystyk CLI może zmienić publiczny kształt wyniku; nowe pola muszą być opcjonalne, stare pola zachować dotychczasową semantykę, a test bez pluginów potwierdzić brak zmiany outputu.
- Discovery debt: potwierdzenie dokładnego miejsca nowego discovery i adaptera po przejrzeniu referencji; nie może zmienić WP ani kryteriów.
- Release impact: brak zmiany publish i brak nowej zależności; wersjonowanie pakietu pozostaje poza tym planem.
- R5: SyncService stosuje fazy add, shared i OpenCode kolejno; nie wolno obiecywać globalnego rollbacku bez osobnej zmiany transakcyjności, która pozostaje poza tym planem.

## Acceptance and verification

- Functional acceptance: source .opencode/plugins is copied recursively to target .opencode/plugins with stable relative paths, regular-file filtering and safe failure on symlinks/traversal.
- Lock acceptance: update records plugin source/target/hash state; locked sync is reproducible and detects upstream drift without silently applying it.
- Cleanup acceptance: stale managed plugin files are removed only from the prior plugin ownership set; unmanaged files remain untouched.
- Atomicity acceptance: preflight i walidacja planu nie zapisują targetu ani locka; journal przywraca zapisy i usunięcia z OpenCode managed-file phase; plan nie rozszerza istniejącej granicy transakcyjnej SyncService na wcześniejsze fazy skills/shared.
- Regression acceptance: existing skills, agents, public manager behavior and sync output remain compatible.
- Permanent tests: retain only tests for the target contract—recursive discovery, lock/update-versus-locked, pruning, conflict/safety and rollback; update existing owner tests instead of duplicating equivalent agent scenarios.
- One-off checks: run the focused Vitest selection, typecheck, lint, build and package dry-run after implementation; these checks are evidence of execution, not additional permanent requirements.

## Execution environment

- Default model: openai/gpt-5.6-luna
- Default reasoning: max
- WP overrides: none

## Execution

- [x] WP1 — 2026-09-17 — PluginDiscovery tests 4/4, focused BackendSourceService/SyncDiscovery tests 13/13, npm run typecheck and scoped npm run lint:js passed
- [x] WP2 — 2026-09-17 — Plugin managed-file/lock integration verified by 43 focused tests, npm run typecheck, scoped npm run lint:js and git diff --check
- [x] WP3 — 2026-09-17 — focused Vitest selection passed: 12 files/56 tests; npm run typecheck and scoped npm run lint:js passed
- [x] WP4 — 2026-09-17 — npm run lint:js; focused Vitest selection passed: 14 files/72 tests; npm run typecheck; npm run test:typecheck; npm run build; npm pack --dry-run; git diff --check
