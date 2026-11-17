import type { ReactNode } from "react";
import { REPO_ENV, type RepoState } from "../lib/steward";

export function PageHeader({ title, description }: { title: string; description: string }) {
  return (
    <header className="mb-8 flex flex-col gap-2">
      <h1 className="text-2xl font-semibold text-gray-900">{title}</h1>
      <p className="text-sm text-gray-500">{description}</p>
    </header>
  );
}

export function Panel({ children }: { children: ReactNode }) {
  return <section className="rounded-lg border border-gray-200 bg-white p-6">{children}</section>;
}

/** A row of numbers, each with a label. */
export function Stats({ items }: { items: readonly { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="flex flex-col gap-1 rounded-lg border border-gray-200 bg-white p-4">
          <dt className="text-sm text-gray-500">{item.label}</dt>
          <dd className="text-2xl font-semibold text-gray-900">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

const code = (text: string) => <code className="rounded-md bg-gray-100 px-1 font-mono text-sm text-gray-900">{text}</code>;

/** What to do when the repo can't be read yet, in Steward's calm voice. */
export function RepoProblem({ state }: { state: Exclude<RepoState, { kind: "ready" }> }) {
  return (
    <Panel>
      <div className="flex flex-col gap-2 text-sm text-gray-700">
        {state.kind === "not-set" && (
          <>
            <p className="font-medium text-gray-900">Steward isn't pointed at a repo yet.</p>
            <p>
              Set {code(REPO_ENV)} to the folder you scanned, then restart the app. For example: {code(`${REPO_ENV}=fixtures/messy-app pnpm -F web dev`)}
            </p>
          </>
        )}
        {state.kind === "missing" && (
          <>
            <p className="font-medium text-gray-900">There's no folder at {code(state.path)}.</p>
            <p>Check {code(REPO_ENV)} and restart the app.</p>
          </>
        )}
        {state.kind === "no-system" && (
          <>
            <p className="font-medium text-gray-900">There's no Steward system in {code(state.path)} yet.</p>
            <p>Run {code(`steward scan ${state.path}`)} first, then reload this page.</p>
          </>
        )}
        {state.kind === "broken" && (
          <>
            <p className="font-medium text-gray-900">Steward couldn't read the system in {code(state.path)}.</p>
            <p>{state.message}</p>
          </>
        )}
      </div>
    </Panel>
  );
}
