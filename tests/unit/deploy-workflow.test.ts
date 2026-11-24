import { readdirSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { describe, expect, it } from "vitest";

// No test can run a deploy, so the lines a restore point rests on are pinned as text.
const workflow = readFileSync(".github/workflows/fly-deploy.yml", "utf8");
const RELEASE =
  'flyctl deploy --image "registry.fly.io/innospace-bookings:sha-${GITHUB_SHA}"';
const decide = workflow.slice(
  workflow.indexOf("- name: Can this release change what is on the volume?"),
  workflow.indexOf("- name: Back up the database"),
);
const backup = workflow.slice(
  workflow.indexOf("- name: Back up the database"),
  workflow.indexOf(RELEASE),
);
const script = readFileSync(".github/scripts/backup-db.sh", "utf8");
const nightly = readFileSync(".github/workflows/backup.yml", "utf8");
const touches = /TOUCHES: (.+)\n/.exec(decide)?.[1].split(" ") ?? [];
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
  const gate = section("changes", "check");
  const check = section("check", "build");
  const build = section("build", "deploy");
  const deploy = section("deploy", "release");
  const list = (name: string) =>
    new RegExp(`${name}: (.+)\\n`).exec(gate)?.[1].split(" ") ?? [];
  const unchecked = list("UNCHECKED");
  const unbuilt = [...unchecked, ...list("UNBUILT")];
  // The step's rule: a job runs when a change sits outside the paths that job does not read.
  const runs = (...changed: string[]) => ({
    checks: changed.some((file) => !under(unchecked, file)),
    image: changed.some((file) => !under(unbuilt, file)),
  });
  const lines = (file: string) =>
    readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line && !line.startsWith("#"));

  it("runs nothing for a change that no check reads and no image holds", () => {
    expect(unchecked).toEqual([
      "README.md",
      "LICENSE",
      "Makefile",
      ".env.example",
      "docs",
    ]);
    expect(runs("README.md", "LICENSE", "docs/img/login.png")).toEqual({
      checks: false,
      image: false,
    });
  });

  it("runs the checks alone for a change to the tests, the CI or the tooling", () => {
    for (const file of [
      "tests/unit/deploy-workflow.test.ts",
      ".github/workflows/fly-deploy.yml",
      ".github/scripts/backup-db.sh",
      "vitest.config.ts",
      ".prettierignore",
      "docker-compose.yml",
    ])
      expect(runs(file, "README.md"), file).toEqual({
        checks: true,
        image: false,
      });
  });

  // A path on neither list builds, so a new file can never be left out of a release by default.
  it("builds and releases for anything the image holds or is made from", () => {
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
        image: true,
      });
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

  it("measures the change from the live commit, with git's own exclude", () => {
    expect(gate).toContain("fetch-depth: 0");
    expect(gate).toContain('flyctl image show -a "$APP" --json');
    expect(gate).toContain('specs+=(":(exclude)$path")');
    expect(gate).toContain('! git diff --quiet "$live" HEAD -- "${specs[@]}"');
    expect(gate).toContain('beyond "$UNCHECKED" || checks=false');
    expect(gate).toContain('beyond "$UNCHECKED $UNBUILT" || image=false');
  });

  it("runs everything on a manual run, an image no commit names or a missing answer", () => {
    expect(gate).toMatch(/\) \|\| live=\n/);
    expect(gate).toMatch(
      /checks=true image=true\n(\s+#[^\n]*\n)*\s+if \[ "\$GITHUB_EVENT_NAME" = push \] && \[ -n "\$live" \]; then\n/,
    );
    expect(check).toContain("if: needs.changes.outputs.checks != 'false'");
    expect(build).toContain("if: needs.changes.outputs.image != 'false'");
  });

  // A job waits for a skipped one only when told to, and nothing here tells it.
  it("releases nothing when the checks or the build were skipped or failed", () => {
    expect(check).toContain("needs: changes");
    expect(build).toContain("needs: changes");
    expect(deploy).toContain("needs: [check, build]");
    expect(workflow).toContain("needs: deploy");
    expect(workflow).not.toMatch(/always\(\)|cancelled\(\)|failure\(\)/);
  });

  it("installs the modules only when the lockfile changed", () => {
    expect(check).toContain("path: node_modules");
    expect(check).toContain(
      "key: modules-${{ runner.os }}-${{ runner.arch }}-node22-${{ hashFiles('package-lock.json') }}",
    );
    expect(check).toMatch(
      /if: steps\.modules\.outputs\.cache-hit != 'true'\n\s+run: npm ci\n/,
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
  const step = job.slice(
    job.indexOf("- name: Ask Copilot for the description"),
    job.indexOf("- name: Create the tag and the GitHub release"),
  );

  it("is worded by Copilot, which only the release job may ask", () => {
    expect(job).toContain("copilot-requests: write");
    expect(workflow.match(/copilot-requests: write/g)).toHaveLength(1);
    expect(step).toContain("GH_TOKEN: ${{ github.token }}");
    expect(step).toMatch(/COPILOT_CLI: "\d+\.\d+\.\d+"/);
    expect(step).toContain('"@github/copilot@$COPILOT_CLI"');
  });

  // The words must come from what was released, not from what the model can go and find.
  it("hands Copilot the commits since the last release and no tools", () => {
    expect(step).toContain('"repos/$GITHUB_REPOSITORY/releases/latest"');
    expect(step).toContain(
      '"repos/$GITHUB_REPOSITORY/compare/$previous...$GITHUB_SHA"',
    );
    expect(step).toContain("--available-tools=");
    expect(step).toContain("never invent a change");
  });

  it("describes nothing for a release that exists or a commit with nothing new", () => {
    expect(step).toContain('[ -n "$TAG" ] || exit 0');
    expect(step).toMatch(/gh release view "\$TAG"[^\n]+then exit 0; fi/);
    expect(step).toContain(
      `grep -q '^- ' "$RUNNER_TEMP/changes.txt" || exit 0`,
    );
  });

  // The release matters more than its wording, so a Copilot outage must not cost the tag.
  it("never stops the release: a failure leaves GitHub's own notes", () => {
    expect(step).toContain("continue-on-error: true");
    expect(step).toContain("timeout-minutes: 3");
    expect(step).toContain(
      'mv "$RUNNER_TEMP/draft.md" "$RUNNER_TEMP/notes.md"',
    );
    expect(job).toContain('if [ -s "$RUNNER_TEMP/notes.md" ]; then notes=(');
    expect(job).toContain('--generate-notes "${notes[@]}"');
  });
});
