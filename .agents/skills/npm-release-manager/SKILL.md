---
name: npm-release-manager
description: >-
  Bezpieczne przygotowywanie i wydawanie nowych wersji pakietu npm przez
  GitHub Release oraz Trusted Publishing.
shared_files: []
---

# $npm-release-manager

## Cel

Przygotować i uruchomić release pakietu npm przez workflow GitHub Actions.
Ten skill nie publikuje pakietu bezpośrednio z lokalnego terminala i nie
obsługuje tokenów npm. Publikacja odbywa się przez GitHub Actions po utworzeniu
GitHub Release.

## Tryby pracy

Skill zawsze działa w dwóch osobnych fazach:

1. `prepare`: walidacja repozytorium, testów, wersji i planu release bez push,
   taga i GitHub Release.
2. `release`: wykonanie zmiany wersji, commit, tag, push i utworzenie GitHub
   Release po jednoznacznym potwierdzeniu użytkownika.

Nie przechodź automatycznie z `prepare` do `release`.

## Warunki wstępne

Przed rozpoczęciem sprawdź:

- bieżące repozytorium i package name z `package.json`,
- `git status --short` jest pusty,
- lokalna gałąź jest właściwą gałęzią release, zwykle `master`,
- lokalna gałąź jest zsynchronizowana z odpowiednim remote,
- `gh auth status` działa,
- `gh workflow list` zawiera `Publish Package`,
- `.github/workflows/publish.yml` istnieje na domyślnej gałęzi GitHub,
- package na npm ma skonfigurowany Trusted Publisher dla `publish.yml`.

Jeśli working tree jest brudny, nie używaj `stash`, nie resetuj zmian i nie
kontynuuj bez decyzji użytkownika.

## Faza Prepare

### Walidacja kodu

Uruchom wszystkie kontrole:

```bash
npm ci
npm test
npm run test:coverage
npm run typecheck
npm run test:typecheck
npm run lint:js
npm run build
npm audit --omit=dev
npm pack --dry-run
```

Jeśli dowolna kontrola zakończy się błędem, zatrzymaj release i pokaż błąd.

### Wybór wersji

Poproś użytkownika o wybór `patch`, `minor`, `major` albo konkretnej wersji.
Nie wybieraj poziomu samodzielnie.

Sprawdź proponowaną wersję bez modyfikowania plików:

```bash
npm version patch --dry-run
```

Zastąp `patch` wybraną wartością. Dla konkretnej wersji użyj np.:

```bash
npm version 0.1.1 --dry-run
```

Sprawdź, czy wersja nie istnieje już w registry:

```bash
npm view <package-name>@<version> version
```

404 oznacza, że wersja nie jest jeszcze opublikowana. Każdy inny wynik wymaga
wyboru nowej wersji.

### Plan do potwierdzenia

Pokaż użytkownikowi:

- package name,
- obecną i proponowaną wersję,
- bieżącą gałąź,
- commit, który zostanie utworzony,
- tag, który zostanie utworzony,
- gałąź i repozytorium docelowe,
- komendę utworzenia GitHub Release,
- informację, że publikacja nastąpi automatycznie przez Actions.

Poproś o osobne, jednoznaczne potwierdzenie wykonania release.

## Faza Release

Po potwierdzeniu użytkownika:

1. Zastosuj wersję:

   ```bash
   npm version <patch|minor|major|version>
   ```

   `npm version` aktualizuje `package.json`, lockfile, tworzy commit i tag
   `v<version>`.

2. Sprawdź commit i tag:

   ```bash
   git status --short
   git log -1 --oneline
   git tag --list "v<version>"
   ```

3. Wypchnij commit i tag:

   ```bash
   git push origin <release-branch> --follow-tags
   ```

4. Utwórz opublikowany GitHub Release:

   ```bash
   gh release create v<version> --verify-tag --generate-notes
   ```

5. Monitoruj workflow publikacji:

   ```bash
   gh run list --workflow publish.yml --limit 1
   gh run watch <run-id> --exit-status
   ```

6. Zweryfikuj publikację:

   ```bash
   npm view <package-name>@<version> version
   npm view <package-name> dist-tags --json
   ```

Oczekiwany tag to `latest`, a wersja musi odpowiadać wersji release.

## Zasady bezpieczeństwa

- Nie uruchamiaj lokalnego `npm publish` w ramach tego skilla.
- Nie używaj `--force`, `git reset --hard`, `git push --force` ani `git tag -d`.
- Nie usuwaj opublikowanej wersji npm jako sposobu na rollback.
- Nie umieszczaj tokenów npm w komendach, plikach ani logach.
- Nie twórz release z brudnego working tree.
- Nie publikuj ponownie tej samej wersji. Opublikowana wersja npm jest
  niezmienna.
- Jeśli workflow się nie powiedzie, najpierw zbierz logi:

  ```bash
  gh run view <run-id> --log-failed
  ```

  Nie twórz kolejnego release bez zrozumienia przyczyny błędu.

## Prerelease

Nie twórz prerelease bez jawnego potwierdzenia użytkownika. Aktualny workflow
publikacji pomija GitHub Releases oznaczone jako prerelease.

## Oczekiwany rezultat

Po zakończeniu:

- commit wersji znajduje się na właściwej gałęzi,
- tag `v<version>` istnieje na remote,
- GitHub Release jest opublikowany,
- workflow `publish.yml` zakończył się sukcesem,
- npm registry pokazuje nową wersję i właściwy dist-tag.
