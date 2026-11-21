import { readdirSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { describe, expect, it } from "vitest";

// No test can run a deploy, so the lines a restore point rests on are pinned as text.
const workflow = readFileSync(".github/workflows/fly-deploy.yml", "utf8");
const RELEASE =
  'flyctl deploy --image "registry.fly.io/innospace-bookings:sha-${GITHUB_SHA}"';
const decide = workflow.slice(
  workflow.indexOf("- name: Can this release change what is on the volume?"),
  workflow.indexOf("- name: Snapshot the data volume"),
);
const snapshot = workflow.slice(
  workflow.indexOf("- name: Snapshot the data volume"),
  workflow.indexOf(RELEASE),
);
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
    expect(snapshot).toContain("if: steps.touches.outputs.needed != 'false'");
  });

  it("is the last thing before the release, and says so when none was needed", () => {
    const release = workflow.indexOf(RELEASE);
    expect(release).toBeGreaterThan(-1);
    expect(workflow.indexOf("- name: Snapshot the data volume")).toBeLessThan(
      release,
    );
    expect(decide).toContain("No restore point for this release");
    expect(snapshot).toContain("Restore point for this release: snapshot");
  });

  it("finds the volume by the name the app mounts", () => {
    expect(snapshot).toContain("VOLUME_NAME: bookings_data");
    expect(readFileSync("fly.toml.example", "utf8")).toContain(
      "source = 'bookings_data'",
    );
  });

  // Fly refuses a second snapshot while the daily one runs, and that one is as good.
  it("takes the one already on its way, and stops the release on any other refusal", () => {
    expect(snapshot).toContain(
      'if ! OUT=$(flyctl volumes snapshots create "$VOLUME" -a "$APP" 2>&1); then',
    );
    expect(snapshot).toContain(
      'grep -q "already scheduled" <<<"$OUT" || exit 1',
    );
    expect(snapshot).toMatch(/not releasing without it\." >&2\n\s+exit 1/);
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
