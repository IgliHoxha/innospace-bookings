import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const root = mkdtempSync(path.join(tmpdir(), "bookings-ci-"));
const bin = path.join(root, "bin");
const SHA = "0123456789abcdef0123456789abcdef01234567";
const UNKNOWN = "f".repeat(40);
let dir = root;
let made = 0;

// One record a call, its arguments kept apart, so a test reads exactly what a tool was handed.
const RECORD = `rec=$(printf '%s\\037' "$(basename "$0")" "$@"); printf '%s\\036' "$rec" >> "$STUB_LOG"`;

/** Each stands in for a tool a script calls, so no test reaches Fly, GitHub or couch-gag. */
const STUBS: Record<string, string> = {
  curl: `for arg; do
  case "$arg" in
    */v1/releases) [ -n "$STUB_REPLY" ] || exit 22; printf '%s' "$STUB_REPLY"; exit 0 ;;
  esac
done`,
  gh: `case "$1 $2" in
  "release view") [ -n "$STUB_EXISTS" ]; exit ;;
  "release create") exit 0 ;;
esac
case "$2" in
  */actions/workflows/*) [ -z "$STUB_GH_DOWN" ] || exit 1; echo "$STUB_GREEN" ;;
  */releases/latest) [ -n "$STUB_PREVIOUS" ] || exit 1; echo "$STUB_PREVIOUS" ;;
  */compare/* | */commits\\?*) printf '%s\\n' "$STUB_CHANGES" ;;
esac`,
  flyctl: `case "$1" in
  image) [ -z "$STUB_FLY_DOWN" ] || exit 1; printf '[{"Tag":"%s"}]' "$STUB_TAG" ;;
esac`,
  npm: "exit 0",
  copilot: `{ pwd; ls -A; } > "$STUB_DIR/copilot.cwd"
printf '%s' "$STUB_DRAFT"`,
};

interface Run {
  status: number | null;
  out: string;
  calls: string[][];
  outputs: Record<string, string>;
  summary: string;
  /** Where the stand-ins of this run kept their notes. */
  io: string;
}

type Env = Record<string, string>;

const text = (file: string): string =>
  existsSync(file) ? readFileSync(file, "utf8") : "";

/** Runs one script as a step would, in `cwd`, with nothing of this process's own env but PATH. */
function run(name: string, env: Env = {}, cwd: string = dir): Run {
  const io = path.join(root, `io-${++made}`);
  mkdirSync(io);
  const done = spawnSync("bash", [path.resolve(`.github/scripts/${name}.sh`)], {
    cwd,
    encoding: "utf8",
    env: {
      NODE_ENV: "test",
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      TMPDIR: dir,
      RUNNER_TEMP: dir,
      GITHUB_OUTPUT: path.join(io, "output"),
      GITHUB_STEP_SUMMARY: path.join(io, "summary"),
      GITHUB_REPOSITORY: "owner/bookings",
      GITHUB_REF_NAME: "main",
      GITHUB_SHA: SHA,
      STUB_LOG: path.join(io, "calls"),
      STUB_DIR: io,
      ...env,
    },
  });
  return {
    status: done.status,
    out: done.stdout + done.stderr,
    calls: text(path.join(io, "calls"))
      .split("\x1e")
      .filter(Boolean)
      .map((record) => record.split("\x1f").slice(0, -1)),
    outputs: Object.fromEntries(
      text(path.join(io, "output"))
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const at = line.indexOf("=");
          return [line.slice(0, at), line.slice(at + 1)];
        }),
    ),
    summary: text(path.join(io, "summary")),
    io,
  };
}

const called = (done: Run, tool: string): string[][] =>
  done.calls.filter(([name]) => name === tool).map((call) => call.slice(1));

function git(repo: string, ...args: string[]): string {
  return execFileSync(
    "git",
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ).trim();
}

function commit(repo: string, files: Record<string, string>): string {
  for (const [file, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    writeFileSync(path.join(repo, file), body);
  }
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "--allow-empty", "-m", "change");
  return git(repo, "rev-parse", "HEAD");
}

/** A repository whose first commit is the one measured from, with one commit per change after it. */
function repoWith(...changes: Record<string, string>[]): {
  repo: string;
  base: string;
} {
  const repo = path.join(root, `repo-${++made}`);
  mkdirSync(repo);
  git(repo, "init", "-q");
  const base = commit(repo, {
    "src/app/page.tsx": "page",
    "src/lib/db.ts": "db",
    "public/logo.svg": "logo",
    "tests/unit/auth.test.ts": "test",
    "vitest.config.ts": "vitest",
    "tsconfig.tests.json": "{}",
    ".github/workflows/fly-deploy.yml": "workflow",
    "docs/img/login.png": "picture",
    "README.md": "notes",
    LICENSE: "terms",
    "package.json": "{}",
    "eslint.config.mjs": "lint",
    Dockerfile: "FROM scratch",
    "docker-entrypoint.sh": "boot",
    "fly.toml.example": "app",
    "docker-compose.yml": "services:",
    Makefile: "check:",
    ".env.example": "TZ=",
    ".prettierignore": "data",
  });
  for (const change of changes) commit(repo, change);
  return { repo, base };
}

/** What Fly names as live, or null when Fly cannot be asked. */
type Tag = string | null;
const live = (tag: Tag, event: string): Env => ({
  FLY_API_TOKEN: "token",
  GITHUB_EVENT_NAME: event,
  STUB_TAG: tag ?? "",
  STUB_FLY_DOWN: tag === null ? "1" : "",
});

beforeAll(() => {
  mkdirSync(bin);
  for (const [name, body] of Object.entries(STUBS)) {
    writeFileSync(path.join(bin, name), `#!/bin/sh\n${RECORD}\n${body}\n`);
    chmodSync(path.join(bin, name), 0o755);
  }
});

beforeEach(() => {
  dir = path.join(root, `run-${++made}`);
  mkdirSync(dir);
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("what a push needs", () => {
  const NOTHING = { checks: "false", code: "false", app: "false" };
  const ALL = { checks: "true", code: "true", app: "true" };
  const EVERYTHING = { ...ALL, image: "true" };
  /** `green` is the head of the last run that passed, or null when GitHub cannot be asked. */
  const since = (repo: string, green: string | null, event = "push") =>
    run(
      "changed-since-green",
      {
        GITHUB_EVENT_NAME: event,
        GH_TOKEN: "token",
        STUB_GREEN: green ?? "",
        STUB_GH_DOWN: green === null ? "1" : "",
      },
      repo,
    );

  it("is nothing for the notes, the licence, the Makefile and the docs", () => {
    const { repo, base } = repoWith({
      "README.md": "other notes",
      LICENSE: "other terms",
      Makefile: "changed",
      ".env.example": "changed",
      "docs/img/login.png": "another picture",
    });
    const done = since(repo, base);
    expect(done.status).toBe(0);
    expect(done.outputs).toEqual({ ...NOTHING, image: "false" });
    expect(done.summary).toBe(
      `Nothing a check reads changed since ${base}: no checks, no build, no release.\n`,
    );
  });

  it("is the formatter and the suite alone for a workflow or one of its scripts", () => {
    const { repo, base } = repoWith({
      ".github/workflows/fly-deploy.yml": "another workflow",
      ".github/scripts/new.sh": "a script",
      "README.md": "other notes",
    });
    const done = since(repo, base);
    expect(done.outputs).toEqual({
      checks: "true",
      code: "false",
      app: "false",
      image: "false",
    });
    expect(done.summary).toBe(
      `Nothing in the image changed since ${base}: the checks run, nothing is built or released.\n`,
    );
  });

  it("leaves out the app's typecheck alone for a test or the tests' config", () => {
    for (const file of ["tests/unit/auth.test.ts", "vitest.config.ts"]) {
      const { repo, base } = repoWith({ [file]: "changed" });
      expect(since(repo, base).outputs, file).toEqual({
        checks: "true",
        code: "true",
        app: "false",
        image: "false",
      });
    }
  });

  it("is every check and no image for the tooling the image never carries", () => {
    for (const file of [
      "tsconfig.tests.json",
      ".prettierignore",
      "docker-compose.yml",
    ]) {
      const { repo, base } = repoWith({ [file]: "changed" });
      const done = since(repo, base);
      expect(done.outputs, file).toEqual({ ...ALL, image: "false" });
      expect(done.summary).toContain("nothing is built or released");
    }
  });

  it("is everything for the app, a dependency, the image's recipe or a file nobody listed", () => {
    for (const file of [
      "src/app/page.tsx",
      "src/lib/db.ts",
      "public/logo.svg",
      "package.json",
      "eslint.config.mjs",
      "Dockerfile",
      "docker-entrypoint.sh",
      "fly.toml.example",
      "a-file-nobody-listed.txt",
    ]) {
      const { repo, base } = repoWith({ [file]: "changed" });
      const done = since(repo, base);
      expect(done.status, file).toBe(0);
      expect(done.outputs, file).toEqual(EVERYTHING);
      expect(done.summary).toBe("");
    }
  });

  it("follows the widest change in a push that mixes them", () => {
    const mixed = repoWith({
      "README.md": "other notes",
      ".github/scripts/new.sh": "a script",
      "tests/unit/auth.test.ts": "another test",
    });
    expect(since(mixed.repo, mixed.base).outputs).toEqual({
      checks: "true",
      code: "true",
      app: "false",
      image: "false",
    });
    const wide = repoWith({
      "README.md": "other notes",
      "tests/unit/auth.test.ts": "another test",
      "src/app/page.tsx": "another page",
    });
    expect(since(wide.repo, wide.base).outputs).toEqual(EVERYTHING);
  });

  it("is measured from the head of this workflow's last green push run", () => {
    const { repo, base } = repoWith({ "README.md": "other notes" });
    const done = since(repo, base);
    expect(done.out).toContain(`Measured from ${base}.`);
    expect(called(done, "gh")).toEqual([
      [
        "api",
        "repos/owner/bookings/actions/workflows/fly-deploy.yml/runs?branch=main&event=push&status=success&per_page=1",
        "--jq",
        ".workflow_runs[0].head_sha // empty",
      ],
    ]);
  });

  // A red or superseded run proved and released nothing, so its change is still owed.
  it("still counts a change from a push before this one that never went green", () => {
    const { repo, base } = repoWith(
      { "src/app/page.tsx": "broken" },
      { "README.md": "notes on top" },
    );
    expect(since(repo, base).outputs).toEqual(EVERYTHING);
  });

  it("is everything on a manual run, asking GitHub nothing", () => {
    const { repo, base } = repoWith({ "README.md": "other notes" });
    const done = since(repo, base, "workflow_dispatch");
    expect(done.outputs).toEqual(EVERYTHING);
    expect(done.summary).toBe("");
    expect(called(done, "gh")).toEqual([]);
  });

  it("is everything when GitHub cannot be asked, knows no green run, or names a commit git lacks", () => {
    const { repo } = repoWith({ "README.md": "other notes" });
    for (const green of [null, "", UNKNOWN]) {
      const done = since(repo, green);
      expect(done.status, String(green)).toBe(0);
      expect(done.outputs, String(green)).toEqual(EVERYTHING);
      expect(done.summary).toBe("");
    }
    expect(since(repo, null).out).toContain(
      "Measured from nothing, so everything runs.",
    );
  });
});

describe("whether a release can touch the volume", () => {
  const since = (repo: string, tag: Tag, event = "push") =>
    run("touches-volume", live(tag, event), repo);

  it("is no for a page, a dependency, a test, the CI or the notes, and says so", () => {
    const { repo, base } = repoWith({
      "src/app/page.tsx": "another page",
      "package.json": '{"name":"x"}',
      "tests/unit/auth.test.ts": "another test",
      ".github/workflows/fly-deploy.yml": "another workflow",
      "README.md": "other notes",
    });
    const done = since(repo, `sha-${base}`);
    expect(done.status).toBe(0);
    expect(done.outputs).toEqual({ needed: "false" });
    expect(done.out).toContain(
      `::notice::Nothing that touches the volume changed since ${base}, so no backup is taken.`,
    );
    expect(done.summary).toBe(
      "No restore point for this release: nothing that touches the volume changed.\n",
    );
    expect(called(done, "flyctl")).toEqual([
      ["image", "show", "-a", "innospace-bookings", "--json"],
    ]);
  });

  it("is yes for the database module, the image's recipe, its boot or the mount", () => {
    for (const file of [
      "src/lib/db.ts",
      "Dockerfile",
      "docker-entrypoint.sh",
      "fly.toml.example",
    ]) {
      const { repo, base } = repoWith({ [file]: "changed" });
      const done = since(repo, `sha-${base}`);
      expect(done.status, file).toBe(0);
      expect(done.outputs, file).toEqual({ needed: "true" });
      expect(done.out).not.toContain("::notice::");
      expect(done.summary).toBe("");
    }
  });

  it("is measured from what is live, so an unreleased commit before this one still counts", () => {
    const { repo, base } = repoWith(
      { "src/lib/db.ts": "changed" },
      { "src/app/page.tsx": "a page on top" },
    );
    expect(since(repo, `sha-${base}`).outputs).toEqual({ needed: "true" });
    expect(since(repo, base).outputs).toEqual({ needed: "true" });
  });

  it("is yes on a manual run, whatever the commit holds", () => {
    const { repo, base } = repoWith({ "README.md": "other notes" });
    const done = since(repo, `sha-${base}`, "workflow_dispatch");
    expect(done.outputs).toEqual({ needed: "true" });
  });

  it("is yes when Fly cannot be asked, names no commit, or names one git lacks", () => {
    const { repo } = repoWith({ "README.md": "other notes" });
    for (const tag of [null, "", "deployment-01ABC", `sha-${UNKNOWN}`]) {
      const done = since(repo, tag);
      expect(done.status, String(tag)).toBe(0);
      expect(done.outputs, String(tag)).toEqual({ needed: "true" });
    }
  });

  it("is not answered without Fly's token", () => {
    const { repo } = repoWith({ "README.md": "other notes" });
    const done = run(
      "touches-volume",
      { FLY_API_TOKEN: "", GITHUB_EVENT_NAME: "push" },
      repo,
    );
    expect(done.status).not.toBe(0);
    expect(done.outputs).toEqual({});
    expect(called(done, "flyctl")).toEqual([]);
  });
});

describe("the release's name", () => {
  const env = { COUCH_GAG_URL: "https://gag.example", COUCH_GAG_KEY: "key" };
  const reply = (slug: string) =>
    JSON.stringify({ sequence: 17, slug, name: "Bart the Genius" });

  it("is the episode couch-gag gives this repository's commit", () => {
    const done = run("release-name", {
      ...env,
      STUB_REPLY: reply("bart-the-genius"),
    });
    expect(done.status).toBe(0);
    expect(done.outputs).toEqual({
      tag: "r17-bart-the-genius",
      title: "Bart the Genius",
    });
    const [args] = called(done, "curl");
    expect(args).toContain("Authorization: Bearer key");
    expect(args.at(-1)).toBe("https://gag.example/v1/releases");
    expect(JSON.parse(args[args.indexOf("-d") + 1])).toEqual({
      repo: "owner/bookings",
      ref: SHA,
    });
  });

  it("fails, asking nothing, while the address or the key is not set", () => {
    for (const missing of ["COUCH_GAG_URL", "COUCH_GAG_KEY"]) {
      const done = run("release-name", { ...env, [missing]: "" });
      expect(done.status, missing).not.toBe(0);
      expect(done.outputs).toEqual({});
      expect(called(done, "curl")).toEqual([]);
    }
  });

  it("is never made of an answer that is not a release, or of none", () => {
    for (const STUB_REPLY of [
      reply("Bart; rm -rf"),
      '{"error":"forbidden"}',
      "",
    ]) {
      const done = run("release-name", { ...env, STUB_REPLY });
      expect(done.status, STUB_REPLY).not.toBe(0);
      expect(done.outputs).toEqual({});
    }
  });
});

describe("the release's description", () => {
  const env = {
    GH_TOKEN: "token",
    TAG: "r17-bart-the-genius",
    RULES: "Write the description.",
    COPILOT_CLI: "1.0.114",
    STUB_PREVIOUS: "r16-homers-odyssey",
    STUB_CHANGES:
      "Commits:\n- feat: a new screen\n\nFiles changed:\nadded a.ts (+1 -0)",
    STUB_DRAFT: "It adds a screen.\n\n### Changes\n- A new screen",
  };
  const notes = () => path.join(dir, "notes.md");

  it("is Copilot's wording of the commits since the last release, kept for the release and the summary", () => {
    const done = run("release-notes", env);
    expect(done.status).toBe(0);
    expect(readFileSync(notes(), "utf8")).toBe(env.STUB_DRAFT);
    expect(done.summary).toBe(env.STUB_DRAFT);
    expect(called(done, "gh").map((args) => args[1])).toEqual([
      "view",
      "repos/owner/bookings/releases/latest",
      `repos/owner/bookings/compare/r16-homers-odyssey...${SHA}`,
    ]);
    expect(called(done, "npm")).toEqual([
      [
        "install",
        "--global",
        "--silent",
        "--no-audit",
        "--no-fund",
        "@github/copilot@1.0.114",
      ],
    ]);
  });

  it("hands Copilot the rules and the changes, no tools and an empty folder", () => {
    const done = run("release-notes", env);
    expect(called(done, "copilot")).toEqual([
      ["-p", `${env.RULES}\n\n${env.STUB_CHANGES}`, "-s", "--available-tools="],
    ]);
    const [cwd, ...files] = text(path.join(done.io, "copilot.cwd"))
      .split("\n")
      .filter(Boolean);
    expect(files).toEqual([]);
    expect(cwd).not.toBe(dir);
  });

  it("is worded from the last commits when no release came before", () => {
    const done = run("release-notes", { ...env, STUB_PREVIOUS: "" });
    expect(done.status).toBe(0);
    expect(called(done, "gh").at(-1)?.[1]).toBe(
      `repos/owner/bookings/commits?sha=${SHA}&per_page=20`,
    );
    expect(existsSync(notes())).toBe(true);
  });

  it("is not asked for without a tag, for a release that exists, or for no new commit", () => {
    const quiet: Env[] = [
      { TAG: "" },
      { STUB_EXISTS: "1" },
      { STUB_CHANGES: "Commits:\n" },
    ];
    for (const change of quiet) {
      const done = run("release-notes", { ...env, ...change });
      expect(done.status, JSON.stringify(change)).toBe(0);
      expect(called(done, "copilot")).toEqual([]);
      expect(called(done, "npm")).toEqual([]);
      expect(existsSync(notes())).toBe(false);
    }
  });

  it("fails, leaving no notes, when Copilot writes nothing", () => {
    const done = run("release-notes", { ...env, STUB_DRAFT: "" });
    expect(done.status).toBe(1);
    expect(done.out).toContain("::warning::Copilot wrote nothing");
    expect(existsSync(notes())).toBe(false);
    expect(done.summary).toBe("");
  });
});

describe("the tag and the GitHub release", () => {
  const env = {
    GH_TOKEN: "token",
    TAG: "r17-bart-the-genius",
    TITLE: "Bart the Genius",
  };
  const create = [
    "release",
    "create",
    "r17-bart-the-genius",
    "--repo",
    "owner/bookings",
    "--target",
    SHA,
    "--title",
    "Bart the Genius",
    "--generate-notes",
  ];

  it("are made with GitHub's own list when Copilot left no words", () => {
    const done = run("release-create", env);
    expect(done.status).toBe(0);
    expect(called(done, "gh").at(-1)).toEqual(create);
  });

  it("carry Copilot's words above that list when it wrote some", () => {
    const words = "It adds a screen.\n\n### Changes\n- A new screen";
    writeFileSync(path.join(dir, "notes.md"), words);
    const done = run("release-create", env);
    expect(done.status).toBe(0);
    expect(called(done, "gh").at(-1)).toEqual([...create, "--notes", words]);
  });

  it("are not made twice", () => {
    const done = run("release-create", { ...env, STUB_EXISTS: "1" });
    expect(done.status).toBe(0);
    expect(done.out).toContain("already exists");
    expect(called(done, "gh")).toHaveLength(1);
  });

  // The Copilot step may fail and the job goes on, so the release is made from the name alone.
  it("follow a description that failed: the three scripts in a row still end in a release", () => {
    const name = run("release-name", {
      COUCH_GAG_URL: "https://gag.example",
      COUCH_GAG_KEY: "key",
      STUB_REPLY: JSON.stringify({
        sequence: 17,
        slug: "bart-the-genius",
        name: "Bart the Genius",
      }),
    });
    const described = run("release-notes", {
      GH_TOKEN: "token",
      TAG: name.outputs.tag,
      RULES: "Write the description.",
      COPILOT_CLI: "1.0.114",
      STUB_CHANGES: "Commits:\n- feat: a new screen",
      STUB_DRAFT: "",
    });
    expect(described.status).toBe(1);
    const done = run("release-create", {
      GH_TOKEN: "token",
      TAG: name.outputs.tag,
      TITLE: name.outputs.title,
    });
    expect(done.status).toBe(0);
    expect(called(done, "gh").at(-1)).toEqual(create);
  });
});
