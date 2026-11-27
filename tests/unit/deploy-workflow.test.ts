import { readdirSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { describe, expect, it } from "vitest";

// No test can run a deploy, so the lines a restore point rests on are pinned as text.
const workflow = readFileSync(".github/workflows/fly-deploy.yml", "utf8");
const RELEASE =
  'flyctl deploy --image "registry.fly.io/innospace-bookings:sha-${GITHUB_SHA}"';
// A step that was a block of shell is a file the workflow runs, read here where the block was.
const step = (name: string) =>
  readFileSync(`.github/scripts/${name}.sh`, "utf8");
const decide = step("touches-volume");
const backup = workflow.slice(
  workflow.indexOf("- name: Back up the database"),
  workflow.indexOf(RELEASE),
);
const script = step("backup-db");
const nightly = readFileSync(".github/workflows/backup.yml", "utf8");
const touches = /^TOUCHES="(.+)"$/m.exec(decide)?.[1].split(" ") ?? [];
// As git reads a pathspec without a star: the file itself, or anything under the folder.
const under = (specs: string[], file: string) =>
  specs.some((spec) => file === spec || file.startsWith(`${spec}/`));
const covered = (file: string) => under(touches, file);
// One job's text, from its key to the next job's.
const section = (name: string, next: string) =>
  workflow.slice(
    workflow.indexOf(`\n  ${name}:\n`),
    workflow.indexOf(`\n  ${next}:\n`),
  );
const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(posix.join(dir, entry.name))
      : [posix.join(dir, entry.name)],
  );

describe("the restore point before a release", () => {
  it("is taken only when what changed since the live commit can touch the volume", () => {
    expect(touches).toEqual([
      "src/lib/db.ts",
      "Dockerfile",
      "docker-entrypoint.sh",
      "fly.toml.example",
    ]);
    expect(decide).toContain('flyctl image show -a "$APP" --json');
    expect(decide).toContain('git diff --quiet "$live" HEAD -- $TOUCHES; then');
    expect(section("deploy", "release")).toContain("fetch-depth: 0");
    expect(section("deploy", "release")).toMatch(
      /id: touches\n[^]*?run: bash \.github\/scripts\/touches-volume\.sh\n/,
    );
  });

  // A module opening the database from somewhere else would change data unseen.
  it("covers every module that opens the database", () => {
    const opens = sources("src").filter(
      (file) =>
        /\.(ts|tsx|mjs)$/.test(file) &&
        /from "better-sqlite3"/.test(readFileSync(file, "utf8")),
    );
    expect(opens.length).toBeGreaterThan(0);
    expect(opens.filter((file) => !covered(file))).toEqual([]);
  });

  it("counts a page, a test or the notes as nothing that touches the volume", () => {
    for (const file of [
      "src/app/page.tsx",
      "tests/unit/deploy-workflow.test.ts",
      "README.md",
      ".github/workflows/fly-deploy.yml",
    ])
      expect(covered(file), file).toBe(false);
  });

  it("reads the live commit off the image's tag, with or without its prefix", () => {
    expect(decide).toContain("sed 's/^sha-//'");
    expect(workflow).toMatch(/--image-label "sha-\$\{GITHUB_SHA\}"/);
  });

  it("is taken anyway on a manual run, an image no commit names or a missing answer", () => {
    expect(decide).toContain(
      'if [ "$GITHUB_EVENT_NAME" = push ] && [ -n "$live" ] && git diff --quiet',
    );
    expect(decide).toMatch(/\) \|\| live=\n/);
    expect(decide).toMatch(
      /else\n[^\n]*\n\s+echo "needed=true" >> "\$GITHUB_OUTPUT"/,
    );
    expect(backup).toContain("if: steps.touches.outputs.needed != 'false'");
  });

  it("is the last thing before the release, and says so when none was needed", () => {
    const release = workflow.indexOf(RELEASE);
    expect(release).toBeGreaterThan(-1);
    expect(workflow.indexOf("- name: Back up the database")).toBeLessThan(
      release,
    );
    expect(decide).toContain("No restore point for this release");
    expect(script).toContain("Restore point: ");
  });

  it("is the nightly backup's own script, named after the commit", () => {
    expect(backup).toContain(
      'bash .github/scripts/backup-db.sh "pre-release-${GITHUB_SHA::7}"',
    );
    for (const name of [
      "FLY_API_TOKEN",
      "CLOUDFLARE_ACCOUNT_ID",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
    ])
      expect(backup).toContain(`${name}: \${{ secrets.${name} }}`);
  });

  // Fly's whole-disk snapshots were replaced by the gzip in R2, so nothing here may ask for one.
  it("takes no Fly snapshot, and stops the release when the backup fails", () => {
    expect(workflow).not.toContain("volumes snapshots");
    expect(script).toMatch(/^set -euo pipefail$/m);
  });
});

describe("what a push runs", () => {
  const check = section("check", "deploy");
  const deploy = section("deploy", "release");
  const since = step("changed-since-green");
  const list = (name: string) =>
    new RegExp(`^${name}="(.+)"$`, "m").exec(since)?.[1].split(" ") ?? [];
  const unchecked = list("UNCHECKED");
  const unlinted = [...unchecked, ...list("UNLINTED")];
  const untyped = [...unlinted, ...list("UNTYPED")];
  const unbuilt = [...unchecked, ...list("UNBUILT")];
  // The script's rule: an answer is true when a change sits outside the paths it leaves out.
  const runs = (...changed: string[]) => ({
    checks: changed.some((file) => !under(unchecked, file)),
    code: changed.some((file) => !under(unlinted, file)),
    app: changed.some((file) => !under(untyped, file)),
    image: changed.some((file) => !under(unbuilt, file)),
  });
  const gate = (command: string) =>
    new RegExp(`- run: ${command}\\n\\s+if: ([^\\n]+)`).exec(check)?.[1];
  const lines = (file: string) =>
    readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line && !line.startsWith("#"));

  // A job bills a whole minute however short, so nothing starts only to decide or to hand on.
  it("is three jobs at most: the checks, the build with its release, and the name", () => {
    const jobs = [...workflow.matchAll(/^ {2}([\w-]+):\n {4}name: /gm)];
    expect(jobs.map((m) => m[1])).toEqual(["check", "deploy", "release"]);
    expect(deploy).toContain("flyctl deploy --build-only --push --remote-only");
    expect(deploy.indexOf("--build-only")).toBeLessThan(
      deploy.indexOf("- name: Can this release change"),
    );
  });

  it("starts no runner for a push of files no check reads and no image holds", () => {
    const ignored =
      /paths-ignore:\n((?: {6}- .+\n)+)/.exec(workflow)?.[1] ?? "";
    expect(
      [...ignored.matchAll(/- (.+)\n/g)].map((m) => m[1].replace("/**", "")),
    ).toEqual(unchecked);
    expect(unchecked).toEqual([
      "README.md",
      "LICENSE",
      "Makefile",
      ".env.example",
      "docs",
    ]);
    expect(runs("README.md", "LICENSE", "docs/img/login.png")).toEqual({
      checks: false,
      code: false,
      app: false,
      image: false,
    });
  });

  it("runs the formatter and the suite alone for a folder that holds no code", () => {
    expect(list("UNLINTED")).toEqual([".github"]);
    for (const file of sources(".github"))
      expect(file).not.toMatch(/\.([cm]?[jt]sx?)$/);
    for (const file of [
      ".github/workflows/fly-deploy.yml",
      ".github/scripts/backup-db.sh",
    ])
      expect(runs(file, "README.md"), file).toEqual({
        checks: true,
        code: false,
        app: false,
        image: false,
      });
  });

  it("skips the app's typecheck for what its tsconfig leaves out", () => {
    const left = list("UNTYPED");
    expect(left).toEqual(["tests", "vitest.config.ts"]);
    expect(JSON.parse(readFileSync("tsconfig.json", "utf8")).exclude).toEqual(
      expect.arrayContaining(left),
    );
    for (const file of ["tests/unit/deploy-workflow.test.ts", ...left.slice(1)])
      expect(runs(file, ".github/workflows/backup.yml"), file).toEqual({
        checks: true,
        code: true,
        app: false,
        image: false,
      });
  });

  it("runs every check and builds nothing for the tooling the image never carries", () => {
    for (const file of [
      "tsconfig.tests.json",
      ".prettierrc.json",
      ".prettierignore",
      "docker-compose.yml",
    ])
      expect(runs(file, "README.md"), file).toEqual({
        checks: true,
        code: true,
        app: true,
        image: false,
      });
  });

  // A path on no list builds, so a new file can never be left out of a release by default.
  it("builds and releases, behind every check, for anything the image holds or is made from", () => {
    for (const file of [
      "src/app/page.tsx",
      "public/logo.svg",
      "package.json",
      "package-lock.json",
      "next.config.mjs",
      "tsconfig.json",
      "eslint.config.mjs",
      "Dockerfile",
      ".dockerignore",
      "docker-entrypoint.sh",
      "fly.toml.example",
      "a-file-nobody-listed.txt",
      ...touches,
    ])
      expect(runs(file, "README.md", "tests/setup.ts"), file).toEqual({
        checks: true,
        code: true,
        app: true,
        image: true,
      });
    // Whatever a check may skip is outside the image, so a release never rests on fewer than all five.
    expect(untyped.filter((path) => !unbuilt.includes(path))).toEqual([]);
  });

  // Otherwise a change to one would alter the image and still be passed over.
  it("counts as outside the image only what .dockerignore keeps out of it", () => {
    const ignored = lines(".dockerignore");
    const kept = (path: string) =>
      ignored.some((line) =>
        line.startsWith("*") ? path.endsWith(line.slice(1)) : line === path,
      );
    expect(unbuilt.length).toBeGreaterThan(unchecked.length);
    expect(unbuilt.filter((path) => !kept(path))).toEqual([]);
  });

  it("counts as unchecked only what Prettier never formats", () => {
    const skipped = lines(".prettierignore");
    const formatted = (file: string) =>
      /\.(md|ya?ml|json|[cm]?[jt]sx?|css|html)$/.test(file) &&
      !skipped.some((line) =>
        line.startsWith("*")
          ? file.endsWith(line.slice(1))
          : under([line], file),
      );
    const files = unchecked.flatMap((path) =>
      path === "docs" ? sources(path) : [path],
    );
    expect(files.length).toBeGreaterThan(unchecked.length);
    expect(files.filter(formatted)).toEqual([]);
  });

  it("runs each check on the answer for the files it reads", () => {
    const needed = (answer: string) =>
      `steps.changed.outputs.${answer} != 'false'`;
    expect(gate("npm run format:check")).toBe(needed("checks"));
    expect(gate("npm run lint")).toBe(needed("code"));
    expect(gate("npm run typecheck")).toBe(needed("app"));
    expect(gate("npm run typecheck:tests")).toBe(needed("code"));
    expect(gate("npm run test")).toBe(needed("checks"));
    // Only a plain "false" skips one, so an answer that went missing still runs it.
    expect(check).not.toContain("== 'true'");
  });

  // The push before may have failed, so only a run that passed proves the files it held.
  it("measures the change from this workflow's last green run, with git's own exclude", () => {
    expect(since).toContain(
      "actions/workflows/fly-deploy.yml/runs?branch=$GITHUB_REF_NAME&event=push&status=success&per_page=1",
    );
    expect(check).toContain("actions: read");
    expect(check).toContain("fetch-depth: 0");
    expect(check).toMatch(
      /id: changed\n\s+env:\n\s+GH_TOKEN: \$\{\{ github\.token \}\}\n\s+run: bash \.github\/scripts\/changed-since-green\.sh\n/,
    );
    expect(check).toContain("image: ${{ steps.changed.outputs.image }}");
    expect(since).toContain('specs+=(":(exclude)$path")');
    expect(since).toContain('! git diff --quiet "$base" HEAD -- "${specs[@]}"');
  });

  it("runs everything on a manual run, without a green run or on a missing answer", () => {
    expect(since).toMatch(
      /^base=\nif \[ "\$GITHUB_EVENT_NAME" = push \]; then\n/m,
    );
    expect(since).toMatch(/\) \|\| base=\n/);
    expect(since).toContain('[ -n "$base" ] || return 0');
    expect(deploy).toContain("if: needs.check.outputs.image != 'false'");
  });

  // Its dependencies are hundreds of packages nobody here wrote, and Fly's token reaches the database.
  it("hands the checks no secret", () => {
    expect(check).not.toContain("secrets.");
    expect(check).not.toContain("flyctl");
    expect(check).toMatch(/permissions:\n\s+contents: read\n\s+actions: read/);
  });

  // A job waits for a skipped one only when told to, and nothing here tells it.
  it("releases nothing when the checks were skipped or failed", () => {
    expect(deploy).toContain("needs: check");
    expect(workflow).toContain("needs: deploy");
    expect(workflow).not.toMatch(/always\(\)|cancelled\(\)|failure\(\)/);
  });

  it("installs the modules only when the lockfile changed", () => {
    expect(check).toContain("path: node_modules");
    expect(check).toContain(
      "key: modules-${{ runner.os }}-${{ runner.arch }}-node22-${{ hashFiles('package-lock.json') }}",
    );
    expect(gate("npm ci")).toBe(
      "steps.changed.outputs.checks != 'false' && steps.modules.outputs.cache-hit != 'true'",
    );
    expect(check).toContain("node-version: 22");
  });
});

describe("the database backup", () => {
  it("copies the file the app writes, on the volume the app mounts", () => {
    expect(script).toContain("/app/data/bookings.db");
    expect(readFileSync("fly.toml.example", "utf8")).toContain(
      "destination = '/app/data'",
    );
  });

  // Most of this database sits in its journal, which a plain file copy would leave behind.
  it("takes one consistent copy while the app serves, never opening the file to write", () => {
    expect(script).toContain("VACUUM INTO ?");
    expect(script).toContain("readonly:true,fileMustExist:true");
  });

  // ssh does not wake a stopped machine, and this one sleeps most of the day.
  it("starts the machine before reaching into it", () => {
    expect(script.indexOf("flyctl machine start")).toBeGreaterThan(-1);
    expect(script.indexOf("flyctl machine start")).toBeLessThan(
      script.indexOf("flyctl ssh console"),
    );
  });

  it("keeps a copy only once it opens and holds the bookings", () => {
    const upload = script.indexOf("--aws-sigv4");
    expect(script).toContain('[ "$check" = ok ] ||');
    expect(script.indexOf("PRAGMA integrity_check")).toBeLessThan(upload);
    expect(script.indexOf("SELECT count(*) FROM bookings")).toBeLessThan(
      upload,
    );
  });

  it("stores it gzipped in the bucket, and fails when the upload is refused", () => {
    expect(script).toContain("gzip -9 /tmp/bookings-backup.db");
    expect(script).toContain(
      "https://$CLOUDFLARE_ACCOUNT_ID.r2.cloudflarestorage.com/$BUCKET/$key",
    );
    expect(script).toContain("curl --fail-with-body");
    expect(script).toContain(
      'key="bookings-$(date -u +%Y-%m-%dT%H%MZ)-$LABEL.db.gz"',
    );
  });

  // An argument is visible to every process on the runner; a file in the job's own folder is not.
  it("hands curl the bucket's keys in a file, never as an argument", () => {
    expect(script).toContain('-K "$work/r2.curl"');
    expect(script).toMatch(/umask 077 && printf [^\n]*> "\$work\/r2\.curl"/);
    expect(script).not.toMatch(/--user|-u "/);
  });

  it("leaves no copy behind in the machine", () => {
    expect(
      script.indexOf('-C "rm -f /tmp/bookings-backup.db.gz"'),
    ).toBeGreaterThan(script.indexOf("flyctl ssh sftp get"));
  });

  // The repository is public and the file holds guests' names, emails and phones.
  it("shows nothing of the file but a count, and uploads it nowhere on GitHub", () => {
    const queries = [...script.matchAll(/sqlite3 "[^"]+" "([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(queries).toEqual([
      "PRAGMA integrity_check",
      "SELECT count(*) FROM bookings",
    ]);
    expect(nightly + workflow).not.toContain("upload-artifact");
  });

  it("runs every night and on demand, one run at a time", () => {
    expect(nightly).toMatch(/schedule:\n\s+- cron: "37 2 \* \* \*"/);
    expect(nightly).toContain("workflow_dispatch:");
    expect(nightly).toContain("concurrency: backup");
    expect(nightly).toContain("bash .github/scripts/backup-db.sh nightly");
    expect(nightly).toContain("timeout-minutes: 10");
  });
});

describe("the release's description", () => {
  const job = workflow.slice(workflow.indexOf("  release:\n"));
  const ask = job.slice(
    job.indexOf("- name: Ask Copilot for the description"),
    job.indexOf("- name: Create the tag and the GitHub release"),
  );
  const notes = step("release-notes");

  it("is worded by Copilot, which only the release job may ask", () => {
    // Its package is fetched fresh at every release, so its job holds no key to Fly or the backups.
    expect(job).not.toMatch(/FLY_API_TOKEN|R2_|CLOUDFLARE/);
    expect(job).toContain("copilot-requests: write");
    expect(workflow.match(/copilot-requests: write/g)).toHaveLength(1);
    expect(ask).toContain("GH_TOKEN: ${{ github.token }}");
    expect(ask).toMatch(/COPILOT_CLI: "\d+\.\d+\.\d+"/);
    expect(ask).toContain("run: bash .github/scripts/release-notes.sh");
    expect(notes).toContain('"@github/copilot@$COPILOT_CLI"');
  });

  // The words must come from what was released, not from what the model can go and find.
  it("hands Copilot the commits since the last release and no tools", () => {
    expect(notes).toContain('"repos/$GITHUB_REPOSITORY/releases/latest"');
    expect(notes).toContain(
      '"repos/$GITHUB_REPOSITORY/compare/$previous...$GITHUB_SHA"',
    );
    expect(notes).toContain("--available-tools=");
    expect(ask).toContain("never invent a change");
  });

  // The checkout puts the scripts in the workspace, where the job's token could be left too.
  it("gives Copilot an empty folder, and leaves no token in the checkout", () => {
    expect(notes.indexOf('cd "$(mktemp -d)"')).toBeGreaterThan(-1);
    expect(notes.indexOf('cd "$(mktemp -d)"')).toBeLessThan(
      notes.indexOf("copilot -p"),
    );
    expect(job).toMatch(
      /- uses: actions\/checkout@v\d+\n\s+with:\n\s+persist-credentials: false\n/,
    );
  });

  it("describes nothing for a release that exists or a commit with nothing new", () => {
    expect(notes).toContain('[ -n "${TAG:-}" ] || exit 0');
    expect(notes).toMatch(/gh release view "\$TAG"[^\n]+then exit 0; fi/);
    expect(notes).toContain(
      `grep -q '^- ' "$RUNNER_TEMP/changes.txt" || exit 0`,
    );
  });

  // The release matters more than its wording, so a Copilot outage must not cost the tag.
  it("never stops the release: a failure leaves GitHub's own notes", () => {
    expect(ask).toContain("continue-on-error: true");
    expect(ask).toContain("timeout-minutes: 3");
    expect(notes).toContain(
      'mv "$RUNNER_TEMP/draft.md" "$RUNNER_TEMP/notes.md"',
    );
    const create = step("release-create");
    expect(job).toContain("run: bash .github/scripts/release-create.sh");
    expect(create).toContain('if [ -s "$RUNNER_TEMP/notes.md" ]; then notes=(');
    expect(create).toContain('--generate-notes ${notes[@]+"${notes[@]}"}');
  });
});

describe("the scripts the workflows run", () => {
  const workflows = sources(".github/workflows").map((file) => ({
    file,
    text: readFileSync(file, "utf8"),
  }));
  const scripts = sources(".github/scripts");
  const ran = (text: string) =>
    [...text.matchAll(/run: bash (\.github\/scripts\/[\w-]+\.sh)/g)].map(
      (m) => m[1],
    );

  // A typed block runs nowhere but on GitHub; a file runs here, under a test.
  it("are files: no workflow types a block of shell of its own", () => {
    for (const { file, text } of workflows)
      expect(text, file).not.toMatch(/run: [|>]/);
  });

  it("all exist, and none is left unrun", () => {
    const named = workflows.flatMap(({ text }) => ran(text));
    expect([...new Set(named)].sort()).toEqual([...scripts].sort());
  });

  // bash <file> gets none of the -e the runner's shell gave a typed block.
  it("each stop at the first failure, unset variable or broken pipe", () => {
    for (const file of scripts)
      expect(readFileSync(file, "utf8"), file).toMatch(/^set -euo pipefail$/m);
  });

  it("are checked out before the first of them runs, in every job", () => {
    for (const { file, text } of workflows) {
      const jobs = text
        .slice(text.indexOf("\njobs:\n"))
        .split(/\n(?= {2}[\w-]+:\n)/)
        .filter((job) => ran(job).length > 0);
      expect(jobs.length, file).toBeGreaterThan(0);
      for (const job of jobs) {
        const checkout = job.indexOf("- uses: actions/checkout@");
        expect(checkout, file).toBeGreaterThan(-1);
        expect(checkout, file).toBeLessThan(job.indexOf("run: bash .github/"));
      }
    }
  });
});
