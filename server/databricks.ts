const env = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} — check the root .env and that dotenv is wired in server.ts`);
  return value;
};

type StatementResponse = {
  statement_id?: string;
  status?: {
    state?: string;
    error?: { error_code?: string; message?: string };
  };
  result?: { data_array?: (string | null)[][] };
};

export async function runSql(statement: string, params: Record<string, string>) {
  const host = env("DATABRICKS_HOST").replace(/\/+$/, "");
  const headers = {
    Authorization: `Bearer ${env("DATABRICKS_TOKEN")}`,
    "Content-Type": "application/json",
  };
  const res = await fetch(`${host}/api/2.0/sql/statements`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      statement,
      warehouse_id: env("DATABRICKS_WAREHOUSE_ID"),
      wait_timeout: "50s",
      parameters: Object.entries(params).map(([name, value]) => ({ name, value, type: "STRING" })),
    }),
  });
  if (!res.ok) throw new Error(`Databricks SQL failed: ${await res.text()}`);
  let data = await res.json() as StatementResponse;

  // The SQL Statements API returns its state under `status`.
  let pollCount = 0;
  while (
    (data.status?.state === "PENDING" || data.status?.state === "RUNNING") &&
    pollCount < 60
  ) {
    if (!data.statement_id) {
      throw new Error("Databricks SQL response did not include a statement ID for polling");
    }

    await new Promise((r) => setTimeout(r, 2000));
    const poll = await fetch(`${host}/api/2.0/sql/statements/${data.statement_id}`, {
      headers: { Authorization: headers.Authorization },
    });
    if (!poll.ok) throw new Error(`Databricks SQL polling failed: ${await poll.text()}`);
    data = await poll.json() as StatementResponse;
    pollCount++;
  }

  const state = data.status?.state;
  if (state !== "SUCCEEDED") {
    if (state === "PENDING" || state === "RUNNING") {
      throw new Error("Databricks SQL statement timed out while still running");
    }
    const details = data.status?.error;
    throw new Error(
      `Databricks SQL ${state ?? "response missing status"}${
        details?.error_code ? ` (${details.error_code})` : ""
      }${details?.message ? `: ${details.message}` : ""}`,
    );
  }
  return (data.result?.data_array ?? []) as (string | null)[][];
}

export async function putFileBytes(path: string, bytes: Buffer) {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const res = await fetch(`${env("DATABRICKS_HOST")}/api/2.0/fs/files${encoded}?overwrite=true`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${env("DATABRICKS_TOKEN")}` },
    body: new Uint8Array(bytes),
  });
  if (!res.ok) throw new Error(`Volume write failed: ${res.status} ${await res.text()}`);
}

export async function fetchFileBytes(path: string): Promise<ArrayBuffer> {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const res = await fetch(`${env("DATABRICKS_HOST")}/api/2.0/fs/files${encoded}`, {
    headers: { Authorization: `Bearer ${env("DATABRICKS_TOKEN")}` },
  });
  if (!res.ok) throw new Error(`Volume read failed: ${res.status}`);
  return res.arrayBuffer();
}