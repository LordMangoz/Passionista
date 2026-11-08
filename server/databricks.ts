const env = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} — check the root .env and that dotenv is wired in server.ts`);
  return value;
};

export async function runSql(statement: string, params: Record<string, string>) {
  const headers = {
    Authorization: `Bearer ${env("DATABRICKS_TOKEN")}`,
    "Content-Type": "application/json",
  };
  const res = await fetch(`${env("DATABRICKS_HOST")}/api/2.0/sql/statements`, {
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
  let data = await res.json();

  // Poll while the statement finishes (handles warehouse cold starts)
  while (data.state === "PENDING" || data.state === "RUNNING") {
    await new Promise((r) => setTimeout(r, 2000));
    const poll = await fetch(`${env("DATABRICKS_HOST")}/api/2.0/sql/statements/${data.statement_id}`, {
      headers: { Authorization: headers.Authorization },
    });
    data = await poll.json();
  }

  if (data.state !== "SUCCEEDED") throw new Error(`SQL state: ${data.state}`);
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