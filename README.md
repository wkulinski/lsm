# `LLM Skills Manager - LSM`

LSM dla Skill'i LLM to jak NPM dla pakietów node. Zarządzaj skillami LLM na podstawie manifestu projektu.

Narzędzie potrafi:
- synchronizować skille z zadeklarowanych źródeł,
- instalować wybrane lub wszystkie skille dla wskazanych agentów,
- synchronizować współdzielone pliki zadeklarowane w `shared_files`,
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
  "agents": ["codex"],
  "sources": [
    {
      "source": "https://github.com/example/llm-skills"
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
włącza synchronizację plików OpenCode. Na poziomie źródła brak pola lub `null`
oznacza wszystkie znalezione subagenty, `[]` oznacza żadne, a niepusta tablica
jest jawną selekcją po nazwie.
Manifest tylko z subagentami może użyć `"agents": []`; nie wymaga fazy skilli.

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

## Komendy

### `sync`

Synchronizuje stan lokalny z manifestem i źródłami upstream.

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

### `publish`

Publikuje lokalne zmiany do repozytorium źródłowego na podstawie danych zapisanych w locku.

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

Lista dostępnych komend:

```bash
node bin/lsm --help
```

Pomoc dla konkretnej komendy:

```bash
node bin/lsm sync --help
node bin/lsm publish --help
```
