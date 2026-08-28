"use client";

import { useCallback, useEffect, useState } from "react";

import { apiGet, apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import type { CatalogItem, WorkflowRecord } from "@/lib/types";

export default function WorkflowsPage() {
  const { can } = useAuth();
  const api = getBrowserApiUrl();
  const [items, setItems] = useState<WorkflowRecord[]>([]);
  const [banks, setBanks] = useState<CatalogItem[]>([]);
  const [products, setProducts] = useState<CatalogItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [message, setMessage] = useState("");
  const [bankId, setBankId] = useState("");
  const [productId, setProductId] = useState("");
  const [stageName, setStageName] = useState("");
  const [stageCode, setStageCode] = useState("");
  const [fromStage, setFromStage] = useState("");
  const [toStage, setToStage] = useState("");

  const refresh = useCallback(async () => {
    const [workflowData, bankData, productData] = await Promise.all([
      apiGet<{ items: WorkflowRecord[] }>("/api/v1/workflows", api),
      apiGet<{ items: CatalogItem[] }>("/api/v1/banks", api),
      apiGet<{ items: CatalogItem[] }>("/api/v1/products", api),
    ]);
    setItems(workflowData.items);
    setBanks(bankData.items);
    setProducts(productData.items);
    if (!selectedId && workflowData.items[0]) {
      setSelectedId(workflowData.items[0].id);
    }
  }, [api, selectedId]);

  useEffect(() => {
    void refresh().catch((err: unknown) =>
      setMessage(err instanceof Error ? err.message : "Load failed"),
    );
  }, [refresh]);

  const selected = items.find((item) => item.id === selectedId) ?? items[0];

  async function createVersion() {
    setMessage("");
    try {
      const created = await apiRequest<WorkflowRecord>("/api/v1/workflows", api, {
        method: "POST",
        body: JSON.stringify({ bank_id: bankId, product_id: productId }),
      });
      await refresh();
      setSelectedId(created.id);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Create failed");
    }
  }

  return (
    <section className="space-y-6">
      <h2 className="text-xl font-semibold">Workflows</h2>
      <p className="text-sm text-slate-600">
        Workflows are versioned per Bank and Product. Application Created is the only globally
        fixed entry stage. Other stages and transitions are configured here; they are not seeded.
      </p>
      {message ? <p className="text-sm text-red-700">{message}</p> : null}
      {can("WorkflowStages.Create") ? (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void createVersion();
          }}
        >
          <select
            className="rounded-md border px-3 py-2 text-sm"
            aria-label="Workflow bank"
            value={bankId}
            onChange={(event) => setBankId(event.target.value)}
            required
          >
            <option value="">Bank</option>
            {banks.map((bank) => (
              <option key={bank.id} value={bank.id}>
                {bank.code}
              </option>
            ))}
          </select>
          <select
            className="rounded-md border px-3 py-2 text-sm"
            aria-label="Workflow product"
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
            required
          >
            <option value="">Product</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.code}
              </option>
            ))}
          </select>
          <button className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white" type="submit">
            Create new version
          </button>
        </form>
      ) : null}
      <select
        className="rounded-md border px-3 py-2 text-sm"
        aria-label="Workflow version"
        value={selected?.id ?? ""}
        onChange={(event) => setSelectedId(event.target.value)}
      >
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.bank?.code}/{item.product?.code} v{item.version} ({item.status})
          </option>
        ))}
      </select>
      {selected ? (
        <div className="space-y-4 rounded-xl border bg-white p-4">
          <h3 className="font-semibold">
            {selected.bank?.code} / {selected.product?.code} version {selected.version}
          </h3>
          <ol className="space-y-1 text-sm">
            {selected.stages.map((stage) => (
              <li key={stage.id}>
                {stage.sortOrder}. {stage.name} ({stage.status})
                {can("WorkflowStages.Deactivate") &&
                stage.systemKey !== "application_created" &&
                stage.status === "active" ? (
                  <button
                    className="ml-2 underline"
                    type="button"
                    onClick={() =>
                      void apiRequest(`/api/v1/workflows/stages/${stage.id}/deactivate`, api, {
                        method: "POST",
                      }).then(refresh)
                    }
                  >
                    Deactivate
                  </button>
                ) : null}
              </li>
            ))}
          </ol>
          {can("WorkflowStages.Create") ? (
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void apiRequest(`/api/v1/workflows/${selected.id}/stages`, api, {
                  method: "POST",
                  body: JSON.stringify({
                    name: stageName,
                    code: stageCode,
                    sort_order: (selected.stages.at(-1)?.sortOrder ?? 70) + 10,
                  }),
                }).then(refresh);
              }}
            >
              <input
                className="rounded-md border px-3 py-2 text-sm"
                aria-label="Stage name"
                placeholder="Stage name"
                value={stageName}
                onChange={(event) => setStageName(event.target.value)}
                required
              />
              <input
                className="rounded-md border px-3 py-2 text-sm"
                aria-label="Stage code"
                placeholder="Stage code"
                value={stageCode}
                onChange={(event) => setStageCode(event.target.value)}
                required
              />
              <button className="rounded-md border px-3 py-2 text-sm" type="submit">
                Add stage
              </button>
            </form>
          ) : null}
          <p className="text-sm font-medium">Allowed transitions</p>
          <ul className="text-sm">
            {selected.transitions.map((row) => {
              const from = selected.stages.find((stage) => stage.id === row.fromStageId);
              const to = selected.stages.find((stage) => stage.id === row.toStageId);
              return (
                <li key={row.id}>
                  {from?.name} → {to?.name}
                </li>
              );
            })}
          </ul>
          {can("WorkflowStages.ConfigureTransitions") ? (
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void apiRequest(`/api/v1/workflows/${selected.id}/transitions`, api, {
                  method: "PUT",
                  body: JSON.stringify({
                    items: [
                      ...selected.transitions.map((row) => ({
                        from_stage_id: row.fromStageId,
                        to_stage_id: row.toStageId,
                      })),
                      { from_stage_id: fromStage, to_stage_id: toStage },
                    ],
                  }),
                }).then(refresh);
              }}
            >
              <select
                className="rounded-md border px-3 py-2 text-sm"
                aria-label="From stage"
                value={fromStage}
                onChange={(event) => setFromStage(event.target.value)}
                required
              >
                <option value="">From</option>
                {selected.stages.map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.name}
                  </option>
                ))}
              </select>
              <select
                className="rounded-md border px-3 py-2 text-sm"
                aria-label="To stage"
                value={toStage}
                onChange={(event) => setToStage(event.target.value)}
                required
              >
                <option value="">To</option>
                {selected.stages.map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.name}
                  </option>
                ))}
              </select>
              <button className="rounded-md border px-3 py-2 text-sm" type="submit">
                Add transition
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
