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
const covered = (file: string) =>
  touches.some((spec) => file === spec || file.startsWith(`${spec}/`));
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
    expect(workflow).toContain("fetch-depth: 0");
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
