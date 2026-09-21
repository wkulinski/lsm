# `LLM Skills Manager - LSM`

LSM dla Skill'i LLM to jak NPM dla pakietów node. Zarządzaj skillami LLM na podstawie manifestu projektu.

Narzędzie potrafi:
- synchronizować skille z zadeklarowanych źródeł,
- instalować wybrane lub wszystkie skille dla wskazanych agentów,
- synchronizować współdzielone pliki zadeklarowane w `shared_files`,
- synchronizować rekurencyjny katalog pluginów OpenCode,
- usuwać skille, które zniknęły z konfiguracji albo upstreamu,
- publikować lokalne zmiany z powrotem do repozytorium źródłowego.

## Instalacja

Instalacja CLI globalnie:

```bash
npm install --global @wkulinski/lsm
```

Po instalacji dostępna jest komenda `lsm`.

## Konfiguracja

Domyślnie `lsm` pracuje na plikach:
- `skills.json`
- `skills.lock.json`

Jeżeli pliki nie istnieją, narzędzie utworzy ich szablony przy pierwszym uruchomieniu.

### `skills.json` i `skills.lock.json`

- `skills.json` opisuje oczekiwany stan: z jakich źródeł chcesz pobierać skille i dla jakich agentów.
- `skills.lock.json` zapisuje ostatni poprawnie zsynchronizowany stan źródeł, w tym dokładne commity i hashe treści.
- `sync` działa w trybie locked: używa commitów z `skills.lock.json` i nie aktualizuje locka.
- `sync --update` rozwiązuje źródła ponownie, pobiera aktualny upstream i aktualizuje lock po udanej synchronizacji.
- `publish` korzysta z `skills.lock.json`, żeby wiedzieć, względem jakiego stanu upstream przygotować publikację zmian.

Przy pierwszym uruchomieniu oraz po zmianie `skills.json` użyj `sync --update`.

Przykładowy `skills.json`:

```json
{
  "schemaVersion": 2,
  "agents": ["codex"],
  "sources": [
    {
      "source": "https://github.com/example/llm-skills",
      "skills": true
    }
  ]
}
```

### Subagenty OpenCode

Subagenty są osobnym typem artefaktu synchronizowanym przez `sync`. W pierwszej
wersji jedynym obsługiwanym targetem jest `opencode`, a pliki trafiają do
`.opencode/agent/` albo `.opencode/agents/`.

Przykładowy manifest mieszany:

```json
{
  "schemaVersion": 2,
  "agents": ["codex"],
  "subagents": ["opencode"],
  "sources": [
    {
      "source": "https://github.com/example/llm-config",
      "skills": ["code-implement"],
      "subagents": ["reviewer", "researcher"]
    }
  ]
}
```

`agents` wybiera integracje dla skilli, natomiast `subagents` w manifeście
włącza synchronizację plików OpenCode. Na poziomie źródła zarówno `skills`, jak
i `subagents` mają jawną selekcję: brak pola, `false` lub `[]` oznacza brak
elementów, `true` oznacza wszystkie, a niepusta tablica jest selekcją po nazwie.
Manifest tylko z subagentami może użyć `"agents": []`; nie wymaga fazy skilli.

`skills.json` musi mieć `"schemaVersion": 2`. Istniejące manifesty należy
zaktualizować ręcznie: jeśli brak pola wcześniej oznaczał wszystkie elementy,
dodaj jawne `true`.

Źródło może zawierać `.opencode/agent/`, `.opencode/agents/` albo oba katalogi.
Projekt używa istniejącego wariantu, domyślnie `.opencode/agents/`, gdy nie ma
jeszcze żadnego z nich. W trybie `sync --update` wynik autodetekcji jest
zapisywany jako `targetPath` w locku. Zwykły `sync` używa tej ścieżki z locka i
nie przenosi pliku po samej zmianie lokalnego układu katalogów.

Opcjonalny sidecar agenta ma nazwę `<agent>.md.lsm.yaml` i ścisły schemat:

```yaml
schema_version: 1
shared_files:
  - .agents/skills/_shared/references/runtime-quality-procedures.md
```

Sidecar deklaruje wyłącznie pliki `.agents/skills/_shared/`; nie jest kopiowany
do projektu. Brak sidecara oznacza brak dodatkowych plików współdzielonych.
Synchronizacja zapisuje lock v6 z `subagentEntries`, `sharedEntries`, hashami,
bitem wykonywalności i ownershipem. Lock v5 pozostaje obsługiwany dla
manifestów bez subagentów; manifest z subagentami wymaga `sync --update`, które
zapisuje v6 dopiero po udanym przebiegu.

`publish` obsługuje wyłącznie skille. Manifest mieszany publikuje tylko skille,
a manifest zawierający wyłącznie subagenty kończy się komunikatem:
`Publish currently supports skills only; subagents are sync-only.`

### Pluginy OpenCode

Pluginy są synchronizowane razem z subagentami, gdy manifest zawiera top-level
`"subagents": ["opencode"]`. Nie mają osobnej selekcji: dla każdego źródła
lsm synchronizuje wszystkie zwykłe pliki z `.opencode/plugins/` rekurencyjnie,
niezależnie od rozszerzenia, do identycznej ścieżki `.opencode/plugins/` w
projekcie. Brak katalogu pluginów oznacza brak zmian. Symlinki i ścieżki
wychodzące poza katalog źródłowy są odrzucane.

Selekcja source-level `subagents` dotyczy wyłącznie agentów; nie ogranicza
pluginów. `sync --update` zapisuje ich `sourcePath`, `targetPath`, hash,
wykonywalność i commit w opcjonalnych `pluginEntries` locka v6. Zwykły `sync`
korzysta z tego baseline'u i nie przyjmuje zmian upstreamu bez `--update`.
Nieaktualne, wcześniej zarządzane pluginy są usuwane wyłącznie podczas udanego
update; pliki unmanaged pozostają nietknięte.

Pluginy są sync-only. `publish` ich nie publikuje, nie instaluje zależności npm
i nie zmienia formatu pluginów OpenCode. Output `sync` pokazuje ich liczbę w
osobnym bloku `Plugins summary` obok podsumowania subagentów.

## Komendy

### `sync`

Synchronizuje lokalne skille, subagenty OpenCode i pluginy OpenCode z manifestem
oraz źródłami upstream.

Opcje:
- `--manifest <path>`: ścieżka do alternatywnego pliku manifestu
- `--update`: pobierz aktualny upstream i zaktualizuj `skills.lock.json`
- `--force`: kontynuuj mimo wykrytych lokalnych konfliktów zmian

Przykłady:

```bash
node bin/lsm sync
```

```bash
node bin/lsm sync --update
```

```bash
node bin/lsm sync --manifest ./config/skills.json
```

```bash
node bin/lsm sync --force
```

Zwykłe `sync` kończy się błędem, gdy lock jest pusty, niezgodny z manifestem
albo nie zawiera wymaganego commita. `--force` nie omija tej walidacji.

Output `sync` pokazuje osobny blok dla każdego źródła skilli i subagentów.
Blok subagentów zawiera tryb (`all`, `explicit` albo `none`) i liczbę wybranych
plików; dla `none` pokazuje także `Action: skipped`. Po zakończeniu synchronizacji
podsumowanie subagentów zawiera liczbę źródeł, wybranych, zainstalowanych i
usuniętych plików oraz plików współdzielonych. Jeśli wykryto pluginy, osobny blok
pokazuje liczbę wykrytych, zainstalowanych i usuniętych pluginów.

### `publish`

Publikuje lokalne zmiany do repozytorium źródłowego na podstawie danych zapisanych w locku.
Jeżeli plik usunięto z istniejącego zarządzanego skilla lokalnie, `publish` planuje
jego usunięcie w źródle na podstawie listy plików z locka. Takie usunięcia wymagają
`--confirm-deletes`; pliki spoza baseline locka nie są usuwane automatycznie.

Opcje:
- `--manifest <path>`: ścieżka do alternatywnego pliku manifestu
- `--source <source>`: wybór konkretnego źródła z manifestu
- `--new-skill <name>`: oznaczenie skilla jako nowy, można podać wiele razy
- `--remove-skill <name>`: oznaczenie skilla do usunięcia, można podać wiele razy
- `--dry-run`: przygotuj plan zmian bez commita i push
- `--confirm-deletes`: potwierdź planowane usunięcia
- `--message <message>`: własna treść commita
- `--branch <name>`: własna nazwa brancha
- `--no-pr`: nie twórz pull requesta
- `--title <title>`: własny tytuł PR
- `--body <body>`: własny opis PR

Przykłady:

```bash
node bin/lsm publish --dry-run
```

```bash
node bin/lsm publish \
  --source https://github.com/example/llm-skills \
  --new-skill my-skill \
  --message "chore(skills): publish my-skill"
```

```bash
node bin/lsm publish \
  --source https://github.com/example/llm-skills \
  --remove-skill old-skill \
  --confirm-deletes \
  --no-pr
```

### Kolorowanie outputu

W interaktywnym terminalu komunikaty CLI używają kolorów i wyróżnień sekcji.
Kolory są automatycznie wyłączane dla potoków i CI. Można je wyłączyć jawnie
przez `NO_COLOR` albo wymusić przez `FORCE_COLOR`:

```bash
NO_COLOR=1 node bin/lsm sync
FORCE_COLOR=1 node bin/lsm sync
```

## Biblioteka

Pakiet udostępnia też API programistyczne. Główny punkt wejścia to `createManager()`,
który pozwala uruchomić `sync` i `publish` programowo, bez bezpośredniego użycia CLI.

```ts
import { createManager } from '@wkulinski/lsm';

const manager = createManager({ cwd: process.cwd() });
await manager.runSync();
```

## Wydanie

Publikacja kolejnych wersji odbywa się przez GitHub Release. Trusted Publisher
na npm musi wskazywać workflow `.github/workflows/publish.yml`.

```bash
npm version patch
git push --follow-tags
gh release create v0.1.1 --generate-notes
```

Workflow uruchomi testy, coverage, typecheck, lint, build i opublikuje dokładny
tag release na npm.

## Pomoc

Wersja CLI:

```bash
node bin/lsm --version
```

Lista dostępnych komend:

```bash
node bin/lsm --help
```

Pomoc dla konkretnej komendy:

```bash
node bin/lsm sync --help
node bin/lsm publish --help
```
