import { useState } from "react";
import { Card } from "../components/Card";
import { TextField } from "../components/TextField";
import { PrimaryBtn } from "../components/PrimaryBtn";
import { Dialog } from "../components/Dialog";

export function Settings() {
  const [name, setName] = useState("Acme Inc.");
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="max-w-xl">
      <h1 className="mb-6 text-2xl font-bold text-[#111827]">Settings</h1>

      <Card title="Workspace">
        <TextField
          id="workspace-name"
          label="Workspace name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          hint="Shown in invoices and emails."
        />
        <TextField id="workspace-slug" label="URL slug" defaultValue="acme" hint="acme.metrics.app" />
        <PrimaryBtn label="Save changes" onClick={() => console.log("saved")} />
      </Card>

      <div className="mt-[22px]">
        <Card title="Notifications">
          <label className="flex items-center gap-[10px] text-sm text-[#374151]">
            <input type="checkbox" defaultChecked className="h-4 w-4" />
            Weekly digest email
          </label>
          <label className="mt-2 flex items-center gap-[10px] text-sm text-[#374151]">
            <input type="checkbox" className="h-4 w-4" />
            Alert me when churn exceeds 3%
          </label>
        </Card>
      </div>

      <div className="mt-[22px] rounded-lg border border-[#e4e4e7] bg-white p-6">
        <h3 className="mb-[7px] text-base font-semibold text-[#334155]">Danger zone</h3>
        <p className="mb-4 text-sm text-[#9ca3af]">Deleting the workspace removes all data permanently.</p>
        <button
          onClick={() => setConfirmDelete(true)}
          className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
        >
          Delete workspace
        </button>
      </div>

      <Dialog
        open={confirmDelete}
        title="Delete workspace?"
        description="This cannot be undone. All events, users and exports will be removed."
        confirmLabel="Delete"
        onConfirm={() => setConfirmDelete(false)}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
