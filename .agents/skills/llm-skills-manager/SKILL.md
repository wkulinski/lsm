---
name: llm-skills-manager
description: >-
  Lekki wrapper operatorski dla pakietu `@wkulinski/lsm`: sync i publish przez
  CLI lub API biblioteki, w tym dry-run, selektywne dodawanie nowych skilli oraz
  kontrolowane usuwanie.
shared_files: []
---

# $llm-skills-manager

## Reguły rozwiązywania ścieżek
- Stosuj globalny kontrakt ścieżek z root `AGENTS.md`.

## Priorytet zasad (globalny kontrakt)
1. Instrukcje systemowe/developerskie środowiska
2. `./AGENTS.md` i dokumenty z `docs_map`
3. Bieżący `SKILL.md`
4. Pliki wskazane w `shared_files`

## Cel
Uprościć obsługę `@wkulinski/lsm` bez duplikowania logiki.
Ten skill nie implementuje reguł synchronizacji ani publish samodzielnie, tylko
uruchamia CLI albo deleguje do publicznego API biblioteki.

## Kiedy użyć
- Gdy chcesz zainstalować lokalne skille z wersji zapisanych w locku (`sync`).
- Gdy chcesz odświeżyć lokalne skille z upstream (`sync --update`).
- Gdy chcesz wypchnąć lokalne zmiany skilli do source (`publish`).
- Gdy chcesz najpierw zobaczyć plan zmian (`publish --dry-run`).
- Gdy chcesz dodać, zmienić albo usunąć repozytorium lub wybrane skille w `skills.json`.

## Model konfiguracji

`skills.json` jest źródłem prawdy dla oczekiwanego stanu projektu:

```json
{
  "agents": ["codex", "opencode"],
  "sources": [
    {
      "source": "owner/repo",
      "skills": ["Code Review", "Testing"],
      "publish": {
        "branchPrefix": "skills-sync",
        "createPr": true
      }
    }
  ]
}
```

- `agents` określa agentów, do których instalowane są skille.
- `sources` określa repozytoria źródłowe.
- `source` może być skrótem `owner/repo`, skrótem z branchem i podkatalogiem
  `owner/repo@branch/path/to/skills` albo URL-em GitHub `/tree/<branch>/<path>`.
- `skills` zawiera nazwy wybranych skilli albo aliasy nazw katalogów.
- Brak pola `skills`, `null` albo pusta lista oznacza wszystkie dostępne publiczne
  skille z danego źródła.
- Jeśli wybrana nazwa nie istnieje w źródle, sync zgłosi ją jako brakującą i nie
  zapisze nowego locka.
- `publish.branchPrefix` ustawia prefiks brancha dla publish.
- `publish.createPr` steruje domyślnym tworzeniem pull requesta.

Każde źródło jest skanowane osobno. Unikaj zarządzania tym samym skillem z kilku
źródeł, ponieważ kolizje nazw lub ścieżek mogą zatrzymać sync.

`skills.lock.json` jest plikiem generowanym. Nie edytuj go ręcznie. Zawiera
ostatni poprawnie zsynchronizowany commit, hashe i listę zarządzanych plików.

Zmiany w `skills.json` zapisuj i przeglądaj przed uruchomieniem sync:

```bash
git diff -- skills.json
npx --no-install lsm sync --update
```

`sync` nie obsługuje opcji `--dry-run`; dry-run jest dostępny dla `publish`.
Zwykły `sync` używa commitów i hashy z `skills.lock.json`, nie aktualizuje locka
i wymaga zgodności manifestu z lockiem. Przy pierwszym uruchomieniu lub po
zmianie `skills.json` użyj `--update`.
Sync pokaże plan i zatrzyma się na konfliktach lokalnych; `--force` stosuj tylko
po świadomym sprawdzeniu planu. `--force` nie omija brakującego lub niezgodnego
locka.

## Operacje na `skills.json`

### Dodanie repozytorium

Dodaj nowy obiekt do tablicy `sources`. Nie usuwaj pozostałych źródeł.

Wszystkie skille:

```json
{
  "source": "owner/repo"
}
```

Tylko wybrane skille:

```json
{
  "source": "owner/repo",
  "skills": ["skill-a", "skill-b"]
}
```

Po zmianie uruchom `sync`. Nowe skille zostaną zainstalowane dla agentów z
`agents`, a lock zostanie zaktualizowany.

### Edycja repozytorium

Zmień pole `source`, aby przełączyć repozytorium, branch lub podkatalog:

```json
{
  "source": "owner/repo@develop/.agents/skills",
  "skills": ["skill-a"]
}
```

Zmiana źródła może spowodować usunięcie lokalnych skilli zarządzanych wcześniej
przez stare źródło i instalację skilli z nowego źródła. Przed sync sprawdź plan
i lokalne zmiany.

Możesz też zmienić `skills`, aby przejść między wszystkimi skillami a listą
wybranych. Nazwy są porównywane bez względu na wielkość liter, ale po zmianie
warto zachować czytelne nazwy z frontmatteru.

### Usunięcie wybranego skilla

Usuń jego nazwę z `skills`:

```json
{
  "source": "owner/repo",
  "skills": ["skill-a"]
}
```

Po `sync` skill usunięty z deklarowanej listy zostanie usunięty lokalnie, jeśli
był zarządzany przez to źródło. Jeżeli lokalny plik został zmodyfikowany, LSM
zatrzyma się na guardzie konfliktów. Nie używaj wtedy automatycznie `--force`.

### Usunięcie repozytorium

Usuń cały obiekt źródła z tablicy `sources`, a następnie uruchom sync. Wszystkie
skille wcześniej zarządzane wyłącznie przez to źródło mogą zostać usunięte
lokalnie. Najpierw wykonaj:

```bash
git diff -- skills.json
npx --no-install lsm sync
```

Usunięcie repozytorium z `skills.json` nie usuwa niczego z upstream. Publikacja
zmian upstream wymaga osobnej komendy `publish` i jawnych flag usuwania.

### Dodanie nowego skilla do repozytorium

Dodaj nazwę do `skills` i uruchom sync:

```json
{
  "source": "owner/repo",
  "skills": ["existing-skill", "new-skill"]
}
```

Jeżeli skill istnieje upstream, ale nie ma go jeszcze w locku, sync go zainstaluje.
Jeżeli skill jest nowy lokalnie i ma zostać opublikowany upstream, użyj osobno
`publish --new-skill <name>` po sprawdzeniu dry-run.

### Zmiana agentów

Edytuj tablicę `agents`, aby zmienić miejsca instalacji:

```json
{
  "agents": ["codex", "claude-code"],
  "sources": [
    { "source": "owner/repo", "skills": ["skill-a"] }
  ]
}
```

Lista skilli jest wspólna dla wszystkich agentów. LSM nie obsługuje obecnie
innej listy skilli dla każdego agenta w jednym manifeście.

## Komendy
Przed użyciem w projekcie docelowym upewnij się, że pakiet jest zainstalowany:

```bash
npm install @wkulinski/lsm
```

### CLI

Opcje `sync`:

- `--manifest <path>` używa alternatywnego pliku manifestu.
- `--update` rozwiązuje aktualny upstream i zapisuje nowy lock.
- `--force` kontynuuje mimo lokalnych konfliktów nadpisania/usunięcia.

1. Synchronizacja z upstream:
   - `npx --no-install lsm sync`
   - `npx --no-install lsm sync --update` (pierwsza synchronizacja lub aktualizacja upstreamu)
   - `npx --no-install lsm sync --force` (gdy chcesz pominąć guard lokalnych zmian)
2. Dry-run publish (bez commita i pusha):
   - `npx --no-install lsm publish --dry-run --source <source>`
3. Publish z nowymi skillami (tylko wskazane nazwy, flaga wielokrotna):
   - `npx --no-install lsm publish --source <source> --new-skill <skillA> --new-skill <skillB>`
4. Publish z usunięciem skilla upstream (jawne i potwierdzone):
   - `npx --no-install lsm publish --dry-run --source <source> --remove-skill <skillA>`
   - `npx --no-install lsm publish --source <source> --remove-skill <skillA> --confirm-deletes`
5. Publish bez automatycznego tworzenia PR:
   - `npx --no-install lsm publish --source <source> --no-pr`

Opcje `publish`:

- `--manifest <path>` używa alternatywnego manifestu.
- `--source <source>` wybiera źródło, gdy manifest zawiera więcej niż jedno.
- `--new-skill <name>` można powtarzać dla nowych skilli.
- `--remove-skill <name>` można powtarzać dla usuwanych skilli.
- `--dry-run` pokazuje plan bez commita i pusha.
- `--confirm-deletes` potwierdza usunięcia podczas rzeczywistego publish.
- `--message <message>` ustawia treść commita.
- `--branch <name>` ustawia nazwę brancha publish.
- `--no-pr` wyłącza tworzenie pull requesta.
- `--title <title>` i `--body <body>` ustawiają dane pull requesta.

`--source` w CLI jest opcją `publish`. `sync` korzysta ze źródeł i list skilli
zapisanych w `skills.json`.

### API biblioteki

Do użycia programowego importuj `createManager` z `@wkulinski/lsm`:

```ts
import { createManager } from '@wkulinski/lsm';

const manager = createManager({
  cwd: process.cwd(),
  manifestPath: './skills.json',
  lockPath: './skills.lock.json',
});

const syncResult = await manager.runSync({ update: true });
const publishResult = await manager.runPublish({
  source: 'owner/repo',
  dryRun: true,
});
```

Przekazuj `report` w opcjach managera albo konkretnej operacji, jeśli aplikacja
potrzebuje własnego renderowania eventów. Wynik operacji zawsze sprawdzaj po
polu `status` i `exitCode`.

`runPublish()` przyjmuje odpowiedniki opcji CLI: `source`, `newSkills`,
`removeSkills`, `dryRun`, `confirmDeletes`, `message`, `branch`, `createPr`,
`title`, `body` oraz `report`.

## Notatki
- `publish` działa wyłącznie na tymczasowym klonie source i tworzy branch od commita z locka (`resolved.resolvedCommit`).
- `--new-skill` publikuje tylko wskazane skille i tylko wtedy, gdy nie są już zarządzane przez inne source w locku.
- Brakujący lokalnie managed skill jest domyślnie tylko ostrzeżeniem (bez kasowania upstream).
- Kasowanie upstream wymaga jawnej deklaracji `--remove-skill <name>`.
- Jeśli plan publish zawiera kasowanie (skill lub shared file), realny publish wymaga `--confirm-deletes` (w dry-run nie jest wymagane).
- `sync` i `publish` uwzględniają pliki z `shared_files` deklarowane we frontmatterach skilli.
- Konflikty rebase są rozwiązywane na etapie PR, nie przez ten skill.
- Jeśli w `skills.json` jest jeden source, `--source` można pominąć.
- CLI wymaga Node.js 20 lub nowszego.
