import { RULE_LABELS, type RuleId } from "@steward/guard";
import type { ReactNode } from "react";
import { claudeMcpAdd, CURSOR_RULE, demoDir, loadComparison, mcpConfig, stewardBin, toolStatus, type PromptComparison, type Side, type ToolStatus } from "../../lib/brief";
import { loadRepo } from "../../lib/steward";
import { cli, FROM_STEWARD } from "../../lib/commands";
import { Button } from "../button";
import { Panel, RepoProblem } from "../ui";
import { CopyBlock } from "./copy-block";

export const dynamic = "force-dynamic";
export const metadata = { title: "Brief" };

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600";
const code = (text: string) => <code className="rounded-md bg-gray-100 px-1 font-mono text-sm text-gray-900">{text}</code>;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Review's messages mark code with backticks; show those parts as code. */
const withCode = (text: string) => text.split(/`([^`]+)`/).map((part, i) => (i % 2 === 1 ? <code key={i} className="rounded-md bg-gray-100 px-1 font-mono text-xs text-gray-900">{part}</code> : part));

export default async function BriefPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const repo = await loadRepo();
  const chosen = (await searchParams)["prompt"];
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium text-gray-700">Brief</p>
        <h1 className="text-2xl font-semibold text-gray-900">Connect your AI tools</h1>
        <p className="text-sm text-gray-700">Your AI tools build with your components and tokens instead of generic ones. Each tool needs one MCP server entry and a pointer to design.md.</p>
      </header>
      {repo.kind !== "ready" ? (
        <RepoProblem state={repo} />
      ) : (
        <>
          <Tools repo={repo.path} />
          <AnyOtherTool />
        </>
      )}
      <Difference chosen={typeof chosen === "string" ? chosen : undefined} />
    </div>
  );
}

function Status({ status }: { status: ToolStatus }) {
  const text =
    status.server && status.designMd
      ? "Set up in this repo"
      : status.server
        ? "MCP server set up; design.md not added yet"
        : status.designMd
          ? "design.md added; MCP server not set up yet"
          : "Not set up in this repo yet";
  return (
    <p className="flex items-center gap-2 text-sm text-gray-900">
      <span aria-hidden="true">{status.server && status.designMd ? "✓" : "○"}</span>
      {text}
    </p>
  );
}

function ToolCard({ name, status, children }: { name: string; status: ToolStatus; children: ReactNode }) {
  return (
    <section aria-label={name} className="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-6">
      <div className="flex flex-col gap-1">
        <h3 className="text-lg font-semibold text-gray-900">{name}</h3>
        <Status status={status} />
      </div>
      <ol className="flex list-decimal flex-col gap-4 pl-6 text-xs text-gray-700 marker:font-medium">{children}</ol>
    </section>
  );
}

async function Tools({ repo }: { repo: string }) {
  const bin = await stewardBin(process.env, process.cwd());
  const config = mcpConfig(bin ?? "<path to steward>/packages/cli/dist/bin.js", repo);
  const status = await toolStatus(repo);
  return (
    <section aria-labelledby="tools-title" className="flex flex-col gap-4">
      <h2 id="tools-title" className="text-lg font-semibold text-gray-900">
        Tools
      </h2>
      {!bin && (
        <p className="rounded-md bg-gray-100 p-3 text-sm text-gray-900">
          Steward&apos;s command isn&apos;t built yet, so the server path below is a placeholder. Run {code("pnpm build")} in the Steward repo, then reload.
        </p>
      )}
      <div className="grid gap-6 xl:grid-cols-2">
        <ToolCard name="Claude Code" status={status.claudeCode}>
          <li>
            <CopyBlock label={`Write design.md for your repo (run this ${FROM_STEWARD})`} text={cli(`context ${repo} --file`)} />
          </li>
          <li>
            <CopyBlock label="Add this line to your repo's CLAUDE.md, so Claude Code reads your design system" text="@design.md" />
          </li>
          <li>
            <CopyBlock
              label="Add Steward's MCP server, just for you: run this in your repo. It uses paths on this computer, so it stays out of git."
              text={claudeMcpAdd(bin ?? "<path to steward>/packages/cli/dist/bin.js", repo)}
            />
          </li>
        </ToolCard>
        <ToolCard name="Cursor" status={status.cursor}>
          <li>
            <CopyBlock label={`Write design.md for your repo (run this ${FROM_STEWARD})`} text={cli(`context ${repo} --file`)} />
          </li>
          <li>
            <CopyBlock label="Save this as .cursor/rules/design-system.mdc, so Cursor always reads design.md" text={CURSOR_RULE} />
          </li>
          <li>
            <CopyBlock label="Add Steward's MCP server to .cursor/mcp.json. It uses paths on this computer, so add .cursor/mcp.json to .gitignore." text={config} />
          </li>
        </ToolCard>
      </div>
      <p className="text-sm text-gray-700">
        The status comes from your repo&apos;s files and, for Claude Code, its settings for this repo. A server added to a tool&apos;s global settings works too, but doesn&apos;t show here.
      </p>
    </section>
  );
}

function AnyOtherTool() {
  return (
    <section aria-labelledby="other-title" className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-6">
      <h2 id="other-title" className="text-lg font-semibold text-gray-900">
        Any other tool
      </h2>
      <p className="text-sm text-gray-700">
        Steward&apos;s MCP server runs on your machine, so there&apos;s no web address to paste: any tool that supports MCP can start it with the command above. Or download design.md
        and add it to your repo or the tool&apos;s instructions.
      </p>
      <div>
        <a
          href="/brief/design.md"
          download="design.md"
          className={`inline-flex items-center justify-center rounded-md border border-gray-500 bg-white px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50 ${FOCUS}`}
        >
          Download design.md
        </a>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// See the difference
// ---------------------------------------------------------------------------

async function Difference({ chosen }: { chosen: string | undefined }) {
  const dir = await demoDir(process.env, process.cwd());
  const comparisons = dir ? await loadComparison(dir) : [];
  const current = comparisons.find((c) => c.prompt === chosen) ?? comparisons[0];
  return (
    <section aria-labelledby="difference-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 id="difference-title" className="text-lg font-semibold text-gray-900">
          See the difference
        </h2>
        {comparisons.length > 1 && current && (
          <form method="get" className="flex items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-gray-700">
              Prompt
              <select name="prompt" defaultValue={current.prompt} className={`rounded-md border border-gray-500 bg-white px-2 py-2 text-sm text-gray-900 ${FOCUS}`}>
                {comparisons.map((c) => (
                  <option key={c.prompt} value={c.prompt}>
                    {c.prompt}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit">Show</Button>
          </form>
        )}
      </div>
      {current ? <Comparison c={current} /> : <NoComparison />}
    </section>
  );
}

function NoComparison() {
  return (
    <Panel>
      <div className="flex flex-col gap-3 text-sm text-gray-700">
        <p className="font-medium text-gray-900">No before/after comparison yet.</p>
        <p>Once there is one, this shows the same request built by an AI tool with and without your system, side by side, and what Steward Review found in each.</p>
        <details>
          <summary className={`cursor-pointer rounded-md font-medium text-gray-900 ${FOCUS}`}>How to make one (for developers)</summary>
          <ol className="mt-2 flex list-decimal flex-col gap-1 pl-6">
            <li>Run {code("eval/setup.sh")} to make the two copies of the app: one with Steward, one without.</li>
            <li>Give your AI tool the same prompt in each copy, such as the pricing card.</li>
            <li>
              Score each: {code("pnpm eval:score ~/steward-eval/with --label pricing-1")}, then the same for {code("without")}.
            </li>
            <li>
              Save a screenshot of each result as {code("eval/results/<with or without>/pricing-1.png")}. The steps are in {code("eval/README.md")}.
            </li>
          </ol>
        </details>
      </div>
    </Panel>
  );
}

function Comparison({ c }: { c: PromptComparison }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-gray-700">
        Prompt: <q>{c.text}</q>
      </p>
      <div className="grid gap-6 lg:grid-cols-2">
        <SideCard title="Without your system" condition="without" prompt={c.prompt} side={c.without} />
        <SideCard title="With your system" condition="with" prompt={c.prompt} side={c.with} />
      </div>
      <p className="text-sm text-gray-700">Problems are what Steward Review finds in the lines the AI tool added. A screen with no problems found isn&apos;t automatically accessible.</p>
    </div>
  );
}

function SideCard({ title, condition, prompt, side }: { title: string; condition: "with" | "without"; prompt: string; side: Side | null }) {
  const border = condition === "with" ? "border-gray-900" : "border-dashed border-gray-400";
  return (
    <section aria-label={title} className={`flex flex-col gap-4 rounded-lg border ${border} bg-white p-6`}>
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      {!side ? (
        <p className="text-sm text-gray-700">
          Not run yet in the {code(condition)} copy. Run the {prompt} prompt there and score it.
        </p>
      ) : (
        <>
          {side.screenshot ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local file served as is
            <img
              src={`/brief/screenshot/${condition}/${side.shown}`}
              alt={`What the AI tool built for the ${prompt} prompt ${condition} your system (run ${side.shown}).`}
              className="w-full rounded-md border border-gray-200"
            />
          ) : (
            <p className="rounded-md bg-gray-50 p-3 text-sm text-gray-700">
              No screenshot saved. Save one as {code(`eval/results/${condition}/${side.shown}.png`)}.
            </p>
          )}
          <p className="text-2xl font-semibold text-gray-900">
            {plural(side.problems, "problem")} <span className="text-sm font-normal text-gray-700">in {plural(side.addedLines, "added line")}</span>
          </p>
          {side.average !== null && (
            <p className="text-sm text-gray-700">
              Run {side.shown} shown. Average across {side.runs} runs: {side.average}.
            </p>
          )}
          {Object.keys(side.byCheck).length > 0 && (
            <ul className="flex flex-col gap-1 text-sm text-gray-900">
              {Object.entries(side.byCheck).map(([rule, n]) => (
                <li key={rule}>
                  {RULE_LABELS[rule as RuleId] ?? rule}: {n}
                </li>
              ))}
            </ul>
          )}
          {side.findings.length > 0 && (
            <ul className="flex list-disc flex-col gap-1 pl-6 text-sm text-gray-700">
              {side.findings.map((f, i) => (
                <li key={i}>{withCode(f)}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
